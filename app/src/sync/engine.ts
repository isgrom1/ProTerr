/**
 * Motor de sincronización.
 *
 * Reglas del brief §14 y §28:
 *  - cada registro nace con UUID en el dispositivo, así que subir dos veces el
 *    mismo cambio es idempotente y no duplica;
 *  - nada se sobrescribe en silencio: un conflicto se marca y se conserva la
 *    versión remota para que una persona decida;
 *  - los reintentos son con espera creciente y quedan en un log auditable.
 */
import { db, type OutboxItem } from '../db/db';
import { uuid } from '../db/ids';
import type { Occurrence, SamplingEvent, SyncLogEntry } from '../domain/types';

export type PushOutcome =
  | { status: 'ok'; revision: number }
  | { status: 'conflict'; remoteRevision: number; remote: unknown }
  | { status: 'retry'; message: string }
  | { status: 'error'; message: string };

/** Contrato con el backend. La app no asume ningún proveedor concreto. */
export interface SyncTransport {
  push(item: OutboxItem, payload: unknown): Promise<PushOutcome>;
  isOnline(): boolean;
}

export interface SyncReport {
  attempted: number;
  synced: number;
  conflicts: number;
  failed: number;
  skipped: number;
}

const MAX_ATTEMPTS = 8;
/** Espera creciente: 2s, 4s, 8s ... hasta 15 min. */
const backoffMs = (attempt: number) => Math.min(2 ** attempt * 1000, 15 * 60 * 1000);

async function log(entry: Omit<SyncLogEntry, 'id'>): Promise<void> {
  await db.syncLog.add({ id: uuid(), ...entry });
}

async function payloadFor(item: OutboxItem): Promise<unknown | null> {
  switch (item.entity) {
    case 'event': return (await db.events.get(item.entityId)) ?? null;
    case 'occurrence': return (await db.occurrences.get(item.entityId)) ?? null;
    case 'media': return (await db.media.get(item.entityId)) ?? null;
    case 'identification': return (await db.identifications.get(item.entityId)) ?? null;
    case 'measurement': return (await db.measurements.get(item.entityId)) ?? null;
    default: return null;
  }
}

async function markState(
  item: OutboxItem, state: 'synced' | 'error' | 'pending', error?: string | null,
): Promise<void> {
  const at = new Date().toISOString();
  const patch = { syncState: state, syncError: error ?? null, syncedAt: state === 'synced' ? at : null };
  if (item.entity === 'event') await db.events.update(item.entityId, patch as Partial<SamplingEvent>);
  if (item.entity === 'occurrence') await db.occurrences.update(item.entityId, patch as Partial<Occurrence>);
  if (item.entity === 'media') await db.media.update(item.entityId, patch);
  if (item.entity === 'measurement') await db.measurements.update(item.entityId, patch);
  if (item.entity === 'identification') await db.identifications.update(item.entityId, patch);
}

/**
 * Sube todo lo pendiente cuyo momento de reintento ya llegó.
 * Es seguro llamarla en cualquier momento: si no hay red, no hace nada.
 */
export async function syncOutbox(transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { attempted: 0, synced: 0, conflicts: 0, failed: 0, skipped: 0 };
  if (!transport.isOnline()) return report;

  const now = Date.now();
  const due = (await db.outbox.toArray())
    .filter((i) => new Date(i.nextAttemptAt).getTime() <= now)
    // Los eventos primero: una ocurrencia sin su evento no tiene sentido en el servidor.
    .sort((a, b) => Number(b.entity === 'event') - Number(a.entity === 'event'));

  for (const item of due) {
    const payload = await payloadFor(item);
    if (!payload && item.op === 'upsert') {
      await db.outbox.delete(item.id);
      report.skipped++;
      continue;
    }
    report.attempted++;
    const attempt = item.attempts + 1;
    let outcome: PushOutcome;
    try {
      outcome = await transport.push(item, payload);
    } catch (err) {
      outcome = { status: 'retry', message: err instanceof Error ? err.message : String(err) };
    }

    if (outcome.status === 'ok') {
      await db.outbox.delete(item.id);
      await markState(item, 'synced');
      await log({ at: new Date().toISOString(), direction: 'push', entity: item.entity, entityId: item.entityId, outcome: 'ok', attempt });
      report.synced++;
      continue;
    }

    if (outcome.status === 'conflict') {
      // No se sobrescribe: se conserva la versión remota junto al registro local
      // y se marca en rojo para que una persona resuelva.
      await db.settings.put({ key: `conflict:${item.entity}:${item.entityId}`, value: outcome.remote });
      await db.outbox.update(item.id, { attempts: attempt, lastError: 'conflicto', nextAttemptAt: farFuture() });
      await markState(item, 'error', `Conflicto con la versión ${outcome.remoteRevision} del servidor`);
      await log({ at: new Date().toISOString(), direction: 'push', entity: item.entity, entityId: item.entityId, outcome: 'conflict', attempt, message: `remota=${outcome.remoteRevision}` });
      report.conflicts++;
      continue;
    }

    const message = outcome.message;
    const exhausted = attempt >= MAX_ATTEMPTS || outcome.status === 'error';
    await db.outbox.update(item.id, {
      attempts: attempt,
      lastError: message,
      nextAttemptAt: exhausted ? farFuture() : new Date(now + backoffMs(attempt)).toISOString(),
    });
    await markState(item, exhausted ? 'error' : 'pending', message);
    await log({
      at: new Date().toISOString(), direction: 'push', entity: item.entity, entityId: item.entityId,
      outcome: exhausted ? 'error' : 'retry', attempt, message,
    });
    report.failed++;
  }
  return report;
}

/** Reintenta manualmente lo que quedó en error, incluidos los conflictos. */
export async function retryFailed(): Promise<number> {
  const at = new Date().toISOString();
  const items = await db.outbox.toArray();
  const failed = items.filter((i) => i.lastError);
  for (const i of failed) await db.outbox.update(i.id, { attempts: 0, nextAttemptAt: at, lastError: null });
  return failed.length;
}

export interface SyncStatus {
  pending: number;
  errored: number;
  conflicts: number;
}

export async function syncStatus(): Promise<SyncStatus> {
  const items = await db.outbox.toArray();
  return {
    pending: items.filter((i) => !i.lastError).length,
    errored: items.filter((i) => i.lastError && i.lastError !== 'conflicto').length,
    conflicts: items.filter((i) => i.lastError === 'conflicto').length,
  };
}

function farFuture(): string {
  return new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
}
