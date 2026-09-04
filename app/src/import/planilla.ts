/**
 * Importación de datos históricos desde la planilla de cualquier consultora.
 *
 * No asume ningún formato: reconoce las columnas por su nombre usando el mismo
 * catálogo de alias que las plantillas de exportación, así que una planilla que
 * ProTerr sabe escribir también la sabe leer.
 *
 * Flujo obligatorio: detectar hojas -> detectar encabezados -> validar ->
 * mostrar errores -> importar sólo lo válido. El archivo original nunca se
 * modifica: se lee en memoria y se descarta.
 */
import * as XLSX from 'xlsx';
import type { RecordType, Taxon } from '../domain/types';
import { guessField } from '../export/template';
import { fold } from '../nlp/text';

export interface SheetDiagnosis {
  name: string;
  rows: number;
  /** Fila (1-based) donde se detectó el encabezado real. */
  headerRow: number | null;
  role: 'registros' | 'registros_ta' | 'estaciones' | 'catalogo_especies' | 'validaciones' | 'desconocida';
  headers: string[];
}

export interface ImportIssue {
  sheet: string;
  row: number | null;
  column?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportedRecord {
  sourceRow: number;
  stationCode: string | null;
  eventDate: string | null;
  eventTime: string | null;
  method: string | null;
  recordType: RecordType | null;
  commonName: string | null;
  taxonId: string | null;
  individualCount: number | null;
  sex: string | null;
  lifeStage: string | null;
  organismCondition: string | null;
  behaviour: string | null;
  weather: string | null;
  notes: string | null;
  recordedBy: string | null;
  team: string | null;
  /** Con crías, en celo, empollando: no es el estado vivo/muerto. */
  reproductiveCondition: string | null;
  aerial: { origin?: string; destination?: string; flightHeightCategory?: string; flightHeightMeters?: number } | null;
}

export interface ImportedStation {
  sourceRow: number;
  stationCode: string;
  finalStationCode: string;
  project: string | null;
  region: string | null;
  season: string | null;
  habitat: string | null;
  slopeAspect: string | null;
  sector: string | null;
  utmEast: number | null;
  utmNorth: number | null;
}

export interface ImportPreview {
  sheets: SheetDiagnosis[];
  /** Filas listas para importar (ya validadas). */
  records: ImportedRecord[];
  stations: ImportedStation[];
  issues: ImportIssue[];
  /** Nada se escribe si hay errores sin resolver. */
  canImport: boolean;
}

/** Marcadores de "sin dato" que la planilla usa de forma intercambiable. */
const NULLISH = new Set(['', '-', '0', 'n/a', '#n/a', 'null', 'undefined']);
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/ /g, ' ').trim();
  return NULLISH.has(s.toLowerCase()) ? null : s;
};
const num = (v: unknown): number | null => {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * El rol de cada hoja se deduce de los campos que ProTerr reconoce en sus
 * encabezados, no de su nombre ni de un formato concreto.
 */
function classifyByFields(fieldIds: Array<string | null>): SheetDiagnosis['role'] {
  const ids = new Set(fieldIds.filter(Boolean) as string[]);
  const has = (p: string) => [...ids].some((id) => id.startsWith(p));
  if (ids.has('aerial.heightMeters') || ids.has('aerial.origin') || ids.has('aerial.direction')) {
    return 'registros_ta';
  }
  if (ids.has('occurrence.commonName') || ids.has('taxon.scientificName')) {
    // Un catálogo de especies tiene taxonomía pero ni estación ni abundancia.
    const isRecords = ids.has('occurrence.count') || ids.has('station.code') || ids.has('occurrence.recordType');
    return isRecords ? 'registros' : 'catalogo_especies';
  }
  if (has('station.')) return 'estaciones';
  return 'desconocida';
}

function detectHeaderRow(rows: unknown[][]): { row: number; headers: string[] } | null {
  // El encabezado real es la fila con más celdas rellenas dentro de las
  // primeras 20: la planilla tiene cabeceras decorativas en las filas 1-8.
  let best: { row: number; headers: string[]; filled: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map((c) => clean(c));
    const filled = cells.filter(Boolean).length;
    if (filled >= 5 && (!best || filled > best.filled)) {
      best = { row: i + 1, headers: cells.map((c) => c ?? ''), filled };
    }
  }
  return best ? { row: best.row, headers: best.headers } : null;
}

/**
 * Índice de columna por CAMPO del modelo. Reconoce el encabezado con los mismos
 * alias que usan las plantillas, así que funciona con la planilla de cualquier
 * consultora sin tener su formato incorporado.
 */
function columnFinder(headers: string[]) {
  const byField = new Map<string, number>();
  headers.forEach((header, index) => {
    const { fieldId, confidence } = guessField(header);
    if (fieldId && confidence >= 0.7 && !byField.has(fieldId)) byField.set(fieldId, index);
  });
  return (fieldId: string): number => byField.get(fieldId) ?? -1;
}

/** Las fechas llegan como serial de Excel, como Date o como texto. */
function excelDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

function excelTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutes = Math.round(v * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export interface ImportOptions {
  /** Catálogo vigente: sirve para resolver especies y detectar las que faltan. */
  taxa: Taxon[];
  /** Tipos de registro válidos según las listas de validación. */
  recordTypes: string[];
}

export function analyzeWorkbook(data: ArrayBuffer, options: ImportOptions): ImportPreview {
  const wb = XLSX.read(data, { cellDates: true });
  const sheets: SheetDiagnosis[] = [];
  const issues: ImportIssue[] = [];
  const records: ImportedRecord[] = [];
  const stations: ImportedStation[] = [];

  const taxonByKey = new Map<string, string[]>();
  for (const t of options.taxa) {
    for (const k of t.searchKeys) {
      const list = taxonByKey.get(k) ?? [];
      list.push(t.id);
      taxonByKey.set(k, list);
    }
  }

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true, defval: null });
    const detected = detectHeaderRow(rows);
    const fieldIds = detected ? detected.headers.map((h) => guessField(h).fieldId) : [];
    const role = detected ? classifyByFields(fieldIds) : 'desconocida';
    sheets.push({ name, rows: rows.length, headerRow: detected?.row ?? null, role, headers: detected?.headers ?? [] });
    if (!detected) continue;

    const find = columnFinder(detected.headers);
    const body = rows.slice(detected.row);

    if (role === 'estaciones') {
      const cCode = find('station.code');
      body.forEach((row, i) => {
        const code = clean(row?.[cCode]);
        if (!code) return;
        stations.push({
          sourceRow: detected.row + i + 1,
          stationCode: code,
          finalStationCode: clean(row[find('station.finalCode')]) ?? code,
          project: clean(row[find('project.name')]),
          region: clean(row[find('station.region')]),
          season: clean(row[find('campaign.season')]),
          habitat: clean(row[find('station.habitat')]),
          slopeAspect: clean(row[find('station.slope')]),
          sector: clean(row[find('station.sector')]),
          utmEast: num(row[find('station.utmEast')]),
          utmNorth: num(row[find('station.utmNorth')]),
        });
      });
      continue;
    }

    if (role !== 'registros' && role !== 'registros_ta') continue;

    const aerialSheet = role === 'registros_ta';
    const cName = find('occurrence.commonName');
    body.forEach((row, i) => {
      const sourceRow = detected.row + i + 1;
      const commonName = clean(row?.[cName]);
      if (!commonName) return; // fila preformateada vacía: se ignora en silencio

      const candidates = taxonByKey.get(fold(commonName)) ?? [];
      let taxonId: string | null = null;
      if (candidates.length === 1) taxonId = candidates[0];
      else if (candidates.length > 1) {
        issues.push({
          sheet: name, row: sourceRow, column: 'Nombre común', severity: 'warning',
          message: `"${commonName}" corresponde a ${candidates.length} especies del catálogo; requiere elegir una.`,
        });
      } else {
        issues.push({
          sheet: name, row: sourceRow, column: 'Nombre común', severity: 'error',
          message: `"${commonName}" no existe en el catálogo de especies (en la planilla producía #N/A).`,
        });
      }

      const eventDate = excelDate(row[find('event.date')]);
      if (!eventDate) {
        issues.push({ sheet: name, row: sourceRow, column: 'Fecha', severity: 'error', message: 'Fecha ausente o ilegible.' });
      }
      const stationCode = clean(row[find('station.code')]);
      if (!stationCode) {
        issues.push({ sheet: name, row: sourceRow, column: 'ID Estación', severity: 'error', message: 'Sin estación asociada.' });
      }

      const rawRecordType = clean(row[find('occurrence.recordType')]);
      if (rawRecordType && !options.recordTypes.some((rt) => fold(rt) === fold(rawRecordType))) {
        issues.push({
          sheet: name, row: sourceRow, column: 'Registro', severity: 'warning',
          message: `Tipo de registro "${rawRecordType}" fuera de la lista de validación.`,
        });
      }

      records.push({
        sourceRow,
        stationCode,
        eventDate,
        eventTime: excelTime(row[find('occurrence.time')]),
        method: clean(row[find('event.method')]) ?? (aerialSheet ? 'Tránsito aéreo' : null),
        recordType: (rawRecordType as RecordType | null) ?? (aerialSheet ? 'Individuo' : null),
        commonName,
        taxonId,
        individualCount: num(row[find('occurrence.count')]),
        sex: clean(row[find('occurrence.sex')]),
        lifeStage: clean(row[find('occurrence.lifeStage')]),
        organismCondition: clean(row[find('occurrence.condition')]),
        behaviour: clean(row[find('occurrence.behaviour')]),
        weather: clean(row[find('event.weather')]),
        notes: clean(row[find('occurrence.notes')]),
        recordedBy: clean(row[find('event.recordedBy')]),
        team: clean(row[find('event.team')]),
        reproductiveCondition: clean(row[find('occurrence.reproductiveCondition')]),
        aerial: aerialSheet
          ? {
              origin: clean(row[find('aerial.origin')]) ?? undefined,
              destination: clean(row[find('aerial.destination')]) ?? undefined,
              flightHeightCategory: clean(row[find('aerial.heightCategory')]) ?? undefined,
              flightHeightMeters: num(row[find('aerial.heightMeters')]) ?? undefined,
            }
          : null,
      });
    });
  }

  return {
    sheets, records, stations, issues,
    canImport: records.length > 0 && !issues.some((i) => i.severity === 'error'),
  };
}
