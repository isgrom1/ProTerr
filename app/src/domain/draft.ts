/**
 * Borrador de observación: lo que vive en la tarjeta de confirmación entre el
 * dictado y el guardado. Es deliberadamente laxo (todo opcional) para no
 * bloquear al usuario en terreno; el motor de validación decide qué falta y
 * `commitDraft` lo convierte en Event + Occurrence normalizados.
 */
import type {
  AerialTransit, AttributeScope, IdentificationConfidence, LifeStage, MethodCode,
  OrganismCondition, RecordSource, RecordType, Sex, Uuid,
} from './types';

export interface ObservationDraft {
  /** Identidad local del borrador (se conserva al editar). */
  draftId: string;
  projectId: Uuid | null;
  campaignId: Uuid | null;
  stationId: Uuid | null;
  siteId?: Uuid | null;
  method: MethodCode | null;
  eventDate: string | null;
  eventTime: string | null;
  dateTimeEditedByUser: boolean;
  recordedBy: string | null;
  weather: string | null;
  /** Bloque horario del turno nocturno ("21:00 - 03:00"), en MTAN. */
  timeBlock: string | null;

  taxonId: string | null;
  /** Candidatos cuando el nombre común es ambiguo; la app pregunta, no elige. */
  taxonCandidates: string[];
  verbatimTaxonText: string | null;
  taxonCorrectedFrom?: string;

  recordType: RecordType | null;
  recordTypeInferred: boolean;
  individualCount: number | null;
  countInferred: boolean;
  sex: Sex | null;
  sexScope: AttributeScope;
  lifeStage: LifeStage | null;
  lifeStageScope: AttributeScope;
  organismCondition: OrganismCondition | null;
  behaviour: string | null;
  notes: string | null;
  aerial: AerialTransit | null;
  playbackResponse?: string | null;

  /** Confianza declarada: 'posible'/'probable' no se guardan como certeza. */
  identificationConfidence: IdentificationConfidence;
  /** Distancia perpendicular de detección, en metros. */
  detectionDistanceMeters: number | null;
  /** Marca o código del individuo, en trampeo y seguimiento. */
  organismId: string | null;
  /** Trampa concreta dentro de la línea, en trampeo Sherman. */
  trapNumber: string | null;
  /** Con crías, en celo, empollando. No es el estado vivo/muerto. */
  reproductiveCondition: string | null;
  /** Se está anotando después del día del avistamiento. */
  deferredEntry: boolean;
  /** Qué se decidió hacer con un registro de otro día, y por qué. */
  deferredNotice?: string | null;
  recapture: boolean | null;

  occurrenceFixRequested: boolean;
  mediaIds: Uuid[];
  source: RecordSource;
  verbatimUtterance: string | null;
  /** Campos que el usuario decidió explícitamente dejar pendientes. */
  acknowledgedPending: string[];
}

export function emptyDraft(draftId: string, source: RecordSource = 'manual'): ObservationDraft {
  return {
    draftId, projectId: null, campaignId: null, stationId: null, siteId: null,
    method: null, eventDate: null, eventTime: null, dateTimeEditedByUser: false,
    recordedBy: null, weather: null, timeBlock: null,
    taxonId: null, taxonCandidates: [], verbatimTaxonText: null,
    recordType: null, recordTypeInferred: false, individualCount: null, countInferred: false,
    sex: null, sexScope: 'sin_definir', lifeStage: null, lifeStageScope: 'sin_definir',
    organismCondition: null, behaviour: null, notes: null, aerial: null,
    identificationConfidence: 'seguro', detectionDistanceMeters: null,
    organismId: null, trapNumber: null, reproductiveCondition: null, recapture: null,
    deferredEntry: false, deferredNotice: null,
    occurrenceFixRequested: false, mediaIds: [], source, verbatimUtterance: null,
    acknowledgedPending: [],
  };
}
