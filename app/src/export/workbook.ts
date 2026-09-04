/**
 * Exportador genérico: modelo + plantilla → libro de Excel.
 *
 * No hay ningún formato incorporado en el código. La forma del archivo la
 * define enteramente la plantilla, así que adaptarse a otra consultora es
 * cargar su planilla, no tocar el exportador.
 */
import * as XLSX from 'xlsx';
import type { SamplingEvent } from '../domain/types';
import { resolveField } from './fields';
import type { FlatRecord } from './shape';
import type { ExportTemplate, SheetScope, TemplateSheet } from './template';

export interface WorkbookContext {
  /** Eventos completos: hacen falta para las hojas de muestreos y las ausencias. */
  events?: SamplingEvent[];
  /** Valores para rellenar el preámbulo, por marcador: {{cliente}} -> "…". */
  placeholders?: Record<string, string>;
}

/** Selecciona las filas que alimentan una hoja según su alcance. */
function rowsFor(scope: SheetScope, records: FlatRecord[], events: SamplingEvent[]): FlatRecord[] {
  switch (scope) {
    case 'registros':
      return records.filter((r) => r.event.method !== 'transito_aereo');
    case 'transito_aereo':
      return records.filter((r) => r.event.method === 'transito_aereo');
    case 'registros_todos':
      return records;
    case 'muestreos':
      return uniqueBy(records, (r) => r.event.id, events);
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
  records: FlatRecord[], key: (r: FlatRecord) => string, extraEvents: SamplingEvent[] = [],
): FlatRecord[] {
  const seen = new Map<string, FlatRecord>();
  for (const r of records) if (!seen.has(key(r))) seen.set(key(r), r);
  const out = [...seen.values()];

  if (extraEvents.length) {
    const covered = new Set(records.map((r) => r.event.id));
    for (const event of extraEvents) {
      if (event.deletedAt || covered.has(event.id)) continue;
      // Registro sintético: el evento existe, la observación no.
      out.push({ ...(out[0] ?? EMPTY_RECORD), event, occurrence: EMPTY_RECORD.occurrence, taxon: null, facts: [] });
    }
  }
  return out.sort((a, b) =>
    a.event.eventDate.localeCompare(b.event.eventDate) || a.event.eventTime.localeCompare(b.event.eventTime));
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
  station: null, project: null, campaign: null, taxon: null, facts: [],
} as unknown as FlatRecord;

function fillPlaceholders(row: string[], values: Record<string, string>): string[] {
  return row.map((cell) =>
    String(cell ?? '').replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? ''));
}

export function buildSheet(
  sheet: TemplateSheet, records: FlatRecord[], ctx: WorkbookContext = {},
): XLSX.WorkSheet {
  const rows = rowsFor(sheet.scope, records, ctx.events ?? []);
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
