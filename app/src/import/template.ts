/**
 * Lectura de la planilla de una consultora para convertirla en plantilla.
 *
 * El usuario sube su formulario (vacío o con datos), la app detecta hojas,
 * encabezados y filas decorativas, y propone a qué campo del modelo
 * corresponde cada columna. Lo que no reconoce lo deja sin asignar para que
 * una persona lo empareje: es preferible una columna vacía a una con el dato
 * equivocado.
 *
 * El archivo subido no se guarda ni se modifica: se lee en memoria y se
 * descarta. Lo único que queda es el mapeo, que es del usuario.
 */
import * as XLSX from 'xlsx';
import { FIELDS_BY_ID } from '../export/fields';
import { guessField, guessScope, type ExportTemplate, type TemplateSheet } from '../export/template';
import { fold } from '../nlp/text';

export interface DetectedColumn {
  index: number;
  header: string;
  fieldId: string | null;
  fieldLabel: string | null;
  confidence: number;
  matchedAlias?: string;
}

export interface DetectedSheet {
  name: string;
  /** Fila 1-based donde está el encabezado real. */
  headerRow: number | null;
  /** Filas decorativas por encima del encabezado, conservadas tal cual. */
  preamble: string[][];
  scope: TemplateSheet['scope'];
  columns: DetectedColumn[];
  /** La hoja no parece un formulario de registros. */
  ignored: boolean;
}

export interface TemplateDetection {
  fileName: string;
  sheets: DetectedSheet[];
  /** Columnas totales y cuántas quedaron sin emparejar. */
  totalColumns: number;
  unmapped: number;
}

const NULLISH = new Set(['', '-', 'n/a', '#n/a', 'null', 'undefined']);
const clean = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/ /g, ' ').trim();
  return NULLISH.has(s.toLowerCase()) ? '' : s;
};

/**
 * Busca la fila de encabezado: la que tiene más celdas de texto no repetido
 * dentro de las primeras 25. Las planillas suelen traer logos, cliente y
 * código de proyecto en las filas de arriba, y ésas no son encabezados.
 */
function detectHeaderRow(rows: unknown[][]): number | null {
  let best: { row: number; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] ?? []).map(clean).filter(Boolean);
    if (cells.length < 3) continue;
    // Penaliza filas con números (son datos) y premia variedad de textos.
    const textual = cells.filter((c) => !/^-?\d+([.,]\d+)?$/.test(c));
    const score = new Set(textual.map(fold)).size;
    if (!best || score > best.score) best = { row: i + 1, score };
  }
  return best && best.score >= 3 ? best.row : null;
}

function trimEnd(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === '') end--;
  return cells.slice(0, end);
}

/** Campos donde un número es lo esperado y no delata un error de emparejamiento. */
const NUMERIC_FIELDS = new Set([
  'event.year', 'event.month', 'event.day', 'occurrence.count',
  'occurrence.latitude', 'occurrence.longitude', 'occurrence.utmEast', 'occurrence.utmNorth',
  'occurrence.detectionDistance', 'occurrence.trapNumber',
  'station.latitude', 'station.longitude', 'station.utmEast', 'station.utmNorth',
  'station.utmStartEast', 'station.utmStartNorth', 'station.utmEndEast', 'station.utmEndNorth',
  'aerial.heightMeters', 'aerial.heightCategory',
  'event.temperature', 'event.wind', 'event.cloud',
  'effort.durationMinutes', 'effort.distanceMeters', 'effort.trapNights', 'effort.trapCount',
]);

/** ¿La columna trae números y nada más? Se miran hasta 30 filas con dato. */
function looksNumeric(body: unknown[][], index: number): boolean {
  let numeros = 0;
  let total = 0;
  for (const row of body) {
    const cell = clean((row ?? [])[index]);
    if (!cell) continue;
    total++;
    if (/^-?\d+([.,]\d+)?$/.test(cell)) numeros++;
    if (total >= 30) break;
  }
  // Con menos de tres datos no hay evidencia suficiente para descartar nada.
  return total >= 3 && numeros / total >= 0.8;
}

/** Hojas que claramente no son formularios de registro. */
function looksIgnorable(name: string, columns: DetectedColumn[]): boolean {
  const n = fold(name);
  if (/^(instrucciones|leer|guia|ayuda|portada|indice|validacion|listas|catalogo|nombres)/.test(n)) return true;
  return columns.filter((c) => c.fieldId).length < 2;
}

export function detectTemplate(data: ArrayBuffer, fileName: string): TemplateDetection {
  const wb = XLSX.read(data, { cellDates: true });
  const sheets: DetectedSheet[] = [];
  let totalColumns = 0;
  let unmapped = 0;

  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: true, defval: null });
    const headerRow = detectHeaderRow(rows);
    if (headerRow === null) {
      sheets.push({ name, headerRow: null, preamble: [], scope: 'registros', columns: [], ignored: true });
      continue;
    }

    const headerCells = (rows[headerRow - 1] ?? []).map(clean);
    const body = rows.slice(headerRow);
    const columns: DetectedColumn[] = [];
    headerCells.forEach((header, index) => {
      if (!header) return;
      const guess = guessField(header);
      // "Orden" es el orden taxonómico y también el número de fila. Si la
      // columna trae puros números, no es taxonomía: se deja sin emparejar
      // antes que exportar el correlativo como si fuera un orden.
      const descartado = guess.fieldId !== null
        && !NUMERIC_FIELDS.has(guess.fieldId)
        && looksNumeric(body, index);
      const fieldId = descartado ? null : guess.fieldId;
      columns.push({
        index, header,
        fieldId,
        fieldLabel: fieldId ? FIELDS_BY_ID.get(fieldId)?.label ?? null : null,
        confidence: fieldId ? guess.confidence : 0,
        matchedAlias: fieldId ? guess.matchedAlias : undefined,
      });
    });

    // Se recortan las celdas vacías del final: XLSX rellena cada fila hasta el
    // ancho de la hoja, y eso ensuciaría el archivo exportado.
    const preamble = rows.slice(0, headerRow - 1).map((row) => trimEnd((row ?? []).map(clean)));
    const ignored = looksIgnorable(name, columns);
    sheets.push({
      name, headerRow, preamble,
      scope: guessScope(columns.map((c) => c.fieldId)),
      columns, ignored,
    });
    if (!ignored) {
      totalColumns += columns.length;
      unmapped += columns.filter((c) => !c.fieldId).length;
    }
  }

  return { fileName, sheets, totalColumns, unmapped };
}

/** Convierte lo detectado (y corregido por el usuario) en una plantilla usable. */
export function toTemplate(
  detection: TemplateDetection,
  meta: { id: string; name: string; organization?: string | null },
): ExportTemplate {
  return {
    id: meta.id,
    name: meta.name,
    organization: meta.organization ?? null,
    description: `Deducida de ${detection.fileName}.`,
    createdAt: new Date().toISOString(),
    sourceFileName: detection.fileName,
    sheets: detection.sheets
      .filter((s) => !s.ignored && s.columns.length > 0)
      .map((s) => ({
        name: s.name,
        scope: s.scope,
        // El preámbulo se conserva para que el archivo salga igual al original.
        preamble: s.preamble.length ? s.preamble : undefined,
        columns: s.columns.map((c) => ({ header: c.header, fieldId: c.fieldId })),
      })),
  };
}
