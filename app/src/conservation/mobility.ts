/**
 * Cuándo un registro necesita su propia coordenada.
 *
 * No todo avistamiento merece un punto GPS. Un chucao cantando en EMF44 queda
 * bien ubicado con el código de la estación: marcar un punto por cada ave sólo
 * agrega toques en terreno y una precisión falsa, porque el animal ya se movió.
 *
 * El punto propio importa cuando la ubicación **significa algo y se queda
 * quieta**:
 *  - fauna de baja movilidad (reptiles, anfibios, micromamíferos): el
 *    individuo estaba ahí, y ahí seguirá el microhábitat;
 *  - evidencia indirecta (fecas, huellas, madrigueras, nidos): es un punto
 *    fijo por definición;
 *  - especies en categoría de conservación: el punto es parte del hallazgo y
 *    puede tener consecuencias en el informe.
 */
import type { RecordType, Taxon } from '../domain/types';
import { levelOf } from './status';

export type Mobility = 'baja' | 'alta' | 'desconocida';

/** Órdenes de mamíferos que en terreno se comportan como baja movilidad. */
const LOW_MOBILITY_ORDERS = new Set(['Rodentia', 'Didelphimorphia', 'Microbiotheria', 'Soricomorpha']);

/** Tipos de registro que son un punto fijo en el paisaje. */
const FIXED_EVIDENCE: RecordType[] = ['Fecas', 'Huella', 'Madriguera', 'Cururera', 'Nido', 'Huesos', 'Egagrópila', 'Muda', 'Plumas'];

export function mobilityOf(taxon: Taxon | null | undefined): Mobility {
  if (!taxon) return 'desconocida';
  switch (taxon.group) {
    case 'reptiles':
    case 'anfibios':
      return 'baja';
    case 'aves':
      return 'alta';
    case 'mamiferos':
      // Un ratón se registra donde estaba; un puma o un guanaco, no.
      return taxon.order && LOW_MOBILITY_ORDERS.has(taxon.order) ? 'baja' : 'alta';
    default:
      return 'desconocida';
  }
}

export interface LocationFixNeed {
  required: boolean;
  /** Por qué, en palabras que el usuario entienda en la tarjeta. */
  reason: string | null;
}

export function locationFixNeed(
  taxon: Taxon | null | undefined,
  recordType: RecordType | null | undefined,
): LocationFixNeed {
  if (levelOf(taxon?.conservation) === 'amenazada') {
    return { required: true, reason: 'especie en categoría de conservación' };
  }
  if (recordType && FIXED_EVIDENCE.includes(recordType)) {
    return { required: true, reason: `${recordType.toLowerCase()}: la evidencia queda en un punto fijo` };
  }
  if (mobilityOf(taxon) === 'baja') {
    return { required: true, reason: 'especie de baja movilidad' };
  }
  return { required: false, reason: null };
}

/** ¿Conviene sugerir una fotografía? Mismo criterio, más la duda de identificación. */
export function suggestsPhoto(
  taxon: Taxon | null | undefined,
  recordType: RecordType | null | undefined,
  confidence?: string | null,
): boolean {
  if (levelOf(taxon?.conservation) === 'amenazada') return true;
  if (confidence && confidence !== 'seguro') return true;
  if (recordType && FIXED_EVIDENCE.includes(recordType)) return true;
  return false;
}
