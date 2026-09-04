/**
 * Exportador genérico: modelo + plantilla → libro de Excel.
 *
 * No hay ningún formato incorporado en el código. La forma del archivo la
 * define enteramente la plantilla, así que adaptarse a otra consultora es
 * cargar su planilla, no tocar el exportador.
 */
import * as XLSX from 'xlsx';
import type { SamplingEvent, Station } from '../domain/types';
import { summarizePlan } from '../plan/coverage';
import { resolveField } from './fields';
import type { FlatRecord } from './shape';
import type { ExportTemplate, SheetScope, TemplateSheet } from './template';

export interface WorkbookContext {
  /** Eventos completos: hacen falta para las hojas de muestreos y las ausencias. */
  events?: SamplingEvent[];
  /** Estaciones del proyecto: hacen falta para la hoja del plan. */
  stations?: Station[];
  /** Valores para rellenar el preámbulo, por marcador: {{cliente}} -> "…". */
  placeholders?: Record<string, string>;
}

const TRAPPING = new Set<SamplingEvent['method']>(['trampa_sherman', 'camara_trampa']);
/** Metodologías que salen en su propia hoja y por eso no van en "Registros". */
const OWN_SHEET = new Set<SamplingEvent['method']>([
  'transito_aereo', 'transito_aereo_nocturno', ...TRAPPING,
]);

/** Selecciona las filas que alimentan una hoja según su alcance. */
function rowsFor(
  scope: SheetScope, records: FlatRecord[], events: SamplingEvent[], stations: Station[],
): FlatRecord[] {
  switch (scope) {
    // Cada metodología con columnas propias sale en su hoja; "registros" es
    // el resto, para no arrastrar columnas vacías por toda la planilla.
    case 'registros':
      return records.filter((r) => !OWN_SHEET.has(r.event.method));
    case 'transito_aereo':
      return records.filter((r) => r.event.method === 'transito_aereo');
    case 'transito_aereo_nocturno':
      return records.filter((r) => r.event.method === 'transito_aereo_nocturno');
    case 'trampeo':
      return records.filter((r) => TRAPPING.has(r.event.method));
    case 'registros_todos':
      return records;
    case 'muestreos':
      return uniqueBy(records, (r) => r.event.id, events, stations);
    case 'plan':
      return planRows(records, events, stations);
    case 'estaciones':
      return uniqueBy(records.filter((r) => r.station), (r) => r.station!.id);
    default:
      return records;
  }
}

/**
 * Una fila por clave. Para los muestreos se agregan los eventos que no tienen
 * ninguna observación: un muestreo sin detecciones también es una fila.
 */
function uniqueBy(
  records: FlatRecord[], key: (r: FlatRecord) => string,
  extraEvents: SamplingEvent[] = [], stations: Station[] = [],
): FlatRecord[] {
  const seen = new Map<string, FlatRecord>();
  for (const r of records) if (!seen.has(key(r))) seen.set(key(r), r);
  const out = [...seen.values()];

  if (extraEvents.length) {
    const covered = new Set(records.map((r) => r.event.id));
    const modelo = out[0] ?? records[0] ?? null;
    for (const event of extraEvents) {
      if (event.deletedAt || covered.has(event.id)) continue;
      // Registro sintético: el evento existe, la observación no. La estación
      // se resuelve por el evento; heredarla de otra fila ponía el muestreo
      // en el punto equivocado.
      out.push(synthetic(event, stationOf(event, records, stations), modelo));
    }
  }
  return out.sort((a, b) =>
    a.event.eventDate.localeCompare(b.event.eventDate) || a.event.eventTime.localeCompare(b.event.eventTime));
}

/**
 * Una fila por celda del plan (estación × metodología declarada), haya o no
 * muestreo. Lo pendiente sale en blanco; lo no realizado, marcado y con motivo.
 */
function planRows(records: FlatRecord[], events: SamplingEvent[], stations: Station[]): FlatRecord[] {
  if (!stations.length) return uniqueBy(records, (r) => r.event.id, events, stations);
  const porEvento = new Map<string, FlatRecord>();
  for (const r of records) if (!porEvento.has(r.event.id)) porEvento.set(r.event.id, r);
  const modelo = records[0] ?? null;

  const plan = summarizePlan(stations, events);
  const filas = plan.rows.map((row) => {
    const hecho = row.event ? porEvento.get(row.event.id) : null;
    if (hecho) return hecho;
    const event = row.event ?? placeholderEvent(row.station.id, row.method, row.station.projectId);
    return synthetic(event, row.station, modelo);
  });
  // Los muestreos fuera del plan igual salen: existen y hay que reportarlos.
  for (const event of plan.offPlan) {
    filas.push(porEvento.get(event.id)
      ?? synthetic(event, stationOf(event, records, stations), modelo));
  }
  return filas;
}

/** Evento vacío para una celda del plan que todavía nadie tocó. */
function placeholderEvent(stationId: string, method: SamplingEvent['method'], projectId: string): SamplingEvent {
  return {
    ...EMPTY_RECORD.event, id: '', projectId, campaignId: '', stationId, siteId: null,
    method, eventDate: '', eventTime: '',
  };
}

function stationOf(event: SamplingEvent, records: FlatRecord[], stations: Station[]): Station | null {
  return stations.find((st) => st.id === event.stationId)
    ?? records.find((r) => r.station?.id === event.stationId)?.station
    ?? null;
}

/** Fila sin observación: sirve para las hojas de muestreo y de plan. */
function synthetic(event: SamplingEvent, station: Station | null, modelo: FlatRecord | null): FlatRecord {
  return {
    ...(modelo ?? EMPTY_RECORD),
    event, station,
    occurrence: EMPTY_RECORD.occurrence,
    site: null, taxon: null, facts: [],
  };
}

/** Ocurrencia vacía, sólo para poder resolver campos en filas que no tienen una. */
const EMPTY_RECORD = {
  occurrence: {
    id: '', eventId: '', occurrenceTime: '', occurrenceId: '', taxonId: null,
    verbatimTaxonText: null, recordType: 'Otro', evidenceKind: 'Directo',
    individualCount: null, sexScope: 'sin_definir', lifeStageScope: 'sin_definir',
    mediaIds: [], pendingFields: [], source: 'manual', aerial: null,
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', deletedAt: null,
    deviceId: '', syncState: 'pending', syncError: null, syncedAt: null, revision: 1,
  },
  event: {
    id: '', projectId: '', campaignId: '', stationId: '', siteId: null, method: 'otro',
    eventDate: '', eventTime: '', timezone: 'America/Santiago', utcOffsetMinutes: 0,
    deviceTimestamp: '', dateTimeEditedByUser: false,
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', deletedAt: null,
    deviceId: '', syncState: 'pending', syncError: null, syncedAt: null, revision: 1,
  },
  site: null, station: null, project: null, campaign: null, taxon: null, facts: [],
} as unknown as FlatRecord;

function fillPlaceholders(row: string[], values: Record<string, string>): string[] {
  return row.map((cell) =>
    String(cell ?? '').replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? ''));
}

export function buildSheet(
  sheet: TemplateSheet, records: FlatRecord[], ctx: WorkbookContext = {},
): XLSX.WorkSheet {
  const rows = rowsFor(sheet.scope, records, ctx.events ?? [], ctx.stations ?? []);
  const headers = sheet.columns.map((c) => c.header);
  const body = rows.map((record) =>
    sheet.columns.map((c) =>
      c.constant !== undefined ? c.constant : c.fieldId ? resolveField(c.fieldId, record) : ''));

  const preamble = (sheet.preamble ?? []).map((row) => fillPlaceholders(row, ctx.placeholders ?? {}));
  return XLSX.utils.aoa_to_sheet([...preamble, headers, ...body]);
}

export function buildWorkbook(
  records: FlatRecord[], template: ExportTemplate, ctx: WorkbookContext = {},
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const sheet of template.sheets) {
    // Excel limita el nombre de hoja a 31 caracteres.
    XLSX.utils.book_append_sheet(wb, buildSheet(sheet, records, ctx), sheet.name.slice(0, 31));
  }
  return wb;
}

export function workbookToBlob(wb: XLSX.WorkBook): Blob {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
