/**
 * Perfiles de requisitos: QUÉ campos se piden, por proyecto y por metodología.
 *
 * Es configuración, no código (brief §8): un perfil es un objeto JSON que se
 * descarga con el resto de los catálogos y se puede editar desde la app sin
 * recompilar. `overridesByMethod` permite, por ejemplo, que tránsito aéreo
 * exija altura y dirección de vuelo mientras que un transecto no las mencione.
 */
import type { MethodCode } from '../domain/types';

/** Campos sobre los que se puede exigir algo. Sólo campos que el usuario aporta. */
export type RequirableField =
  | 'eventDate' | 'eventTime' | 'station' | 'method' | 'recordedBy' | 'weather'
  | 'taxon' | 'recordType' | 'individualCount' | 'sex' | 'lifeStage'
  | 'organismCondition' | 'behaviour' | 'notes' | 'photos'
  | 'occurrenceCoordinates' | 'flightDirection' | 'flightHeight' | 'flightOrigin'
  | 'flightDestination' | 'playbackResponse'
  | 'effort' | 'conditions' | 'detectionDistance' | 'organismId';

export type Requirement = 'required' | 'recommended' | 'optional' | 'hidden';

export interface RequirementProfile {
  id: string;
  name: string;
  description?: string;
  /** Requisito por defecto para cualquier campo no listado. */
  fallback: Requirement;
  fields: Partial<Record<RequirableField, Requirement>>;
  /** Ajustes por metodología; se aplican sobre `fields`. */
  overridesByMethod?: Partial<Record<MethodCode, Partial<Record<RequirableField, Requirement>>>>;
  /**
   * Ajustes por grupo taxonómico. Permite pedir sexo sólo donde es observable
   * (p. ej. aves con dimorfismo) sin molestar en anfibios.
   */
  overridesByGroup?: Partial<Record<'aves' | 'mamiferos' | 'reptiles' | 'anfibios' | 'otros', Partial<Record<RequirableField, Requirement>>>>;
  /** Ajustes por tipo de registro: la evidencia indirecta no lleva abundancia. */
  overridesByRecordType?: Record<string, Partial<Record<RequirableField, Requirement>>>;
}

/**
 * Perfil por defecto, derivado de lo que la planilla realmente exigía:
 * las columnas blancas eran de ingreso obligatorio y las naranjas se
 * autocompletaban con fórmulas (por eso no aparecen aquí).
 */
export const DEFAULT_PROFILE: RequirementProfile = {
  id: 'linea-base-fauna',
  name: 'Línea base de fauna',
  description: 'Perfil general para línea base: pide lo que el observador aporta y nada de lo que se deriva del catálogo.',
  fallback: 'optional',
  fields: {
    eventDate: 'required',
    eventTime: 'required',
    station: 'required',
    method: 'required',
    taxon: 'required',
    recordType: 'required',
    individualCount: 'required',
    recordedBy: 'recommended',
    weather: 'recommended',
    behaviour: 'recommended',
    sex: 'optional',
    lifeStage: 'optional',
    organismCondition: 'optional',
    photos: 'optional',
    occurrenceCoordinates: 'optional',
    notes: 'optional',
    // El esfuerzo NO se exige. El uso normal es "EMF44 y las especies, después
    // EMF55 y más especies", sin abrir ni cerrar nada. Medirlo es una decisión
    // del usuario ("iniciar track"), y sólo entonces la app lo revisa.
    effort: 'optional',
    conditions: 'optional',
    detectionDistance: 'hidden',
    organismId: 'hidden',
    // Campos de tránsito aéreo: ocultos salvo que la metodología los active.
    flightDirection: 'hidden',
    flightHeight: 'hidden',
    flightOrigin: 'hidden',
    flightDestination: 'hidden',
    playbackResponse: 'hidden',
  },
  overridesByMethod: {
    transecto: {
      station: 'required', taxon: 'required', individualCount: 'required',
      recordType: 'required', eventTime: 'required', recordedBy: 'required',
    },
    playback_aves: {
      taxon: 'required', playbackResponse: 'required', recordType: 'required',
      individualCount: 'required', eventTime: 'required',
    },
    playback_anfibios: {
      taxon: 'required', playbackResponse: 'required', recordType: 'required',
      individualCount: 'required', eventTime: 'required',
    },
    transito_aereo: {
      taxon: 'required', individualCount: 'required', sex: 'recommended',
      flightDirection: 'required', flightHeight: 'required',
      flightOrigin: 'recommended', flightDestination: 'recommended',
      behaviour: 'recommended', recordType: 'optional',
    },
    camara_trampa: {
      taxon: 'required', eventDate: 'required', eventTime: 'required',
      individualCount: 'required', photos: 'required', recordType: 'recommended',
      // La foto permite describir conducta y edad, igual que un avistamiento.
      behaviour: 'recommended', lifeStage: 'recommended',
    },
    trampa_sherman: {
      taxon: 'required', individualCount: 'required', sex: 'recommended',
      lifeStage: 'recommended', occurrenceCoordinates: 'recommended',
      // En trampeo el individuo se marca: sin código no hay recaptura.
      organismId: 'recommended',
    },
    punto_conteo: {
      taxon: 'required', individualCount: 'required', recordType: 'required',
      // Un punto de conteo sin distancia no permite estimar densidad.
      detectionDistance: 'recommended', conditions: 'recommended',
    },
    registro_oportunista: {
      // Fuera de estación la coordenada es lo único que ubica el registro.
      taxon: 'required', occurrenceCoordinates: 'required',
      station: 'optional', individualCount: 'recommended',
    },
    songmeter: { taxon: 'required', recordType: 'required', individualCount: 'recommended' },
    atropello: {
      taxon: 'required', organismCondition: 'required',
      occurrenceCoordinates: 'required', photos: 'recommended',
    },
  },
  /**
   * El tipo de registro dice por qué canal se detectó al animal, y eso decide
   * qué se puede saber de él. Si sólo lo oíste, no puedes decir si era juvenil
   * ni qué estaba haciendo aparte de cantar: pedirlo es inventar o molestar.
   */
  overridesByRecordType: {
    // --- Visto: se puede describir lo que hacía y qué edad aparentaba ---
    Individuo: { behaviour: 'recommended', lifeStage: 'recommended', sex: 'optional' },

    // --- Sólo oído: la vocalización ES la conducta; el resto no se ve ---
    Vocalización: { behaviour: 'hidden', lifeStage: 'hidden', sex: 'hidden' },
    'Registro de audio': {
      behaviour: 'hidden', lifeStage: 'hidden', sex: 'hidden',
      individualCount: 'recommended',
    },

    // --- Evidencia indirecta: no hay animal que observar, sólo su rastro ---
    Fecas: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Huella: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Plumas: { individualCount: 'optional', sex: 'optional', lifeStage: 'hidden', behaviour: 'hidden' },
    Madriguera: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Cururera: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Huesos: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Muda: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Nido: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
    Egagrópila: { individualCount: 'optional', sex: 'hidden', lifeStage: 'hidden', behaviour: 'hidden' },
  },
};

/** Perfil mínimo para registro rápido: sólo lo indispensable para no perder el dato. */
export const MINIMAL_PROFILE: RequirementProfile = {
  id: 'minimo',
  name: 'Mínimo (registro rápido)',
  fallback: 'optional',
  fields: { eventDate: 'required', eventTime: 'required', station: 'required', taxon: 'required' },
};

/**
 * Perfil exigente para especies en categoría de conservación. No reemplaza al
 * perfil del proyecto: se superpone cuando el taxón está amenazado, porque ese
 * registro es el que más se va a cuestionar en la revisión.
 */
export const THREATENED_OVERRIDE: Partial<Record<RequirableField, Requirement>> = {
  photos: 'required',
  individualCount: 'required',
  notes: 'recommended',
  // La coordenada no se decide aquí: depende de la movilidad de la especie y
  // del tipo de registro. Ver conservation/mobility.ts.
};

export const BUILTIN_PROFILES: RequirementProfile[] = [DEFAULT_PROFILE, MINIMAL_PROFILE];

/** Resuelve el requisito efectivo de un campo aplicando todos los overrides. */
export function requirementFor(
  profile: RequirementProfile,
  field: RequirableField,
  ctx: {
    method?: MethodCode | null;
    group?: string | null;
    recordType?: string | null;
    /** El taxón está en categoría de amenaza: se exige más evidencia. */
    threatened?: boolean;
  },
): Requirement {
  let value = profile.fields[field] ?? profile.fallback;
  if (ctx.group && profile.overridesByGroup?.[ctx.group as 'aves']?.[field]) {
    value = profile.overridesByGroup[ctx.group as 'aves']![field]!;
  }
  if (ctx.method && profile.overridesByMethod?.[ctx.method]?.[field]) {
    value = profile.overridesByMethod[ctx.method]![field]!;
  }
  // El tipo de registro manda por último: es el que sabe si hubo un animal.
  if (ctx.recordType && profile.overridesByRecordType?.[ctx.recordType]?.[field]) {
    value = profile.overridesByRecordType[ctx.recordType]![field]!;
  }
  // Una especie amenazada sube el listón, salvo que el tipo de registro ya
  // haya declarado el campo irrelevante (no se piden fotos de una feca... sí
  // se piden, en realidad: una feca de puma sin foto no se puede verificar).
  if (ctx.threatened && value !== 'hidden' && THREATENED_OVERRIDE[field]) {
    value = strongest(value, THREATENED_OVERRIDE[field]!);
  }
  return value;
}

const RANK: Record<Requirement, number> = { hidden: 0, optional: 1, recommended: 2, required: 3 };
const strongest = (a: Requirement, b: Requirement): Requirement => (RANK[a] >= RANK[b] ? a : b);
