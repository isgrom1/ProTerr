/**
 * Categorías de conservación y datos sensibles.
 *
 * Encontrar una especie amenazada cambia el informe y, en Chile, puede activar
 * obligaciones legales. El técnico tiene que enterarse **en el momento del
 * registro**, no tres semanas después en gabinete: si hay que tomar una foto o
 * anotar coordenadas exactas, es ahora o nunca.
 *
 * La app NUNCA inventa una categoría. Si el catálogo no trae clasificación,
 * dice "sin clasificar" y muestra de qué lista viene lo que sí trae.
 */
import type { ConservationStatus, Taxon } from '../domain/types';

/** Categorías del Reglamento de Clasificación de Especies (RCE) y de UICN. */
export const THREAT_ORDER = ['EX', 'EW', 'RE', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE'] as const;
export type ThreatCategory = (typeof THREAT_ORDER)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  EX: 'Extinta', EW: 'Extinta en estado silvestre', RE: 'Extinta regionalmente',
  CR: 'En peligro crítico', EN: 'En peligro', VU: 'Vulnerable',
  NT: 'Casi amenazada', LC: 'Preocupación menor', DD: 'Datos insuficientes',
  NE: 'No evaluada',
};

/** Categorías que en la práctica obligan a documentar mejor el registro. */
const THREATENED = new Set(['EX', 'EW', 'RE', 'CR', 'EN', 'VU']);
const NEAR = new Set(['NT']);

export type ConservationLevel =
  /** Amenazada: CR, EN, VU (o extinta). Exige evidencia y coordenada exacta. */
  | 'amenazada'
  /** Casi amenazada. Se avisa, sin exigir. */
  | 'casi-amenazada'
  /** Clasificada como preocupación menor o datos insuficientes. */
  | 'sin-riesgo'
  /** El catálogo no trae clasificación. NO significa "sin riesgo". */
  | 'sin-clasificar';

export function levelOf(status: ConservationStatus | null | undefined): ConservationLevel {
  const cat = (status?.rce ?? status?.iucn ?? '').toUpperCase().trim();
  if (!cat) return 'sin-clasificar';
  if (THREATENED.has(cat)) return 'amenazada';
  if (NEAR.has(cat)) return 'casi-amenazada';
  return 'sin-riesgo';
}

export interface ConservationFlag {
  level: ConservationLevel;
  /** Etiqueta corta para la tarjeta, p. ej. "EN · En peligro (RCE)". */
  badge: string | null;
  /** Frase completa con la fuente, para que nadie confíe a ciegas. */
  detail: string | null;
  /** Atributos que también conviene mostrar: endémica, exótica, migratoria. */
  traits: string[];
  /** La localidad exacta no debería publicarse tal cual. */
  sensitiveLocation: boolean;
}

/**
 * Una especie exótica invasora también importa en una línea base, aunque no
 * esté amenazada: se informa aparte y a veces obliga a acciones de manejo.
 */
export function flagFor(taxon: Taxon | null | undefined): ConservationFlag {
  const status = taxon?.conservation ?? null;
  const level = levelOf(status);
  const cat = (status?.rce ?? status?.iucn ?? '').toUpperCase().trim();
  const scheme = status?.rce ? 'RCE' : status?.iucn ? 'UICN' : null;

  const traits: string[] = [];
  if (status?.endemic) traits.push('Endémica');
  if (status?.origin) traits.push(status.origin);
  if (status?.migratory) traits.push('Migratoria');
  if (status?.legalProtection) traits.push(status.legalProtection);

  return {
    level,
    badge: cat ? `${cat} · ${CATEGORY_LABEL[cat] ?? cat}${scheme ? ` (${scheme})` : ''}` : null,
    detail: cat
      ? `${CATEGORY_LABEL[cat] ?? cat}${status?.rceDecree ? `, ${status.rceDecree}` : ''}${status?.source ? ` · fuente: ${status.source}` : ''}`
      : null,
    traits,
    // Publicar la coordenada exacta de una especie amenazada facilita el saqueo
    // de nidos y madrigueras. El endemismo por sí solo NO lo justifica: un
    // chucao es endémico y de preocupación menor, y ocultar dónde está sólo
    // empobrece el dato. Se protege lo amenazado, y lo endémico que además
    // ya muestra algún grado de riesgo.
    sensitiveLocation: level === 'amenazada' || (Boolean(status?.endemic) && level === 'casi-amenazada'),
  };
}

export function isThreatened(taxon: Taxon | null | undefined): boolean {
  return levelOf(taxon?.conservation).startsWith('amenazada');
}

/** ¿La especie es exótica? Se informa aunque no esté amenazada. */
export function isExotic(taxon: Taxon | null | undefined): boolean {
  const origin = (taxon?.conservation?.origin ?? '').toLowerCase();
  return origin.includes('exótic') || origin.includes('exotic') || origin.includes('asilvestrad');
}

/** Cobertura de la capa de conservación: cuánto del catálogo está clasificado. */
export function coverage(taxa: Taxon[]): { total: number; classified: number; threatened: number; sources: string[] } {
  let classified = 0;
  let threatened = 0;
  const sources = new Set<string>();
  for (const t of taxa) {
    if (levelOf(t.conservation) === 'sin-clasificar') continue;
    classified++;
    if (isThreatened(t)) threatened++;
    if (t.conservation?.source) sources.add(t.conservation.source);
  }
  return { total: taxa.length, classified, threatened, sources: [...sources] };
}
