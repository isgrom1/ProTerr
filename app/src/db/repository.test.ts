/**
 * Pruebas de integración sobre IndexedDB (fake-indexeddb en Node).
 * Verifican lo que el brief exige del almacenamiento: UUID propio, auditoría,
 * borrado lógico, duplicado y cola de sincronización con reintentos.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDraft } from '../domain/draft';
import type { Occurrence } from '../domain/types';
import { syncOutbox, syncStatus, type PushOutcome, type SyncTransport } from '../sync/engine';
import { db } from './db';
import { commitDraft, deleteOccurrence, duplicateOccurrence, updateOccurrence, type Session } from './repository';
import { seedCatalogs } from './seed';

const session: Session = { userId: 'u1', userName: 'Isaac Rojas', deviceId: 'dev-1' };

async function baseDraft(patch: Record<string, unknown> = {}) {
  const station = (await db.stations.toArray())[0];
  const project = (await db.projects.toArray())[0];
  const campaign = (await db.campaigns.toArray())[0];
  const chucao = (await db.taxa.toArray()).find((t) => t.commonName === 'Chucao')!;
  return {
    draft: {
      ...emptyDraft('d1', 'voz'),
      projectId: project.id, campaignId: campaign.id, stationId: station.id, method: 'transecto' as const,
      eventDate: '2026-09-04', eventTime: '10:34', recordedBy: 'Isaac Rojas',
      taxonId: chucao.id, recordType: 'Vocalización' as const, individualCount: 1,
      verbatimUtterance: 'EMF09 chucao uno sonido',
      ...patch,
    },
    projectCode: project.code,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedCatalogs();
});

describe('guardado local', () => {
  it('siembra los catálogos completos', async () => {
    expect(await db.taxa.count()).toBeGreaterThan(150); // catálogo de arranque + comodines
    expect(await db.stations.count()).toBe(7); // estaciones de demostración
    expect(await db.projects.count()).toBe(1);
  });

  it('crea evento y ocurrencia con UUID y estado pendiente', async () => {
    const { draft, projectCode } = await baseDraft();
    const { event, occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    expect(occurrence.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(occurrence.occurrenceId).toMatch(/^urn:proterr:.+:occ:/);
    expect(occurrence.syncState).toBe('pending');
    expect(occurrence.eventId).toBe(event.id);
    expect(await db.outbox.count()).toBe(2); // evento + ocurrencia
  });

  it('reutiliza el evento para la misma estación, metodología y día', async () => {
    const { draft, projectCode } = await baseDraft();
    const a = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const b = await commitDraft({ ...draft, draftId: 'd2' }, { projectCode, pendingFields: [] }, session);
    expect(b.event.id).toBe(a.event.id);
    expect(await db.events.count()).toBe(1);
    expect(await db.occurrences.count()).toBe(2);
  });

  it('guarda los campos pendientes en vez de rechazar el registro', async () => {
    const { draft, projectCode } = await baseDraft({ individualCount: null, recordType: 'Individuo' });
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: ['individualCount'] }, session);
    expect(occurrence.pendingFields).toEqual(['individualCount']);
  });

  it('conserva el dictado original para trazabilidad', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    expect(occurrence.verbatimUtterance).toBe('EMF09 chucao uno sonido');
    expect(occurrence.source).toBe('voz');
  });
});

describe('auditoría y corrección', () => {
  it('registra qué campos cambiaron', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    await updateOccurrence(occurrence.id, { individualCount: 3 }, session, 'Corregido en gabinete');

    const entries = await db.audit.where('entityId').equals(occurrence.id).toArray();
    const update = entries.find((e) => e.action === 'update')!;
    expect(update.changes?.individualCount).toEqual([1, 3]);
    expect(update.note).toBe('Corregido en gabinete');
    expect((await db.occurrences.get(occurrence.id))!.revision).toBe(2);
  });

  it('no escribe nada si el patch no cambia nada', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    await updateOccurrence(occurrence.id, { individualCount: 1 }, session);
    expect((await db.occurrences.get(occurrence.id))!.revision).toBe(1);
  });

  it('elimina de forma lógica y deja constancia', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    await deleteOccurrence(occurrence.id, session, 'Duplicado');

    const stored = await db.occurrences.get(occurrence.id);
    expect(stored?.deletedAt).toBeTruthy(); // el dato sigue ahí
    expect((await db.audit.where('entityId').equals(occurrence.id).toArray()).some((a) => a.action === 'delete')).toBe(true);
  });

  it('duplica sin arrastrar las fotos ni el dictado del original', async () => {
    const { draft, projectCode } = await baseDraft({ mediaIds: [] });
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const copy = await duplicateOccurrence(occurrence.id, session);
    expect(copy.id).not.toBe(occurrence.id);
    expect(copy.occurrenceId).not.toBe(occurrence.occurrenceId);
    expect(copy.taxonId).toBe(occurrence.taxonId);
    expect(copy.source).toBe('duplicado');
    expect(copy.mediaIds).toEqual([]);
    expect(copy.verbatimUtterance).toBeNull();
  });
});

describe('sincronización', () => {
  function transport(outcomes: PushOutcome[], online = true): SyncTransport & { calls: number } {
    let i = 0;
    return {
      calls: 0,
      isOnline: () => online,
      async push() {
        this.calls++;
        return outcomes[Math.min(i++, outcomes.length - 1)];
      },
    };
  }

  it('sin conexión no toca la cola', async () => {
    const { draft, projectCode } = await baseDraft();
    await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const report = await syncOutbox(transport([{ status: 'ok', revision: 1 }], false));
    expect(report.attempted).toBe(0);
    expect((await syncStatus()).pending).toBe(2);
  });

  it('vacía la cola y marca sincronizado', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const report = await syncOutbox(transport([{ status: 'ok', revision: 1 }]));
    expect(report.synced).toBe(2);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.occurrences.get(occurrence.id))!.syncState).toBe('synced');
  });

  it('reintenta con espera creciente sin perder el registro', async () => {
    const { draft, projectCode } = await baseDraft();
    await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    await syncOutbox(transport([{ status: 'retry', message: 'timeout' }]));
    const items = await db.outbox.toArray();
    expect(items).toHaveLength(2);
    expect(items[0].attempts).toBe(1);
    expect(new Date(items[0].nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
    expect(items[0].lastError).toBe('timeout');
  });

  it('un conflicto no sobrescribe: guarda la versión remota y marca el registro', async () => {
    const { draft, projectCode } = await baseDraft();
    const { occurrence } = await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const remote: Partial<Occurrence> = { id: occurrence.id, revision: 7, individualCount: 9 };
    // El evento sube bien; el conflicto es sólo en la ocurrencia.
    await syncOutbox({
      isOnline: () => true,
      async push(item) {
        return item.entity === 'occurrence'
          ? { status: 'conflict', remoteRevision: 7, remote }
          : { status: 'ok', revision: 1 };
      },
    });

    const local = await db.occurrences.get(occurrence.id);
    expect(local!.individualCount).toBe(1); // la versión local se conserva intacta
    expect(local!.syncState).toBe('error');
    expect((await db.settings.get(`conflict:occurrence:${occurrence.id}`))!.value).toEqual(remote);
    expect((await syncStatus()).conflicts).toBe(1);
  });

  it('sube el evento antes que la ocurrencia', async () => {
    const { draft, projectCode } = await baseDraft();
    await commitDraft(draft, { projectCode, pendingFields: [] }, session);
    const order: string[] = [];
    await syncOutbox({
      isOnline: () => true,
      async push(item) { order.push(item.entity); return { status: 'ok', revision: 1 }; },
    });
    expect(order[0]).toBe('event');
  });
});
