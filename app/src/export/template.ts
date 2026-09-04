/**
 * Plantillas de exportación.
 *
 * ProTerr tiene su propio formato de salida, y además puede adaptarse al de
 * cualquier consultora: se sube una planilla vacía, la app detecta sus hojas y
 * encabezados y propone a qué campo del modelo corresponde cada columna.
 * A partir de ahí, exportar produce exactamente ese archivo.
 *
 * Así la app no depende de ningún formato ajeno ni lo lleva incorporado: el
 * formato de cada organización lo aporta esa organización.
 */
import { EXPORT_FIELDS, FIELDS_BY_ID } from './fields';
import { fold } from '../nlp/text';
import { editDistance } from '../nlp/text';

/** Qué registros alimentan una hoja. */
export type SheetScope =
  /** Una fila por observación, sin las de tránsito aéreo. */
  | 'registros'
  /** Una fila por observación de tránsito aéreo. */
  | 'transito_aereo'
  /** Una fila por observación de trampeo (Sherman y cámara trampa). */
  | 'trampeo'
  /** Una fila por observación, todas juntas. */
  | 'registros_todos'
  /** Una fila por muestreo (evento). */
  | 'muestreos'
  /** Una fila por estación usada. */
  | 'estaciones';

export interface TemplateColumn {
  /** Texto exacto del encabezado en la planilla de destino. */
  header: string;
  /** Campo de EXPORT_FIELDS que la llena. `null` = columna que se deja vacía. */
  fieldId: string | null;
  /** Valor fijo, cuando la columna no viene del modelo. */
  constant?: string;
}

export interface TemplateSheet {
  name: string;
  scope: SheetScope;
  /** Filas decorativas sobre el encabezado (logos, cliente, código de proyecto). */
  preamble?: string[][];
  columns: TemplateColumn[];
}

export interface ExportTemplate {
  id: string;
  name: string;
  organization?: string | null;
  description?: string | null;
  sheets: TemplateSheet[];
  createdAt: string;
  /** Plantilla que trae ProTerr; no se puede borrar. */
  builtin?: boolean;
  /** Nombre del archivo del que se dedujo, si vino de una planilla subida. */
  sourceFileName?: string | null;
}

const column = (fieldId: string, header?: string): TemplateColumn => ({
  header: header ?? FIELDS_BY_ID.get(fieldId)?.label ?? fieldId,
  fieldId,
});

/**
 * Formato nativo de ProTerr. Es el que se usa mientras la organización no
 * cargue el suyo, y sirve de ejemplo de cómo se arma una plantilla.
 */
export const NATIVE_TEMPLATE: ExportTemplate = {
  id: 'proterr-nativo',
  name: 'ProTerr (formato nativo)',
  organization: null,
  description: 'Salida propia de ProTerr: registros, muestreos y estaciones, con esfuerzo, conservación y trazabilidad.',
  createdAt: '2026-01-01T00:00:00Z',
  builtin: true,
  sheets: [
    {
      // Los campos de vuelo NO viven aquí: en un transecto no existen y una
      // columna vacía en cada fila sólo estorba al leer la planilla.
      name: 'Registros',
      scope: 'registros',
      columns: [
        column('event.date'), column('occurrence.time'),
        column('project.name'), column('campaign.name'), column('campaign.season'),
        column('station.code'), column('station.region'), column('station.habitat'),
        column('station.slope'), column('event.weather'),
        column('event.method'), column('event.recordedBy'),
        column('occurrence.commonName'), column('taxon.scientificName'),
        column('occurrence.recordType'), column('occurrence.evidenceKind'),
        column('occurrence.count'), column('occurrence.sex'), column('occurrence.lifeStage'),
        column('occurrence.condition'), column('occurrence.behaviour'),
        column('occurrence.confidence'), column('occurrence.detectionDistance'),
        column('occurrence.organismId'),
        column('occurrence.latitude'), column('occurrence.longitude'),
        column('occurrence.utmEast'), column('occurrence.utmNorth'),
        column('taxon.kingdom'), column('taxon.phylum'), column('taxon.class'),
        column('taxon.order'), column('taxon.family'), column('taxon.genus'),
        column('taxon.specificEpithet'), column('taxon.infraspecificEpithet'),
        column('conservation.category'), column('conservation.origin'),
        column('conservation.endemic'), column('conservation.source'),
        column('occurrence.photos'), column('occurrence.notes'),
        column('trace.occurrenceId'), column('trace.reviewState'),
        column('trace.syncState'), column('trace.source'), column('trace.utterance'),
        column('trace.pendingFields'), column('trace.createdBy'), column('trace.createdAt'),
      ],
    },
    {
      // El trampeo tiene su propia hoja porque tiene sus propias columnas: la
      // línea y la trampa donde cayó el animal no existen en un transecto.
      name: 'Trampeo',
      scope: 'trampeo',
      columns: [
        column('event.date'), column('occurrence.time'),
        column('project.name'), column('campaign.season'),
        column('station.code'), column('station.region'), column('station.habitat'),
        column('event.method'), column('event.recordedBy'),
        column('occurrence.site'), column('occurrence.trapNumber'),
        column('occurrence.commonName'), column('taxon.scientificName'),
        column('occurrence.count'), column('occurrence.sex'), column('occurrence.lifeStage'),
        column('occurrence.condition'), column('occurrence.organismId'), column('occurrence.recapture'),
        column('occurrence.latitude'), column('occurrence.longitude'),
        column('occurrence.utmEast'), column('occurrence.utmNorth'),
        column('taxon.kingdom'), column('taxon.phylum'), column('taxon.class'),
        column('taxon.order'), column('taxon.family'), column('taxon.genus'),
        column('taxon.specificEpithet'),
        column('conservation.category'), column('conservation.origin'), column('conservation.endemic'),
        column('occurrence.photos'), column('occurrence.notes'),
        column('trace.occurrenceId'), column('trace.createdBy'), column('trace.createdAt'),
      ],
    },
    {
      // Hoja propia, como en las planillas de terreno: el tránsito aéreo tiene
      // sus columnas y no ensucia las del resto del muestreo.
      name: 'Tránsito aéreo',
      scope: 'transito_aereo',
      columns: [
        column('event.date'), column('occurrence.time'),
        column('project.name'), column('campaign.season'),
        column('station.code'), column('station.region'),
        column('event.recordedBy'), column('event.weather'),
        column('occurrence.commonName'), column('taxon.scientificName'),
        column('occurrence.count'), column('occurrence.sex'), column('occurrence.lifeStage'),
        column('aerial.origin'), column('aerial.destination'), column('aerial.direction'),
        column('aerial.heightCategory'), column('aerial.heightMeters'),
        column('occurrence.behaviour'),
        column('taxon.kingdom'), column('taxon.phylum'), column('taxon.class'),
        column('taxon.order'), column('taxon.family'), column('taxon.genus'),
        column('taxon.specificEpithet'),
        column('conservation.category'),
        column('occurrence.photos'), column('occurrence.notes'),
        column('trace.occurrenceId'), column('trace.createdBy'), column('trace.createdAt'),
      ],
    },
    {
      name: 'Muestreos',
      scope: 'muestreos',
      columns: [
        column('event.id'), column('event.date'), column('project.name'),
        column('campaign.name'), column('station.code'), column('event.method'),
        column('event.recordedBy'), column('event.weather'), column('event.period'),
        column('event.temperature'), column('event.wind'), column('event.cloud'),
        column('event.precipitation'),
        column('effort.duration'), column('effort.distance'), column('effort.trapNights'),
        column('event.notes'),
      ],
    },
    {
      name: 'Estaciones',
      scope: 'estaciones',
      columns: [
        column('station.code'), column('station.finalCode'), column('project.name'),
        column('station.region'), column('campaign.season'), column('station.habitat'),
        column('station.slope'),
        column('station.utmEast'), column('station.utmNorth'),
        column('station.utmStartEast'), column('station.utmStartNorth'),
        column('station.utmEndEast'), column('station.utmEndNorth'),
        column('station.latitude'), column('station.longitude'),
        column('station.methodTransecto'), column('station.methodPlaybackAves'),
        column('station.methodPlaybackAnfibios'), column('station.methodCamara'),
        column('station.methodSherman'),
        column('event.recordedBy'), column('event.identifiedBy'),
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Mapeo automático de encabezados
// ---------------------------------------------------------------------------

export interface HeaderMatch {
  fieldId: string | null;
  /** 1 = alias exacto · 0,8 = contenido · 0,6 = parecido ortográfico · 0 = sin match. */
  confidence: number;
  /** Alias que produjo la coincidencia, para poder explicarla. */
  matchedAlias?: string;
}

/** Índice alias → campo, construido una vez. */
const ALIAS_INDEX: Array<{ alias: string; fieldId: string }> = EXPORT_FIELDS.flatMap((f) => [
  { alias: fold(f.label), fieldId: f.id },
  ...f.aliases.map((a) => ({ alias: fold(a), fieldId: f.id })),
]);

/**
 * Adivina a qué campo corresponde un encabezado de otra planilla.
 *
 * No inventa: si la confianza es baja devuelve `null` y la app pide que una
 * persona lo empareje. Es preferible una columna vacía a una columna con el
 * dato equivocado.
 */
export function guessField(header: string): HeaderMatch {
  const q = fold(header);
  if (!q) return { fieldId: null, confidence: 0 };

  for (const { alias, fieldId } of ALIAS_INDEX) {
    if (alias === q) return { fieldId, confidence: 1, matchedAlias: alias };
  }
  // El encabezado contiene el alias completo ("nombre comun (1)" -> "nombre comun").
  let best: HeaderMatch = { fieldId: null, confidence: 0 };
  for (const { alias, fieldId } of ALIAS_INDEX) {
    if (alias.length < 4) continue;
    if (q.includes(alias) || alias.includes(q)) {
      const ratio = Math.min(alias.length, q.length) / Math.max(alias.length, q.length);
      const confidence = 0.6 + 0.25 * ratio;
      if (confidence > best.confidence) best = { fieldId, confidence, matchedAlias: alias };
    }
  }
  if (best.confidence >= 0.7) return best;

  // Último recurso: diferencias menores de escritura.
  for (const { alias, fieldId } of ALIAS_INDEX) {
    if (Math.abs(alias.length - q.length) > 2 || q.length < 5) continue;
    const d = editDistance(alias, q, 2);
    if (d <= 2) {
      const confidence = d === 1 ? 0.65 : 0.55;
      if (confidence > best.confidence) best = { fieldId, confidence, matchedAlias: alias };
    }
  }
  return best.confidence >= 0.55 ? best : { fieldId: null, confidence: 0 };
}

/** Deduce el alcance de una hoja por lo que nombran sus encabezados. */
export function guessScope(fieldIds: Array<string | null>): SheetScope {
  const ids = new Set(fieldIds.filter(Boolean) as string[]);
  const has = (prefix: string) => [...ids].some((id) => id.startsWith(prefix));
  if (ids.has('aerial.heightMeters') || ids.has('aerial.origin') || ids.has('aerial.direction')) {
    return 'transito_aereo';
  }
  if (has('occurrence.') || ids.has('taxon.scientificName')) return 'registros';
  if (has('effort.')) return 'muestreos';
  if (has('station.')) return 'estaciones';
  return 'registros';
}
