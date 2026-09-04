/**
 * Parser de lenguaje natural para observaciones de fauna en español de terreno.
 *
 * Idea central: no hay sintaxis obligatoria. El texto se corta en fragmentos
 * por comas/"y"/puntos; un fragmento que contiene un taxón abre una
 * observación nueva y los fragmentos sin taxón se pegan como atributos de la
 * observación anterior (o al contexto común, si aún no hay ninguna).
 *
 * Eso es lo que permite que "Tres rayaditos, picaflor chico macho, una loica
 * alimentándose" produzca tres registros y que "Dos tiuques volando hacia el
 * norte, altura veinte metros" produzca uno solo.
 */
import type {
  AerialTransit, AttributeScope, IdentificationConfidence, LifeStage, MethodCode,
  OrganismCondition, RecordType, Sex,
} from '../domain/types';
import {
  INDIRECT_RECORD_TYPES, DEFAULT_LEXICONS, SLOPE_TERMS, SLOPE_TRIGGERS,
  type LexEntry, type Lexicons,
} from './lexicon';
import { readNumber } from './numbers';
import type { TaxonIndex, TaxonMatch } from './taxonIndex';
import { fold } from './text';

export interface ParsedObservation {
  taxonIds: string[];
  taxonNeedsDisambiguation: boolean;
  /** Texto plegado que se reconoció como especie (o el crudo si no se resolvió). */
  verbatimTaxonText: string | null;
  taxonCorrectedFrom?: string;
  recordType: RecordType | null;
  /** true si el tipo de registro lo asumió el parser y no lo dijo el usuario. */
  recordTypeInferred: boolean;
  evidenceKind: 'Directo' | 'Indirecto' | null;
  individualCount: number | null;
  /** true si la cantidad la puso el parser por defecto y no el usuario. */
  countInferred: boolean;
  sex: Sex | null;
  sexScope: AttributeScope;
  lifeStage: LifeStage | null;
  lifeStageScope: AttributeScope;
  organismCondition: OrganismCondition | null;
  behaviour: string | null;
  aerial: AerialTransit | null;
  /** 'posible'/'probable' cuando el usuario dudó en voz alta. */
  identificationConfidence: IdentificationConfidence;
  /** Distancia perpendicular de detección, en metros. */
  detectionDistanceMeters: number | null;
  /** Trampa concreta donde cayó el animal, en trampeo Sherman ("trampa 11"). */
  trapNumber: string | null;
  notes: string | null;
  confidence: number;
  /** Fragmento original que originó esta observación. */
  verbatim: string;
  /** Tokens que el parser no supo interpretar. */
  unparsed: string[];
}

/**
 * Cabecera del punto: lo que el técnico anotaba a mano al llegar
 * ("EMF40, hora de inicio, inclinación plano-este-oeste, soleado").
 * No es un registro de fauna, es el encabezado del muestreo.
 */
export interface ParsedHeader {
  /** Dijo "hora de inicio": está abriendo el punto, no registrando una especie. */
  opensPoint: boolean;
  weather: string | null;
  slopeAspect: string | null;
}

export interface ParsedUtterance {
  raw: string;
  /** Contexto común a todas las observaciones (estación y metodología dichas una vez). */
  stationCode: string | null;
  method: MethodCode | null;
  observations: ParsedObservation[];
  header: ParsedHeader;
  /**
   * Línea de trampeo, punto de playback o cámara nombrados en la frase
   * ("la línea asociada al punto 40"). Es un sitio DENTRO de la estación.
   */
  siteName: string | null;
  /** El usuario declaró explícitamente que no hubo detecciones en la estación. */
  noDetections: boolean;
  warnings: string[];
}

export interface ParseContext {
  taxonIndex: TaxonIndex;
  /** Códigos de estación conocidos, para reconocerlos aunque el STT los parta. */
  stationCodes?: string[];
  lexicons?: Lexicons;
}

const HEIGHT_TRIGGERS = ['altura', 'alto', 'altitud'];
const DISTANCE_TRIGGERS = ['distancia', 'a'];
/** Formas de decir "recorrí la estación y no vi nada". */
const NO_DETECTION_RE =
  /\b(sin registros?|sin detecciones?|no (se )?(registro|registre|detecto|detecte|hubo|vi|observe)( nada| registros?| especies?)?|nada que registrar|estacion vacia|cero registros?)\b/;
const ORIGIN_TRIGGERS = ['desde', 'proveniente', 'viene', 'origen'];
const TRAP_TRIGGERS = ['trampa', 'trampas'];
const LINE_TRIGGERS = ['linea', 'lineas', 'transecta'];
/** Palabras de relleno entre "línea" y su identificador ("la línea asociada al punto 40"). */
const SITE_FILLERS = [
  'asociada', 'asociado', 'asociadas', 'asociados', 'correspondiente', 'numero', 'n',
  'a', 'al', 'la', 'el', 'de', 'del', 'los', 'las', 'punto', 'pto', 'estacion',
];
/** Formas de decir "estoy abriendo este punto". */
const POINT_START_LEXICON: Array<LexEntry<true>> = [
  { phrases: [
    'hora de inicio', 'hora inicio', 'inicio de punto', 'inicio del punto',
    'inicio de estacion', 'inicio de muestreo', 'abro el punto', 'abrir punto',
    'abriendo punto', 'partida del punto',
  ], value: true },
];
const DEST_TRIGGERS = ['hacia', 'rumbo', 'hasta', 'destino', 'direccion'];

/**
 * Corta el texto en fragmentos conservando el original de cada uno.
 * Antes de cortar se neutralizan los puntos que NO separan ideas: la
 * abreviatura del género ("S. rubecula") y el separador decimal ("1,5 m").
 */
function splitChunks(raw: string): string[] {
  const protectedText = raw
    .replace(/\b([A-Za-zÀ-ÿ])\.\s*/g, '$1 ')
    .replace(/(\d)[.,](\d)/g, '$1·$2');
  return protectedText
    .split(/[,;.\n]+|\s+\by\b\s+|\s+\be\b\s+/i)
    .map((s) => s.replace(/·/g, '.').trim())
    .filter(Boolean);
}

function emptyObservation(verbatim: string): ParsedObservation {
  return {
    taxonIds: [], taxonNeedsDisambiguation: false, verbatimTaxonText: null,
    recordType: null, recordTypeInferred: false, evidenceKind: null, individualCount: null, countInferred: false,
    sex: null, sexScope: 'sin_definir', lifeStage: null, lifeStageScope: 'sin_definir',
    organismCondition: null, behaviour: null, aerial: null,
    identificationConfidence: 'seguro', detectionDistanceMeters: null, trapNumber: null, notes: null,
    confidence: 0, verbatim, unparsed: [],
  };
}

/** Busca la frase más larga de un léxico que empiece en `start`. */
function matchLexicon<T>(
  entries: Array<LexEntry<T>>, tokens: string[], start: number,
): { value: T; length: number; entry: LexEntry<T> } | null {
  let best: { value: T; length: number; entry: LexEntry<T> } | null = null;
  for (const entry of entries) {
    for (const phrase of entry.phrases) {
      const words = phrase.split(' ');
      if (words.length > tokens.length - start) continue;
      let ok = true;
      for (let i = 0; i < words.length; i++) {
        if (tokens[start + i] !== words[i]) { ok = false; break; }
      }
      if (ok && (!best || words.length > best.length)) {
        best = { value: entry.value, length: words.length, entry };
      }
    }
  }
  return best;
}

function normalizeStationCode(code: string): string {
  return fold(code).replace(/\s+/g, '');
}

export function parseUtterance(raw: string, ctx: ParseContext): ParsedUtterance {
  const lex = ctx.lexicons ?? DEFAULT_LEXICONS;
  const stationSet = new Map((ctx.stationCodes ?? []).map((c) => [normalizeStationCode(c), c]));
  const reserved = reservedWords(lex);
  const result: ParsedUtterance = {
    raw, stationCode: null, method: null, observations: [],
    header: { opensPoint: false, weather: null, slopeAspect: null },
    siteName: null,
    noDetections: false, warnings: [],
  };

  // "Sin registros en EMF09" es un dato de ausencia, no una frase vacía.
  if (NO_DETECTION_RE.test(fold(raw))) result.noDetections = true;

  for (const chunk of splitChunks(raw)) {
    const tokens = fold(chunk).split(' ').filter(Boolean);
    if (!tokens.length) continue;

    // ¿Este fragmento abre una observación nueva? Sólo si nombra un taxón.
    // Si no nombra ninguna, es continuación de la anterior; y si todavía no
    // hay ninguna, es contexto común (estación, metodología dichas al inicio).
    const taxonHit = findTaxon(tokens, ctx.taxonIndex, reserved);
    const previous = result.observations[result.observations.length - 1] ?? null;
    const target = taxonHit ? null : previous;

    const obs = target ?? emptyObservation(chunk);
    if (!target) {
      if (taxonHit) {
        obs.taxonIds = taxonHit.match.taxonIds;
        obs.taxonNeedsDisambiguation = taxonHit.match.ambiguous;
        obs.verbatimTaxonText = taxonHit.match.matchedKey;
        if (taxonHit.match.correctedFrom) obs.taxonCorrectedFrom = taxonHit.match.correctedFrom;
        obs.confidence = taxonHit.match.confidence;
      }
    } else {
      obs.verbatim += `, ${chunk}`;
    }

    applyTokens(tokens, obs, result, {
      lex, stationSet, taxonSpan: taxonHit ? [taxonHit.start, taxonHit.start + taxonHit.match.length] : null,
    });

    if (!target) {
      if (taxonHit) result.observations.push(obs);
      // Sin taxón y sin observación previa: el fragmento es contexto común
      // (estación, metodología). Sus atributos ya se aplicaron a `result`.
      // Si la frase declaraba una ausencia, lo no interpretado son justamente
      // las palabras de esa declaración: avisar sería ruido.
      else if (obs.unparsed.length && !result.noDetections) {
        result.warnings.push(`No se interpretó: "${chunk}"`);
      }
    }
  }

  for (const obs of result.observations) finalize(obs);
  // Abrir el punto no es un registro fallido: si la frase era la cabecera,
  // reclamar una especie que nadie nombró sólo estorba.
  const isHeaderOnly = result.header.opensPoint
    || result.header.weather !== null || result.header.slopeAspect !== null;
  if (!result.observations.length && !result.noDetections && !isHeaderOnly) {
    result.warnings.push('No se reconoció ninguna especie en el dictado.');
  }
  return result;
}

/**
 * Palabras de una sola pieza que el dictado ya usa para otra cosa ("posado",
 * "vocalizando", "nublado"). Si una de ellas aparece también dentro del nombre
 * de una especie, no puede servir para nombrarla: se perdería el atributo.
 */
const reservedCache = new WeakMap<Lexicons, Set<string>>();
function reservedWords(lex: Lexicons): Set<string> {
  const cached = reservedCache.get(lex);
  if (cached) return cached;
  const out = new Set<string>(FILLERS);
  for (const entries of Object.values(lex) as Array<Array<LexEntry<unknown>>>) {
    for (const entry of entries) {
      for (const phrase of entry.phrases) if (!phrase.includes(' ')) out.add(phrase);
    }
  }
  for (const word of [...SLOPE_TRIGGERS, ...Object.keys(SLOPE_TERMS), ...HEIGHT_TRIGGERS,
    ...ORIGIN_TRIGGERS, ...DEST_TRIGGERS]) out.add(word);
  reservedCache.set(lex, out);
  return out;
}

/**
 * Cuatro pasadas sobre todo el fragmento, en orden de certeza: nombre exacto,
 * nombre genérico ("golondrina" -> las golondrinas del catálogo), palabra
 * distintiva ("olivaceo" -> Ratón oliváceo) y por último corrección
 * ortográfica. Si no fuera en ese orden, "dos tiuques" podría resolverse por
 * parecido antes de llegar a "tiuque", que está bien escrito.
 */
function findTaxon(
  tokens: string[], index: TaxonIndex, reserved: Set<string>,
): { start: number; match: TaxonMatch } | null {
  const passes = [
    (i: number) => index.matchExactAt(tokens, i),
    (i: number) => index.matchPrefixAt(tokens, i),
    (i: number) => index.matchWordAt(tokens, i, reserved),
    (i: number) => index.matchFuzzyAt(tokens, i),
  ];
  for (const pass of passes) {
    for (let i = 0; i < tokens.length; i++) {
      const m = pass(i);
      if (m) return { start: i, match: m };
    }
  }
  return null;
}

interface ApplyOpts {
  lex: Lexicons;
  stationSet: Map<string, string>;
  taxonSpan: [number, number] | null;
}

function applyTokens(tokens: string[], obs: ParsedObservation, utt: ParsedUtterance, opts: ApplyOpts): void {
  const { lex, stationSet, taxonSpan } = opts;
  let i = 0;
  let pendingRole: 'origin' | 'destination' | null = null;

  while (i < tokens.length) {
    if (taxonSpan && i >= taxonSpan[0] && i < taxonSpan[1]) { i = taxonSpan[1]; continue; }
    const t = tokens[i];

    // --- estación: código conocido, o letras + dígitos que el STT separó ---
    const station = readStation(tokens, i, stationSet);
    if (station) {
      utt.stationCode = station.code;
      if (!station.known && stationSet.size) {
        utt.warnings.push(`La estación "${station.code}" no está en el catálogo del proyecto.`);
      }
      i += station.length;
      continue;
    }

    // --- distancia de detección: "a veinte metros", "distancia 15 metros" ---
    if (DISTANCE_TRIGGERS.includes(t)) {
      const after = skipFiller(tokens, i + 1, ['de', 'unos', 'aproximadamente']);
      const num = readNumber(tokens, after);
      const unit = tokens[after + (num?.length ?? 0)];
      if (num && (unit === 'metros' || unit === 'metro' || unit === 'm')) {
        obs.detectionDistanceMeters = num.value;
        i = after + num.length + 1;
        continue;
      }
    }

    // --- altura de vuelo: "altura veinte metros", "altura 3" ---
    if (HEIGHT_TRIGGERS.includes(t)) {
      const after = skipFiller(tokens, i + 1, ['de', 'vuelo', 'del']);
      const num = readNumber(tokens, after);
      if (num) {
        const unitIdx = after + num.length;
        const unit = tokens[unitIdx];
        const aerial = (obs.aerial ??= {});
        if (unit === 'metros' || unit === 'm' || unit === 'metro') {
          aerial.flightHeightMeters = num.value;
          i = unitIdx + 1;
        } else if (num.value >= 1 && num.value <= 5) {
          // La planilla usa categorías 1-5; un número pequeño sin unidad es categoría.
          aerial.flightHeightCategory = String(num.value);
          i = unitIdx;
        } else {
          aerial.flightHeightMeters = num.value;
          i = unitIdx;
        }
        continue;
      }
    }

    // --- cabecera del punto: apertura, ladera y clima ---
    const opens = matchLexicon(POINT_START_LEXICON, tokens, i);
    if (opens) { utt.header.opensPoint = true; i += opens.length; continue; }

    // La ladera se dicta encadenada ("plano-este-oeste"), así que se lee antes
    // que el rumbo: si no, "este" y "oeste" se irían al vuelo del ave.
    if (SLOPE_TRIGGERS.includes(t)) {
      const slope = readSlope(tokens, i);
      if (slope) { utt.header.slopeAspect = slope.value; i = slope.next; continue; }
      i++;
      continue;
    }

    const weather = matchLexicon(lex.weather, tokens, i);
    if (weather) { utt.header.weather = weather.value; i += weather.length; continue; }

    // --- trampeo: la trampa concreta y la línea a la que pertenece ---
    // Si lo que sigue no es un identificador, no se consume nada: así
    // "trampa sherman" sigue leyéndose como metodología más abajo.
    if (TRAP_TRIGGERS.includes(t)) {
      const after = skipFiller(tokens, i + 1, SITE_FILLERS);
      const code = readSiteCode(tokens, after);
      if (code) { obs.trapNumber = code.value; i = after + code.length; continue; }
    }
    if (LINE_TRIGGERS.includes(t)) {
      const after = skipFiller(tokens, i + 1, SITE_FILLERS);
      const code = readSiteCode(tokens, after);
      if (code) { utt.siteName = `Línea ${code.value}`; i = after + code.length; continue; }
    }

    if (ORIGIN_TRIGGERS.includes(t)) { pendingRole = 'origin'; i++; continue; }
    if (DEST_TRIGGERS.includes(t)) { pendingRole = 'destination'; i++; continue; }

    // --- dirección cardinal ---
    const dir = matchLexicon(lex.direction, tokens, i);
    // "este" es también demostrativo: sólo vale como rumbo si algo lo introduce
    // ("hacia el este"). "oeste", "norte" y "sur" no son ambiguos.
    if (dir && !(tokens[i] === 'este' && pendingRole === null)) {
      const aerial = (obs.aerial ??= {});
      if (pendingRole === 'origin') aerial.origin = dir.value;
      else {
        aerial.destination = dir.value;
        aerial.flightDirection = dir.value;
      }
      pendingRole = null;
      i += dir.length;
      continue;
    }

    // --- metodología (contexto común, no de la observación) ---
    const method = matchLexicon(lex.method, tokens, i);
    if (method) { utt.method = method.value; i += method.length; continue; }

    // --- tipo de registro / evidencia ---
    const rt = matchLexicon(lex.recordType, tokens, i);
    if (rt) {
      obs.recordType = rt.value;
      obs.recordTypeInferred = false;
      // "cantando" es a la vez tipo de registro y comportamiento (así lo usa la planilla).
      const asBehaviour = matchLexicon(lex.behaviour, tokens, i);
      if (asBehaviour && !obs.behaviour) obs.behaviour = asBehaviour.value;
      i += rt.length;
      continue;
    }

    const conf = matchLexicon(lex.confidence, tokens, i);
    if (conf) { obs.identificationConfidence = conf.value; i += conf.length; continue; }

    const sex = matchLexicon(lex.sex, tokens, i);
    if (sex) { obs.sex = sex.value; i += sex.length; continue; }

    const stage = matchLexicon(lex.lifeStage, tokens, i);
    if (stage) { obs.lifeStage = stage.value; i += stage.length; continue; }

    const cond = matchLexicon(lex.condition, tokens, i);
    if (cond) { obs.organismCondition = cond.value; i += cond.length; continue; }

    const beh = matchLexicon(lex.behaviour, tokens, i);
    if (beh) { obs.behaviour = beh.value; i += beh.length; continue; }

    // --- cantidad ---
    const num = readNumber(tokens, i);
    if (num) {
      obs.individualCount = num.value;
      obs.countInferred = false;
      i += num.length;
      continue;
    }

    if (!FILLERS.has(t)) obs.unparsed.push(t);
    i++;
  }
}

const FILLERS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'unos', 'unas', 'con', 'en', 'a', 'al',
  'y', 'e', 'o', 'u', 'que', 'se', 'su', 'sus', 'aproximadamente', 'como', 'mas',
  'menos', 'sobre', 'estacion', 'punto', 'especie', 'registro', 'registros',
  'encontre', 'vi', 'escuche', 'observe', 'hay', 'habia', 'tengo', 'anote',
  'individuo', 'individuos', 'metros', 'metro', 'm', 'vuelo', 'sexo', 'edad',
  'este', 'esta', 'ese', 'esa',
]);

function skipFiller(tokens: string[], from: number, words: string[]): number {
  let i = from;
  while (i < tokens.length && words.includes(tokens[i])) i++;
  return i;
}

/**
 * Reconoce la estación por el catálogo y, si no calza, por el patrón
 * "letras + dígitos". Un código que suena a estación pero no está en el
 * catálogo se captura igual y se avisa: perderlo en silencio sería peor.
 */
function readStation(
  tokens: string[], i: number, stations: Map<string, string>,
): { code: string; length: number; known: boolean } | null {
  const one = stations.get(tokens[i]);
  if (one) return { code: one, length: 1, known: true };
  const two = stations.get(tokens[i] + (tokens[i + 1] ?? ''));
  if (two) return { code: two, length: 2, known: true };

  if (/^[a-z]{2,5}\d{1,3}$/.test(tokens[i])) {
    return { code: tokens[i].toUpperCase(), length: 1, known: false };
  }
  if (/^[a-z]{2,5}$/.test(tokens[i]) && /^\d{1,3}$/.test(tokens[i + 1] ?? '')) {
    return { code: (tokens[i] + tokens[i + 1]).toUpperCase(), length: 2, known: false };
  }
  return null;
}

/**
 * Identificador de una trampa o de una línea: un número ("once", "11") o un
 * código corto ("a3", "l2"). No acepta palabras sueltas: "trampa sherman" no
 * nombra ninguna trampa.
 */
function readSiteCode(tokens: string[], at: number): { value: string; length: number } | null {
  const num = readNumber(tokens, at);
  if (num) return { value: String(num.value), length: num.length };
  const token = tokens[at];
  if (token && /^[a-z]{1,3}\d{1,3}$/.test(token)) return { value: token.toUpperCase(), length: 1 };
  return null;
}

/**
 * Lee la ladera de exposición a partir de su palabra guía. Encadena los
 * términos que vengan seguidos, tal como se dicen: "inclinación plano este
 * oeste" -> "Plano-Este-Oeste". Se detiene en la primera palabra que no
 * describe la ladera, para no tragarse el resto de la frase.
 */
function readSlope(tokens: string[], at: number): { value: string; next: number } | null {
  const parts: string[] = [];
  if (tokens[at] === 'ladera') parts.push('Ladera');
  let i = skipFiller(tokens, at + 1, ['de', 'del', 'la', 'el', 'en', 'hacia']);
  while (i < tokens.length) {
    const term = SLOPE_TERMS[tokens[i]];
    if (!term) break;
    if (!parts.includes(term)) parts.push(term);
    i++;
    // "plano - este - oeste" llega sin guiones tras plegar; los conectores
    // intermedios se saltan para que la cadena no se corte.
    i = skipFiller(tokens, i, ['y', 'e', 'a']);
  }
  if (!parts.length) return null;
  return { value: parts.join('-'), next: i };
}

/** Reglas que sólo pueden aplicarse cuando ya se leyó toda la observación. */
function finalize(obs: ParsedObservation): void {
  if (!obs.recordType) {
    // Sin evidencia explícita se asume individuo observado, pero queda marcado
    // como inferido: el motor de validación decide si hay que preguntarlo
    // (brief §35, caso 6) en vez de dar el dato por bueno.
    obs.recordType = 'Individuo';
    obs.recordTypeInferred = true;
    obs.confidence = Math.min(obs.confidence, 0.8);
  }
  obs.evidenceKind = INDIRECT_RECORD_TYPES.includes(obs.recordType) ? 'Indirecto' : 'Directo';

  const countsIndividuals = obs.evidenceKind === 'Directo';
  if (obs.individualCount === null && countsIndividuals) {
    obs.individualCount = 1;
    obs.countInferred = true;
  }
  if (!countsIndividuals && obs.individualCount === null) {
    // "Fecas de puma" no son un individuo: la abundancia queda nula a propósito.
    obs.countInferred = false;
  }

  // Un atributo individual declarado sobre un grupo es ambiguo (brief §10).
  const many = (obs.individualCount ?? 0) > 1;
  obs.sexScope = obs.sex && obs.sex !== 'Indeterminado' ? (many ? 'sin_definir' : 'todos') : 'sin_definir';
  obs.lifeStageScope = obs.lifeStage && obs.lifeStage !== 'Indeterminado' ? (many ? 'sin_definir' : 'todos') : 'sin_definir';

  if (obs.unparsed.length) obs.notes = obs.unparsed.join(' ');
  if (!obs.taxonIds.length) obs.confidence = 0;
}
