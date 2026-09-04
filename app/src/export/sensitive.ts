/**
 * Protección de localidades sensibles al exportar.
 *
 * Publicar la coordenada exacta de un nido de cóndor o una madriguera de
 * especie amenazada facilita su saqueo. Darwin Core tiene términos para esto
 * (`dataGeneralizations`, `informationWithheld`) y la práctica estándar es
 * redondear la coordenada, no omitirla.
 *
 * La generalización afecta SÓLO a la exportación pública. La base local y el
 * Excel interno del proyecto conservan siempre la coordenada exacta: el equipo
 * necesita volver al punto.
 */
import { flagFor } from '../conservation/status';
import type { FlatRecord } from './shape';

export type SensitivityPolicy =
  /** Coordenadas exactas. Uso interno del proyecto. */
  | 'exacta'
  /** Redondea a ~1 km las localidades sensibles. Para entrega a terceros. */
  | 'generalizada'
  /** Omite la coordenada de las localidades sensibles. Para publicación abierta. */
  | 'omitida';

export interface AppliedCoordinates {
  latitude: number | null;
  longitude: number | null;
  /** Incertidumbre resultante, en metros. */
  uncertaintyMeters: number | null;
  /** dwc:dataGeneralizations */
  dataGeneralizations: string | null;
  /** dwc:informationWithheld */
  informationWithheld: string | null;
}

/** ~0,01° ≈ 1,1 km en latitud; suficiente para no ubicar una madriguera. */
const GENERALIZATION_DEGREES = 0.01;
const GENERALIZATION_METERS = 1100;

export function applySensitivity(
  record: FlatRecord,
  coords: { latitude: number | null; longitude: number | null; uncertaintyMeters?: number | null },
  policy: SensitivityPolicy,
): AppliedCoordinates {
  const base: AppliedCoordinates = {
    // 6 decimales ≈ 11 cm: más dígitos son ruido de la conversión UTM, no precisión.
    latitude: coords.latitude != null ? roundTo(coords.latitude, 6) : null,
    longitude: coords.longitude != null ? roundTo(coords.longitude, 6) : null,
    uncertaintyMeters: coords.uncertaintyMeters ?? null,
    dataGeneralizations: null,
    informationWithheld: null,
  };
  if (policy === 'exacta') return base;

  const flag = flagFor(record.taxon);
  if (!flag.sensitiveLocation) return base;

  if (policy === 'omitida') {
    return {
      latitude: null, longitude: null, uncertaintyMeters: null,
      dataGeneralizations: null,
      informationWithheld: 'Coordenadas omitidas: especie en categoría de conservación o endémica.',
    };
  }

  return {
    latitude: coords.latitude != null ? round(coords.latitude, GENERALIZATION_DEGREES) : null,
    longitude: coords.longitude != null ? round(coords.longitude, GENERALIZATION_DEGREES) : null,
    uncertaintyMeters: Math.max(coords.uncertaintyMeters ?? 0, GENERALIZATION_METERS),
    dataGeneralizations: `Coordenadas generalizadas a ${GENERALIZATION_DEGREES}° por sensibilidad de la especie.`,
    informationWithheld: 'Coordenadas exactas disponibles para el titular del proyecto.',
  };
}

function round(value: number, step: number): number {
  return roundTo(Math.round(value / step) * step, 6);
}

function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Cuántos registros se verían afectados por una política. Se muestra antes de exportar. */
export function countSensitive(records: FlatRecord[]): number {
  return records.filter((r) => flagFor(r.taxon).sensitiveLocation).length;
}
