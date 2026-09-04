/**
 * Índice de búsqueda del catálogo taxonómico.
 *
 * Resuelve nombre común, nombre científico, abreviaturas ("S. rubecula"),
 * plurales y errores menores de escritura. Cuando el nombre es ambiguo NO
 * elige: devuelve todos los candidatos para que la app pregunte (brief §24).
 */
import type { Taxon } from '../domain/types';
import { editDistance, fold, singularCandidates } from './text';

export interface TaxonMatch {
  taxonIds: string[];
  /** Texto plegado que se reconoció. */
  matchedKey: string;
  /** Tokens consumidos en el segmento. */
  length: number;
  /** 1 = exacto; 0,95 = plural resuelto; <0,9 = ortografía corregida. */
  confidence: number;
  ambiguous: boolean;
  /**
   * Sólo se llena cuando hubo una CORRECCIÓN ORTOGRÁFICA, porque eso sí hay
   * que confirmarlo con el usuario. Pasar de "rayaditos" a "Rayadito" es
   * gramática, no una duda: preguntarlo sería ruido.
   */
  correctedFrom?: string;
}

export class TaxonIndex {
  private byKey = new Map<string, string[]>();
  private byId = new Map<string, Taxon>();
  /** Claves agrupadas por número de palabras, para probar n-gramas largos primero. */
  private maxWords = 1;
  private keys: string[] = [];
  /** Claves agrupadas por su primera palabra, para el match por prefijo. */
  private byFirstWord = new Map<string, string[]>();

  constructor(taxa: Taxon[]) {
    for (const t of taxa) {
      this.byId.set(t.id, t);
      for (const key of t.searchKeys) {
        if (!key) continue;
        const list = this.byKey.get(key);
        if (list) {
          if (!list.includes(t.id)) list.push(t.id);
        } else {
          this.byKey.set(key, [t.id]);
        }
        this.maxWords = Math.max(this.maxWords, key.split(' ').length);
      }
    }
    this.keys = [...this.byKey.keys()];
    for (const key of this.keys) {
      const first = key.split(' ')[0];
      const list = this.byFirstWord.get(first);
      if (list) list.push(key);
      else this.byFirstWord.set(first, [key]);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): Taxon | undefined {
    return this.byId.get(id);
  }

  all(): Taxon[] {
    return [...this.byId.values()];
  }

  /** Búsqueda incremental para el autocompletado de la UI. */
  search(query: string, limit = 12): Taxon[] {
    const q = fold(query);
    if (!q) return [];
    const scored: Array<{ t: Taxon; score: number }> = [];
    for (const t of this.byId.values()) {
      let best = Infinity;
      for (const key of t.searchKeys) {
        if (key === q) best = Math.min(best, 0);
        else if (key.startsWith(q)) best = Math.min(best, 1);
        else if (key.includes(q)) best = Math.min(best, 2);
        else if (q.length >= 4 && editDistance(key, q, 2) <= 2) best = Math.min(best, 3);
      }
      if (best < Infinity) scored.push({ t, score: best });
    }
    scored.sort((a, b) => a.score - b.score || a.t.commonName.localeCompare(b.t.commonName));
    return scored.slice(0, limit).map((s) => s.t);
  }

  /**
   * Reconocimiento exacto (o con plural resuelto) que empiece en `start`.
   * Prueba el n-grama más largo posible y sólo entonces acorta, para que
   * "picaflor chico" no se resuelva como "picaflor".
   */
  matchExactAt(tokens: string[], start: number): TaxonMatch | null {
    for (let n = Math.min(this.maxWords, tokens.length - start); n >= 1; n--) {
      const window = tokens.slice(start, start + n);
      const exact = this.byKey.get(window.join(' '));
      if (exact) {
        return { taxonIds: exact, matchedKey: window.join(' '), length: n, confidence: 1, ambiguous: exact.length > 1 };
      }
      // Plural -> singular: normalmente sólo la última palabra viene en plural
      // ("tres rayaditos", "dos tiuques"), pero probamos todas por seguridad.
      for (const variant of pluralVariants(window)) {
        const hit = this.byKey.get(variant);
        if (hit) {
          return { taxonIds: hit, matchedKey: variant, length: n, confidence: 0.95, ambiguous: hit.length > 1 };
        }
      }
    }
    return null;
  }

  /**
   * Nombre genérico: lo dicho es el comienzo del nombre de una o varias
   * especies del catálogo. En terreno se dice "tres golondrinas" sin precisar
   * cuál, y eso no debe perderse: si hay varias candidatas se devuelven todas
   * para que la app pregunte; si hay una sola, se resuelve.
   */
  matchPrefixAt(tokens: string[], start: number): TaxonMatch | null {
    for (let n = Math.min(3, tokens.length - start); n >= 1; n--) {
      const window = tokens.slice(start, start + n);
      for (const phrase of [window.join(' '), ...pluralVariants(window)]) {
        if (phrase.length < 4) continue;
        const candidates = (this.byFirstWord.get(phrase.split(' ')[0]) ?? [])
          .filter((key) => key.startsWith(`${phrase} `));
        if (!candidates.length) continue;

        const ids: string[] = [];
        for (const key of candidates) {
          for (const id of this.byKey.get(key) ?? []) if (!ids.includes(id)) ids.push(id);
        }
        if (!ids.length) continue;
        return {
          taxonIds: ids, matchedKey: phrase, length: n,
          // Una sola candidata es una abreviación segura; varias hay que preguntarlas.
          confidence: ids.length === 1 ? 0.9 : 0.7,
          ambiguous: ids.length > 1,
        };
      }
    }
    return null;
  }

  /**
   * Corrección ortográfica. Se usa como última pasada, cuando ninguna posición
   * del texto dio un match exacto ni por prefijo: si no, una palabra corriente
   * ("dos", "macho") podría ganarle a la especie que sí está escrita bien.
   */
  matchFuzzyAt(tokens: string[], start: number): TaxonMatch | null {
    for (let n = Math.min(2, tokens.length - start); n >= 1; n--) {
      const phrase = tokens.slice(start, start + n).join(' ');
      // Sólo letras: los códigos de estación ("emf09") no son especies mal escritas.
      if (phrase.length < 5 || !/^[a-z ]+$/.test(phrase)) continue;
      const maxDist = phrase.length >= 9 ? 2 : 1;
      let best: { key: string; d: number } | null = null;
      for (const key of this.keys) {
        if (Math.abs(key.length - phrase.length) > maxDist) continue;
        const d = editDistance(key, phrase, maxDist);
        if (d <= maxDist && (!best || d < best.d)) best = { key, d };
      }
      if (best) {
        const ids = this.byKey.get(best.key)!;
        return {
          taxonIds: ids, matchedKey: best.key, length: n,
          confidence: best.d === 1 ? 0.8 : 0.65, ambiguous: ids.length > 1, correctedFrom: phrase,
        };
      }
    }
    return null;
  }
}

function pluralVariants(window: string[]): string[] {
  const out = new Set<string>();
  for (let i = 0; i < window.length; i++) {
    for (const cand of singularCandidates(window[i])) {
      if (cand === window[i]) continue;
      const copy = [...window];
      copy[i] = cand;
      out.add(copy.join(' '));
    }
  }
  // Todas en singular a la vez ("tres ratones grandes" -> "raton grande").
  const allSingular = window.map((w) => singularCandidates(w).at(-1) ?? w).join(' ');
  out.add(allSingular);
  return [...out];
}
