/**
 * Léxico de terreno: cómo habla realmente un técnico y a qué campo del modelo
 * corresponde cada expresión.
 *
 * Es DATO, no código: se puede ampliar por proyecto sin tocar el parser
 * (ver `mergeLexicon`). Las claves están en forma plegada (sin acentos).
 */
import type {
  IdentificationConfidence, LifeStage, MethodCode, OrganismCondition, RecordType, Sex,
} from '../domain/types';

export interface LexEntry<T> {
  /** Frases plegadas; la más larga gana. */
  phrases: string[];
  value: T;
}

/**
 * Tipo de registro (dwc:basisOfRecord afinado). Ojo con el punto 25 del brief:
 * "fecas de puma" NO es un individuo, así que estas entradas también fijan si
 * la abundancia por defecto aplica o no.
 */
export const RECORD_TYPE_LEXICON: Array<LexEntry<RecordType> & { impliesIndividuals: boolean }> = [
  { phrases: ['vocalizacion', 'vocalizando', 'vocaliza', 'cantando', 'canto', 'canta', 'sonido', 'escuchado', 'escuchada', 'oido', 'solo audio', 'de oido', 'reclamo'], value: 'Vocalización', impliesIndividuals: true },
  { phrases: ['registro de audio', 'grabacion', 'grabado en audio'], value: 'Registro de audio', impliesIndividuals: false },
  { phrases: ['fecas', 'feca', 'fecal', 'excremento', 'excrementos', 'guano', 'bosta'], value: 'Fecas', impliesIndividuals: false },
  { phrases: ['huella', 'huellas', 'pisada', 'pisadas', 'rastro', 'rastros'], value: 'Huella', impliesIndividuals: false },
  { phrases: ['plumas', 'pluma'], value: 'Plumas', impliesIndividuals: false },
  { phrases: ['muda', 'exuvia'], value: 'Muda', impliesIndividuals: false },
  { phrases: ['madriguera', 'madrigueras', 'cueva'], value: 'Madriguera', impliesIndividuals: false },
  { phrases: ['cururera', 'cururo'], value: 'Cururera', impliesIndividuals: false },
  { phrases: ['huesos', 'hueso', 'craneo', 'esqueleto', 'osamenta'], value: 'Huesos', impliesIndividuals: false },
  { phrases: ['egagropila', 'egagropilas'], value: 'Egagrópila', impliesIndividuals: false },
  { phrases: ['nido', 'nidos'], value: 'Nido', impliesIndividuals: false },
  { phrases: ['individuo', 'individuos', 'visto', 'vista', 'avistado', 'avistamiento', 'observado', 'observada', 'de vista'], value: 'Individuo', impliesIndividuals: true },
];

/** Tipos de registro que son evidencia indirecta (la planilla lo resolvía con una fórmula). */
export const INDIRECT_RECORD_TYPES: RecordType[] = [
  'Fecas', 'Madriguera', 'Cururera', 'Plumas', 'Muda', 'Huesos', 'Huella', 'Nido', 'Registro de audio', 'Egagrópila',
];

export const SEX_LEXICON: Array<LexEntry<Sex>> = [
  { phrases: ['macho', 'machos', 'sexo macho'], value: 'Macho' },
  { phrases: ['hembra', 'hembras', 'sexo hembra'], value: 'Hembra' },
  { phrases: ['sexo indeterminado', 'indeterminado'], value: 'Indeterminado' },
];

export const LIFE_STAGE_LEXICON: Array<LexEntry<LifeStage>> = [
  { phrases: ['adulto', 'adultos', 'adulta', 'adultas'], value: 'Adulto' },
  { phrases: ['juvenil', 'juveniles', 'subadulto', 'inmaduro'], value: 'Juvenil' },
  { phrases: ['cria', 'crias', 'pollo', 'pollos', 'polluelo', 'cachorro', 'cachorros', 'neonato'], value: 'Cría' },
  { phrases: ['huevo', 'huevos', 'larva', 'larvas', 'renacuajo', 'renacuajos', 'postura'], value: 'Huevo/Larva' },
];

export const CONDITION_LEXICON: Array<LexEntry<OrganismCondition>> = [
  { phrases: ['muerto', 'muerta', 'cadaver', 'atropellado', 'atropellada'], value: 'Muerto' },
  { phrases: ['herido', 'herida', 'lesionado'], value: 'Herido' },
  { phrases: ['vivo', 'viva'], value: 'Vivo' },
];

/** Comportamiento: vocabulario de la planilla ampliado con las formas habladas. */
export const BEHAVIOUR_LEXICON: Array<LexEntry<string>> = [
  { phrases: ['alimentandose', 'comiendo', 'forrajeando'], value: 'Alimentándose' },
  { phrases: ['corriendo', 'caminando', 'desplazandose'], value: 'Corriendo' },
  { phrases: ['cortejo', 'en cortejo', 'cortejando'], value: 'Cortejo' },
  { phrases: ['durmiendo', 'dormido'], value: 'Durmiendo' },
  { phrases: ['en suelo', 'en el suelo'], value: 'En suelo' },
  { phrases: ['posado', 'posada', 'perchado'], value: 'Posado' },
  { phrases: ['tomando agua', 'bebiendo'], value: 'Tomando agua' },
  { phrases: ['volando', 'en vuelo', 'sobrevolando', 'planeando'], value: 'Volando' },
  { phrases: ['cazando', 'depredando'], value: 'Cazando' },
  // "vocalización" (sustantivo) describe el mismo hecho que "cantando":
  // sin esto, decir "chucao cantando" llenaba la conducta y decir
  // "chucao, vocalización" la dejaba vacía, para el mismo registro.
  { phrases: ['vocalizando', 'cantando', 'vocalizacion', 'canto', 'cantos', 'escuchado', 'escuchada'], value: 'Vocalizando' },
  { phrases: ['escondido', 'escondida', 'oculto', 'refugiado'], value: 'Escondido' },
  { phrases: ['reposando', 'descansando'], value: 'Reposando' },
  { phrases: ['agrupacion', 'en grupo', 'bandada'], value: 'Agrupación' },
  { phrases: ['nadando'], value: 'Nadando' },
];

/**
 * Confianza en la identificación. En terreno se dice "creo que era un chercán"
 * y guardarlo como chercán seguro es fabricar un dato: aquí queda registrado
 * como 'probable' y se exporta con el calificador que corresponde.
 */
export const CONFIDENCE_LEXICON: Array<LexEntry<IdentificationConfidence>> = [
  { phrases: ['posible', 'posiblemente', 'quizas', 'tal vez', 'puede ser', 'no estoy seguro', 'dudoso'], value: 'posible' },
  { phrases: ['probable', 'probablemente', 'creo que', 'creo', 'parece', 'al parecer', 'aparentemente', 'casi seguro'], value: 'probable' },
  { phrases: ['seguro', 'confirmado', 'sin duda'], value: 'seguro' },
];

export const DIRECTION_LEXICON: Array<LexEntry<string>> = [
  { phrases: ['noreste', 'nororiente'], value: 'NE' },
  { phrases: ['noroeste', 'norponiente'], value: 'NO' },
  { phrases: ['sureste', 'suroriente'], value: 'SE' },
  { phrases: ['suroeste', 'surponiente'], value: 'SO' },
  { phrases: ['norte'], value: 'N' },
  { phrases: ['sur'], value: 'S' },
  { phrases: ['este', 'oriente'], value: 'E' },
  { phrases: ['oeste', 'poniente'], value: 'O' },
];

/**
 * Clima tal como se dice al abrir el punto ("soleado", "nublado", "con
 * viento"). El valor es el que espera la planilla; las frases, las del habla.
 */
export const WEATHER_LEXICON: Array<LexEntry<string>> = [
  { phrases: ['despejado', 'cielo despejado', 'soleado', 'sol', 'con sol'], value: 'Despejado' },
  { phrases: ['parcialmente nublado', 'nubosidad parcial', 'semi nublado', 'algo nublado'], value: 'Parcialmente nublado' },
  { phrases: ['nublado', 'cubierto', 'cielo cubierto', 'nuboso'], value: 'Nublado' },
  { phrases: ['neblina', 'niebla', 'camanchaca', 'bruma'], value: 'Neblina' },
  { phrases: ['llovizna', 'garua', 'chubasco'], value: 'Llovizna' },
  { phrases: ['lluvia', 'lloviendo', 'con lluvia'], value: 'Lluvia' },
  { phrases: ['viento', 'ventoso', 'con viento'], value: 'Viento' },
];

/**
 * Términos que describen la ladera de exposición del punto. No son un léxico
 * de valor único: se encadenan tal como se dictan ("plano-este-oeste"), así
 * que aquí sólo se declara qué palabras pueden formar parte de la cadena.
 */
export const SLOPE_TERMS: Record<string, string> = {
  plano: 'Plano', llano: 'Plano', fondo: 'Fondo de quebrada', quebrada: 'Quebrada',
  cima: 'Cima', cumbre: 'Cima', ladera: 'Ladera', media: 'Media ladera',
  norte: 'Norte', sur: 'Sur', este: 'Este', oeste: 'Oeste',
  oriente: 'Este', poniente: 'Oeste',
  noreste: 'Noreste', noroeste: 'Noroeste', sureste: 'Sureste', suroeste: 'Suroeste',
};

/** Palabras que anuncian que viene la ladera de exposición. */
export const SLOPE_TRIGGERS = ['inclinacion', 'exposicion', 'ladera', 'pendiente', 'aspecto'];

/**
 * Metodologías y sus alias hablados. "LDB fauna diaria" es el nombre de la
 * actividad en terreno; se mapea a la metodología que la planilla reconoce.
 */
export const METHOD_LEXICON: Array<LexEntry<MethodCode>> = [
  { phrases: ['ldb de fauna diaria', 'ldb fauna diaria', 'fauna diaria', 'linea base diaria', 'transecto general', 'transecto'], value: 'transecto' },
  { phrases: ['playback de aves', 'playback aves', 'pb aves', 'playback'], value: 'playback_aves' },
  { phrases: ['playback de anfibios', 'playback anfibios', 'pb anfibios'], value: 'playback_anfibios' },
  { phrases: ['camara trampa', 'camaras trampa', 'trampa camara'], value: 'camara_trampa' },
  { phrases: ['trampas sherman', 'trampa sherman', 'sherman'], value: 'trampa_sherman' },
  { phrases: ['songmeter', 'song meter', 'grabadora acustica'], value: 'songmeter' },
  // El nocturno primero: la frase más larga gana, y "transito aereo nocturno"
  // no puede resolverse como el diurno por empezar igual.
  { phrases: ['transito aereo nocturno', 'monitoreo de transito aereo nocturno', 'mtan', 'visor nocturno', 'aereo nocturno'], value: 'transito_aereo_nocturno' },
  { phrases: ['transito aereo', 'transito aereo diurno', 'transito', 'ta'], value: 'transito_aereo' },
  { phrases: ['punto de conteo', 'punto conteo'], value: 'punto_conteo' },
  { phrases: ['atropello', 'atropellos', 'road kill'], value: 'atropello' },
];

/** Palabras que introducen un dato pero no son el dato (se ignoran al segmentar). */
export const FILLER_WORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'en',
  'hacia', 'para', 'por', 'a', 'al', 'que', 'se', 'su', 'sus', 'y', 'e', 'o', 'u',
  'aproximadamente', 'como', 'mas', 'menos', 'sobre', 'estacion', 'especie',
  'registro', 'encontre', 'vi', 'escuche', 'observe', 'hay', 'habia', 'tengo', 'anote',
]);

export type Lexicons = {
  recordType: typeof RECORD_TYPE_LEXICON;
  confidence: typeof CONFIDENCE_LEXICON;
  sex: typeof SEX_LEXICON;
  lifeStage: typeof LIFE_STAGE_LEXICON;
  condition: typeof CONDITION_LEXICON;
  behaviour: typeof BEHAVIOUR_LEXICON;
  direction: typeof DIRECTION_LEXICON;
  method: typeof METHOD_LEXICON;
  weather: typeof WEATHER_LEXICON;
};

export const DEFAULT_LEXICONS: Lexicons = {
  recordType: RECORD_TYPE_LEXICON,
  confidence: CONFIDENCE_LEXICON,
  sex: SEX_LEXICON,
  lifeStage: LIFE_STAGE_LEXICON,
  condition: CONDITION_LEXICON,
  behaviour: BEHAVIOUR_LEXICON,
  direction: DIRECTION_LEXICON,
  method: METHOD_LEXICON,
  weather: WEATHER_LEXICON,
};

/** Permite que un proyecto añada jerga local sin recompilar el parser. */
export function mergeLexicon<T>(base: Array<LexEntry<T>>, extra: Array<LexEntry<T>>): Array<LexEntry<T>> {
  return [...extra, ...base];
}
