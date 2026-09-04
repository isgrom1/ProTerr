/**
 * Escritura de datos de terreno: borrador -> Event + Occurrence normalizados.
 *
 * Todo pasa por aquí para que ningún camino se salte la auditoría (§29) ni la
 * cola de sincronización (§14). El guardado es local y síncrono con el usuario:
 * la red no participa.
 */
import type { ObservationDraft } from '../domain/draft';
import type {
  AuditEntry, GeoFix, MeasurementOrFact, MediaObject, Occurrence, ReviewState,
  SamplingEvent, TrackPoint, Uuid, Waypoint,
} from '../domain/types';
import {
  appendTrackPoint, inferPeriod, normalizeWaypointLabel, trackLengthMeters, waypointDistanceMeters,
} from '../effort/session';
import { db, type OutboxItem } from './db';
import { eventIdFor, occurrenceIdFor, uuid } from './ids';

export interface Session {
  userId: string;
  userName: string;
  deviceId: string;
}

const nowIso = () => new Date().toISOString();

function auditBase(session: Session) {
  const at = nowIso();
  return {
    createdAt: at, createdBy: session.userId, updatedAt: at, updatedBy: session.userId,
    deletedAt: null, deviceId: session.deviceId,
    syncState: 'pending' as const, syncError: null, syncedAt: null, revision: 1,
  };
}

async function recordAudit(entry: Omit<AuditEntry, 'id'>): Promise<void> {
  await db.audit.add({ id: uuid(), ...entry });
}

async function enqueue(item: Omit<OutboxItem, 'id' | 'queuedAt' | 'attempts' | 'nextAttemptAt'>): Promise<void> {
  const at = nowIso();
  await db.outbox.put({ id: `${item.entity}:${item.entityId}`, queuedAt: at, attempts: 0, nextAttemptAt: at, ...item });
}

export interface EventKey {
  projectId: Uuid;
  campaignId: Uuid;
  stationId: Uuid;
  siteId?: Uuid | null;
  method: SamplingEvent['method'];
  eventDate: string;
}

/** Abre el muestreo: marca el inicio del esfuerzo y fija las condiciones. */
export async function startEffort(
  eventId: Uuid, session: Session, conditions?: SamplingEvent['conditions'],
): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event || event.startedAt) return;
  await applyEventPatch(eventId, {
    startedAt: nowIso(),
    conditions: conditions ?? event.conditions ?? null,
  }, session, 'Muestreo iniciado');
}

/**
 * Cierra el muestreo y congela el esfuerzo. `noDetections` deja constancia de
 * que la estación se recorrió y no se detectó nada, que es un dato y no un vacío.
 */
export async function endEffort(
  eventId: Uuid, session: Session, extra: Partial<Pick<SamplingEvent, 'distanceMeters' | 'trapCount' | 'trapNights' | 'noDetections'>> = {},
): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event) return;
  const occurrences = await db.occurrences.where('eventId').equals(eventId).toArray();
  const hasRecords = occurrences.some((o) => !o.deletedAt);
  await applyEventPatch(eventId, {
    endedAt: nowIso(),
    noDetections: extra.noDetections ?? !hasRecords,
    ...extra,
  }, session, 'Muestreo cerrado');
}

/**
 * Acumula un punto del recorrido. Sólo hace algo si el track está activo:
 * el GPS no graba nada por su cuenta.
 */
export async function appendTrack(eventId: Uuid, point: TrackPoint): Promise<boolean> {
  const event = await db.events.get(eventId);
  if (!event || event.trackState !== 'activo') return false;
  const result = appendTrackPoint(event.track ?? [], point);
  if (!result.accepted) return false;
  await db.events.update(eventId, {
    track: result.track,
    distanceMeters: trackLengthMeters(result.track),
  });
  return true;
}

/** "Iniciar track": abre el recorrido y marca el punto de inicio si hay GPS. */
export async function startTrack(eventId: Uuid, session: Session, fix?: GeoFix | null): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event || event.trackState === 'activo') return;
  await applyEventPatch(eventId, {
    trackState: 'activo',
    startedAt: event.startedAt ?? nowIso(),
    track: [],
    waypoints: [],
  }, session, 'Track iniciado');
  if (fix) await markWaypoint(eventId, 'inicio', fix, session);
}

/** "Cerrar track": congela el recorrido y marca el punto final si hay GPS. */
export async function endTrack(eventId: Uuid, session: Session, fix?: GeoFix | null): Promise<void> {
  const event = await db.events.get(eventId);
  if (!event || event.trackState !== 'activo') return;
  if (fix) await markWaypoint(eventId, 'final', fix, session);
  const updated = await db.events.get(eventId);
  const track = updated?.track ?? [];
  await applyEventPatch(eventId, {
    trackState: 'cerrado',
    endedAt: nowIso(),
    distanceMeters: track.length > 1
      ? trackLengthMeters(track)
      : waypointDistanceMeters(updated?.waypoints ?? []),
  }, session, 'Track cerrado');
}

/**
 * "Punto 100", "punto medio", "punto final". Marca un waypoint nombrado con su
 * coordenada. Es la alternativa liviana al track completo: con tres puntos se
 * reconstruye el transecto sin tener el GPS encendido todo el rato.
 */
export async function markWaypoint(
  eventId: Uuid, label: string, fix: GeoFix, session: Session,
): Promise<Waypoint | null> {
  const event = await db.events.get(eventId);
  if (!event) return null;
  const waypoint: Waypoint = {
    id: uuid(),
    label: normalizeWaypointLabel(label),
    at: fix.fixedAt ?? nowIso(),
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters ?? null,
  };
  const waypoints = [...(event.waypoints ?? []), waypoint];
  await applyEventPatch(eventId, {
    waypoints,
    distanceMeters: event.track && event.track.length > 1
      ? event.distanceMeters
      : waypointDistanceMeters(waypoints),
  }, session, `Punto "${waypoint.label}" marcado`);
  return waypoint;
}

/** Cambio auditado sobre un evento; misma disciplina que en las ocurrencias. */
export async function applyEventPatch(
  id: Uuid, patch: Partial<SamplingEvent>, session: Session, note?: string,
): Promise<void> {
  const before = await db.events.get(id);
  if (!before) return;
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    // El recorrido cambia constantemente: auditarlo punto a punto sería ruido.
    if (k === 'track') continue;
    if (JSON.stringify(prev) !== JSON.stringify(v)) changes[k] = [prev, v];
  }
  await db.events.put({
    ...before, ...patch,
    updatedAt: nowIso(), updatedBy: session.userId,
    revision: before.revision + 1, syncState: 'pending',
  });
  if (Object.keys(changes).length) {
    await recordAudit({
      entity: 'event', entityId: id, action: 'update', at: nowIso(),
      by: session.userId, deviceId: session.deviceId, changes, note: note ?? null,
    });
  }
  await enqueue({ entity: 'event', entityId: id, op: 'upsert', revision: before.revision + 1 });
}

/**
 * Reutiliza el evento abierto para la misma estación/metodología/día. Es lo que
 * evita repetir 25 columnas por fila: muchas ocurrencias comparten un evento.
 */
export async function getOrCreateEvent(
  key: EventKey,
  extra: { eventTime: string; recordedBy?: string | null; weather?: string | null; deviceFix?: GeoFix | null; projectCode: string },
  session: Session,
): Promise<SamplingEvent> {
  const existing = await db.events
    .where({ stationId: key.stationId, eventDate: key.eventDate })
    .filter((e) => !e.deletedAt && e.method === key.method && (e.siteId ?? null) === (key.siteId ?? null)
      && e.campaignId === key.campaignId)
    .first();
  if (existing) return existing;

  const id = uuid();
  const device = new Date();
  const event: SamplingEvent = {
    id,
    ...key,
    siteId: key.siteId ?? null,
    eventTime: extra.eventTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -device.getTimezoneOffset(),
    deviceTimestamp: device.toISOString(),
    dateTimeEditedByUser: false,
    recordedBy: extra.recordedBy ?? null,
    weather: extra.weather ?? null,
    notes: null,
    deviceFix: extra.deviceFix ?? null,
    // El esfuerzo NO se abre solo. En el uso normal el usuario dice "EMF44" y
    // las especies, después "EMF55" y más especies, sin cerrar nada. Medir
    // duración y distancia es una decisión explícita suya (startEffort /
    // "iniciar track"), no algo que la app le imponga.
    startedAt: null,
    endedAt: null,
    track: [],
    trackState: null,
    waypoints: [],
    distanceMeters: null,
    trapCount: null,
    trapNights: null,
    conditions: { temperatureC: null, windBeaufort: null, cloudOctas: null, precipitation: null, period: inferPeriod(extra.eventTime) },
    noDetections: false,
    incidental: key.method === 'registro_oportunista',
    ...auditBase(session),
  };
  // El identificador Darwin Core se genera aquí, no se deja vacío como en la planilla.
  Object.assign(event, { darwinCoreEventId: eventIdFor(extra.projectCode, id) });
  await db.events.put(event);
  await recordAudit({ entity: 'event', entityId: id, action: 'create', at: nowIso(), by: session.userId, deviceId: session.deviceId });
  await enqueue({ entity: 'event', entityId: id, op: 'upsert', revision: event.revision });
  return event;
}

export interface CommitResult {
  event: SamplingEvent;
  occurrence: Occurrence;
}

/**
 * Persiste un borrador. `pendingFields` viene del motor de validación: se
 * guarda lo que falta en vez de impedir el guardado (brief §7).
 */
export async function commitDraft(
  draft: ObservationDraft,
  opts: {
    projectCode: string; pendingFields: string[];
    occurrenceFix?: GeoFix | null; deviceFix?: GeoFix | null;
    /** Compartido por todos los registros de un mismo dictado. */
    batchId?: string | null;
  },
  session: Session,
): Promise<CommitResult> {
  if (!draft.projectId || !draft.campaignId || !draft.stationId || !draft.method) {
    throw new Error('El borrador necesita proyecto, campaña, estación y metodología.');
  }
  const eventDate = draft.eventDate ?? new Date().toISOString().slice(0, 10);
  const eventTime = draft.eventTime ?? new Date().toTimeString().slice(0, 5);

  const event = await getOrCreateEvent(
    {
      projectId: draft.projectId, campaignId: draft.campaignId, stationId: draft.stationId,
      siteId: draft.siteId ?? null, method: draft.method, eventDate,
    },
    { eventTime, recordedBy: draft.recordedBy, weather: draft.weather, deviceFix: opts.deviceFix, projectCode: opts.projectCode },
    session,
  );

  const id = uuid();
  const occurrence: Occurrence = {
    id,
    eventId: event.id,
    // Hora del avistamiento, no del evento: el usuario nombra la estación una
    // vez y luego va dictando especies durante un rato.
    occurrenceTime: draft.eventTime ?? eventTime,
    occurrenceId: occurrenceIdFor(opts.projectCode, id),
    taxonId: draft.taxonId,
    verbatimTaxonText: draft.taxonId ? null : draft.verbatimTaxonText,
    recordType: draft.recordType ?? 'Individuo',
    evidenceKind: isIndirect(draft.recordType) ? 'Indirecto' : 'Directo',
    individualCount: draft.individualCount,
    sex: draft.sex, sexScope: draft.sexScope,
    lifeStage: draft.lifeStage, lifeStageScope: draft.lifeStageScope,
    organismCondition: draft.organismCondition,
    behaviour: draft.behaviour,
    notes: draft.notes,
    occurrenceFix: opts.occurrenceFix ?? null,
    aerial: draft.aerial,
    source: draft.source,
    verbatimUtterance: draft.verbatimUtterance,
    batchId: opts.batchId ?? null,
    mediaIds: draft.mediaIds,
    pendingFields: opts.pendingFields,
    identificationConfidence: draft.identificationConfidence ?? 'seguro',
    detectionDistanceMeters: draft.detectionDistanceMeters ?? null,
    organismId: draft.organismId ?? null,
    recapture: draft.recapture ?? null,
    reviewState: 'terreno',
    reviewedBy: null,
    reviewedAt: null,
    ...auditBase(session),
  };

  await db.transaction('rw', [db.occurrences, db.measurements, db.audit, db.outbox, db.media], async () => {
    await db.occurrences.put(occurrence);
    // La respuesta al playback no es una columna del núcleo: va como hecho asociado.
    if (draft.playbackResponse) {
      await addMeasurement(occurrence.id, 'respuestaPlayback', draft.playbackResponse, null, session);
    }
    for (const mediaId of draft.mediaIds) {
      await db.media.update(mediaId, { occurrenceId: occurrence.id, eventId: event.id });
    }
    await recordAudit({ entity: 'occurrence', entityId: id, action: 'create', at: nowIso(), by: session.userId, deviceId: session.deviceId });
    await enqueue({ entity: 'occurrence', entityId: id, op: 'upsert', revision: occurrence.revision });
  });

  return { event, occurrence };
}

export async function addMeasurement(
  occurrenceId: Uuid, type: string, value: string, unit: string | null, session: Session,
): Promise<MeasurementOrFact> {
  const fact: MeasurementOrFact = {
    id: uuid(), occurrenceId, measurementType: type, measurementValue: value,
    measurementUnit: unit, measurementMethod: null, ...auditBase(session),
  };
  await db.measurements.put(fact);
  await enqueue({ entity: 'measurement', entityId: fact.id, op: 'upsert', revision: fact.revision });
  return fact;
}

/** Edición con registro de qué cambió (§29). Nunca sobrescribe en silencio. */
export async function updateOccurrence(
  id: Uuid, patch: Partial<Occurrence>, session: Session, note?: string,
): Promise<Occurrence> {
  const before = await db.occurrences.get(id);
  if (!before) throw new Error(`Registro ${id} no encontrado`);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(patch)) {
    const prev = (before as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(prev) !== JSON.stringify(v)) changes[k] = [prev, v];
  }
  if (!Object.keys(changes).length) return before;

  const after: Occurrence = {
    ...before, ...patch,
    updatedAt: nowIso(), updatedBy: session.userId,
    revision: before.revision + 1, syncState: 'pending', syncError: null,
  };
  await db.occurrences.put(after);
  await recordAudit({
    entity: 'occurrence', entityId: id, action: 'update', at: nowIso(),
    by: session.userId, deviceId: session.deviceId, changes, note: note ?? null,
  });
  await enqueue({ entity: 'occurrence', entityId: id, op: 'upsert', revision: after.revision });
  return after;
}

/** Borrado lógico: la información crítica no se destruye (§29). */
export async function deleteOccurrence(id: Uuid, session: Session, reason?: string): Promise<void> {
  const before = await db.occurrences.get(id);
  if (!before) return;
  await db.occurrences.put({
    ...before, deletedAt: nowIso(), updatedAt: nowIso(), updatedBy: session.userId,
    revision: before.revision + 1, syncState: 'pending',
  });
  await recordAudit({
    entity: 'occurrence', entityId: id, action: 'delete', at: nowIso(),
    by: session.userId, deviceId: session.deviceId, note: reason ?? null,
  });
  await enqueue({ entity: 'occurrence', entityId: id, op: 'delete', revision: before.revision + 1 });
}

/**
 * Duplica un registro (§18): mismo evento y misma especie, hora nueva.
 * Los campos que el usuario suele cambiar quedan listos para editar.
 */
export async function duplicateOccurrence(id: Uuid, session: Session): Promise<Occurrence> {
  const source = await db.occurrences.get(id);
  if (!source) throw new Error(`Registro ${id} no encontrado`);
  const newId = uuid();
  const copy: Occurrence = {
    ...source,
    id: newId,
    occurrenceId: source.occurrenceId.replace(/:occ:.*$/, `:occ:${newId}`),
    mediaIds: [], // las fotos no se duplican: pertenecen a la observación original
    occurrenceTime: new Date().toTimeString().slice(0, 5), // se duplica para "otro igual, ahora"
    source: 'duplicado',
    verbatimUtterance: null,
    ...auditBase(session),
  };
  await db.occurrences.put(copy);
  await recordAudit({
    entity: 'occurrence', entityId: newId, action: 'create', at: nowIso(),
    by: session.userId, deviceId: session.deviceId, note: `Duplicado de ${id}`,
  });
  await enqueue({ entity: 'occurrence', entityId: newId, op: 'upsert', revision: copy.revision });
  return copy;
}

/**
 * Avanza el estado de revisión (terreno → revisado → validado). Un registro
 * validado no se edita sin volver a bajarlo: es lo que protege el informe.
 */
export async function setReviewState(
  id: Uuid, state: ReviewState, session: Session, note?: string,
): Promise<Occurrence> {
  return updateOccurrence(
    id,
    {
      reviewState: state,
      reviewedBy: state === 'terreno' ? null : session.userId,
      reviewedAt: state === 'terreno' ? null : nowIso(),
    },
    session,
    note ?? `Estado de revisión: ${state}`,
  );
}

export async function attachMedia(
  media: Omit<MediaObject, keyof ReturnType<typeof auditBase> | 'id'>, session: Session,
): Promise<MediaObject> {
  const obj: MediaObject = { id: uuid(), ...media, ...auditBase(session) } as MediaObject;
  await db.media.put(obj);
  await enqueue({ entity: 'media', entityId: obj.id, op: 'upsert', revision: obj.revision });
  if (obj.occurrenceId) {
    const occ = await db.occurrences.get(obj.occurrenceId);
    if (occ) await updateOccurrence(occ.id, { mediaIds: [...occ.mediaIds, obj.id] }, session, 'Fotografía agregada');
  }
  return obj;
}

function isIndirect(recordType: string | null): boolean {
  return ['Fecas', 'Huella', 'Plumas', 'Madriguera', 'Cururera', 'Muda', 'Huesos', 'Nido', 'Egagrópila', 'Registro de audio']
    .includes(recordType ?? '');
}
