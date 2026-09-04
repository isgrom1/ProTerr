/**
 * Base de datos local (IndexedDB vía Dexie).
 *
 * Es la fuente de verdad en terreno: todo se escribe aquí primero y la
 * sincronización es un proceso posterior e idempotente (brief §13, §28). La app
 * nunca depende de la red para no perder un registro.
 */
import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry, Campaign, Identification, MeasurementOrFact, MediaObject,
  Occurrence, Project, SamplingEvent, Station, SyncLogEntry, Taxon,
} from '../domain/types';
import type { ExportTemplate } from '../export/template';
import type { RequirementProfile } from '../validation/profiles';

export interface Vocabulary {
  name: string;
  values: string[];
}

export interface Setting {
  key: string;
  value: unknown;
}

/** Cola de sincronización: una fila por cambio pendiente de subir. */
export interface OutboxItem {
  id: string;
  entity: 'event' | 'occurrence' | 'media' | 'identification' | 'measurement';
  entityId: string;
  op: 'upsert' | 'delete';
  revision: number;
  queuedAt: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string | null;
}

export class ProTerrDb extends Dexie {
  projects!: Table<Project, string>;
  campaigns!: Table<Campaign, string>;
  stations!: Table<Station, string>;
  taxa!: Table<Taxon, string>;
  vocabularies!: Table<Vocabulary, string>;
  profiles!: Table<RequirementProfile, string>;
  /** Plantillas de exportación: la nativa más las que cargue cada organización. */
  templates!: Table<ExportTemplate, string>;
  events!: Table<SamplingEvent, string>;
  occurrences!: Table<Occurrence, string>;
  identifications!: Table<Identification, string>;
  measurements!: Table<MeasurementOrFact, string>;
  media!: Table<MediaObject, string>;
  audit!: Table<AuditEntry, string>;
  outbox!: Table<OutboxItem, string>;
  syncLog!: Table<SyncLogEntry, string>;
  settings!: Table<Setting, string>;

  constructor(name = 'proterr') {
    super(name);
    this.version(1).stores({
      projects: 'id, code',
      campaigns: 'id, projectId',
      stations: 'id, projectId, stationCode',
      // searchKeys es multiEntry: permite buscar la especie sin recorrer 889 filas.
      taxa: 'id, commonName, scientificName, group, *searchKeys',
      vocabularies: 'name',
      profiles: 'id',
      templates: 'id, name, organization',
      events: 'id, projectId, campaignId, stationId, eventDate, syncState, deletedAt',
      occurrences: 'id, eventId, taxonId, occurrenceId, syncState, deletedAt, createdAt',
      identifications: 'id, occurrenceId',
      measurements: 'id, occurrenceId, measurementType',
      media: 'id, occurrenceId, eventId, syncState',
      audit: 'id, entityId, at',
      outbox: 'id, entity, entityId, nextAttemptAt',
      syncLog: 'id, at, entityId',
      settings: 'key',
    });
  }
}

export const db = new ProTerrDb();
