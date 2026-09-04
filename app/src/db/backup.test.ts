/** El respaldo es el seguro contra perder el teléfono a mitad de campaña. */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDraft } from '../domain/draft';
import { backupFileName, createBackup, isBackupFile, restoreBackup } from './backup';
import { db } from './db';
import { summarizeEffort } from '../effort/session';
import type { GeoFix } from '../domain/types';
import {
  appendTrack, commitDraft, endEffort, endTrack, markWaypoint, startTrack,
  updateOccurrence, type Session,
} from './repository';
import { seedCatalogs } from './seed';

const session: Session = { userId: 'u1', userName: 'Isaac Rojas', deviceId: 'dev-1' };

const fixAt = (latitude: number, longitude: number): GeoFix => ({
  latitude, longitude, accuracyMeters: 6, fixedAt: new Date().toISOString(),
});

async function baseDraft(patch: Record<string, unknown> = {}) {
  const [station] = await db.stations.toArray();
  const [project] = await db.projects.toArray();
  const [campaign] = await db.campaigns.toArray();
  const chucao = (await db.taxa.toArray()).find((t) => t.commonName === 'Chucao')!;
  return {
    projectCode: project.code,
    draft: {
      ...emptyDraft('d1', 'voz' as const),
      projectId: project.id, campaignId: campaign.id, stationId: station.id, method: 'transecto' as const,
      eventDate: '2026-09-04', eventTime: '10:34', recordedBy: 'Isaac Rojas',
      taxonId: chucao.id, recordType: 'Vocalización' as const, individualCount: 1,
      ...patch,
    },
  };
}

async function seedOneRecord() {
  const { draft, projectCode } = await baseDraft();
  return commitDraft(draft, { projectCode, pendingFields: [] }, session);
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await seedCatalogs();
});

describe('respaldo local', () => {
  it('incluye los datos de terreno y la auditoría, no los catálogos', async () => {
    await seedOneRecord();
    const backup = await createBackup(session.deviceId);
    expect(backup.format).toBe('proterr-backup');
    expect(backup.counts.occurrences).toBe(1);
    expect(backup.counts.events).toBe(1);
    expect(backup.counts.audit).toBeGreaterThan(0);
    expect(backup.counts.outbox).toBe(2);
    // Los catálogos no se respaldan: se vuelven a sembrar.
    expect(backup.data.taxa).toBeUndefined();
  });

  it('restaura sobre una base vacía', async () => {
    const { occurrence } = await seedOneRecord();
    const backup = await createBackup(session.deviceId);

    await db.occurrences.clear();
    await db.events.clear();
    expect(await db.occurrences.count()).toBe(0);

    const report = await restoreBackup(backup);
    expect(report.inserted.occurrences).toBe(1);
    expect(report.inserted.events).toBe(1);
    expect(report.conflicts).toHaveLength(0);
    expect((await db.occurrences.get(occurrence.id))!.taxonId).toBe(occurrence.taxonId);
  });

  it('al fusionar no pisa una versión local distinta: la reporta', async () => {
    const { occurrence } = await seedOneRecord();
    const backup = await createBackup(session.deviceId);
    await updateOccurrence(occurrence.id, { individualCount: 7 }, session, 'corregido después del respaldo');

    const report = await restoreBackup(backup, 'fusionar');
    expect(report.conflicts.some((c) => c.id === occurrence.id)).toBe(true);
    expect((await db.occurrences.get(occurrence.id))!.individualCount).toBe(7); // gana lo local
  });

  it('en modo reemplazar sí sobrescribe, porque el usuario lo pidió', async () => {
    const { occurrence } = await seedOneRecord();
    const backup = await createBackup(session.deviceId);
    await updateOccurrence(occurrence.id, { individualCount: 7 }, session);

    await restoreBackup(backup, 'reemplazar');
    expect((await db.occurrences.get(occurrence.id))!.individualCount).toBe(1);
  });

  it('rechaza un archivo que no es un respaldo', async () => {
    expect(isBackupFile({ hola: 1 })).toBe(false);
    await expect(restoreBackup({ hola: 1 })).rejects.toThrow('no es un respaldo');
  });

  it('rechaza un respaldo de una versión más nueva en vez de leerlo a medias', async () => {
    const backup = await createBackup(session.deviceId);
    await expect(restoreBackup({ ...backup, version: 99 })).rejects.toThrow('más nueva');
  });

  it('avisa cuando el respaldo se hizo sin las fotografías', async () => {
    const { occurrence } = await seedOneRecord();
    await db.media.put({
      id: 'm1', occurrenceId: occurrence.id, eventId: null, kind: 'foto',
      mimeType: 'image/jpeg', blob: new Blob(['x']), capturedAt: new Date().toISOString(),
      fix: null, headingDegrees: null, exif: null, fileName: 'f.jpg',
      createdAt: '', createdBy: 'u1', updatedAt: '', updatedBy: 'u1', deletedAt: null,
      deviceId: 'dev-1', syncState: 'pending', syncError: null, syncedAt: null, revision: 1,
    });
    const backup = await createBackup(session.deviceId, { includeMedia: false });
    const report = await restoreBackup(backup);
    expect(report.warnings.some((w) => w.includes('sin bytes'))).toBe(true);
  });

  it('el nombre del archivo lleva fecha para que no se pisen', () => {
    const name = backupFileName('Punta del So');
    expect(name).toMatch(/^ProTerr_respaldo_Punta-del-So_\d{4}-\d{2}-\d{2}T/);
    expect(name.endsWith('.json')).toBe(true);
  });
});

describe('esfuerzo: opcional y explícito', () => {
  it('un registro normal NO abre ninguna medición de esfuerzo', async () => {
    // El uso real es "EMF44 y las especies, después EMF55 y más especies".
    // La app no debe imponer abrir ni cerrar nada.
    const { event } = await seedOneRecord();
    const stored = await db.events.get(event.id);
    expect(stored!.startedAt).toBeNull();
    expect(stored!.trackState).toBeNull();
    expect(summarizeEffort(stored!).measured).toBe(false);
  });

  it('cada registro guarda su propia hora, no la del muestreo', async () => {
    const { event } = await seedOneRecord();
    const [occ] = await db.occurrences.toArray();
    expect(occ.occurrenceTime).toBe('10:34');
    expect(event.eventTime).toBe('10:34');

    // Una segunda especie dictada más tarde conserva su hora, aunque comparta evento.
    const { draft: later, projectCode } = await baseDraft({ draftId: 'd2', eventTime: '10:58' });
    const second = await commitDraft(later, { projectCode, pendingFields: [] }, session);
    expect(second.event.id).toBe(event.id); // mismo muestreo
    expect(second.occurrence.occurrenceTime).toBe('10:58'); // distinta hora
  });

  it('"iniciar track" abre el recorrido y marca el punto de inicio', async () => {
    const { event } = await seedOneRecord();
    await startTrack(event.id, session, fixAt(-31.2465, -71.5312));
    const opened = await db.events.get(event.id);
    expect(opened!.trackState).toBe('activo');
    expect(opened!.startedAt).toBeTruthy();
    expect(opened!.waypoints).toHaveLength(1);
    expect(opened!.waypoints![0].label).toBe('inicio');
  });

  it('los puntos nombrados reconstruyen el transecto sin grabar el track', async () => {
    const { event } = await seedOneRecord();
    await startTrack(event.id, session, fixAt(-31.2465, -71.5312));
    await markWaypoint(event.id, '100', fixAt(-31.2474, -71.5312), session);
    await markWaypoint(event.id, '200', fixAt(-31.2483, -71.5312), session);
    await endTrack(event.id, session, fixAt(-31.2492, -71.5312));

    const closed = await db.events.get(event.id);
    expect(closed!.trackState).toBe('cerrado');
    expect(closed!.waypoints!.map((w) => w.label)).toEqual(['inicio', '100', '200', 'final']);
    // ~300 m: cuatro puntos separados por ~100 m cada uno.
    expect(closed!.distanceMeters).toBeGreaterThan(280);
    expect(closed!.distanceMeters).toBeLessThan(320);
    expect(summarizeEffort(closed!).measured).toBe(true);
  });

  it('normaliza las etiquetas habladas de los puntos', async () => {
    const { event } = await seedOneRecord();
    await markWaypoint(event.id, 'Fin', fixAt(-31.2465, -71.5312), session);
    await markWaypoint(event.id, 'Mitad', fixAt(-31.2470, -71.5312), session);
    const stored = await db.events.get(event.id);
    expect(stored!.waypoints!.map((w) => w.label)).toEqual(['final', 'medio']);
  });

  it('el track no graba nada mientras no esté activo', async () => {
    const { event } = await seedOneRecord();
    const accepted = await appendTrack(event.id, { t: new Date().toISOString(), lat: -31.24, lon: -71.53, acc: 5 });
    expect(accepted).toBe(false);
    expect((await db.events.get(event.id))!.track).toEqual([]);
  });

  it('cerrar el muestreo sin registros lo marca como ausencia', async () => {
    const { event } = await seedOneRecord();
    const occ = (await db.occurrences.toArray())[0];
    await db.occurrences.update(occ.id, { deletedAt: new Date().toISOString() });
    await endEffort(event.id, session);
    expect((await db.events.get(event.id))!.noDetections).toBe(true);
  });

  it('cerrar el track queda en la auditoría', async () => {
    const { event } = await seedOneRecord();
    await startTrack(event.id, session, fixAt(-31.2465, -71.5312));
    await endTrack(event.id, session, fixAt(-31.2492, -71.5312));
    const entries = await db.audit.where('entityId').equals(event.id).toArray();
    expect(entries.some((e) => e.note === 'Track cerrado')).toBe(true);
  });
});
