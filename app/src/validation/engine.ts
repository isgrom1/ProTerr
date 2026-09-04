/**
 * Motor de validación y recordatorios.
 *
 * Dos principios del brief que aquí se hacen explícitos:
 *  - §7: faltar información NO impide guardar. Sólo hay un bloqueo real:
 *    un registro sin especie ni texto crudo no es un registro.
 *  - §9: sólo se recuerda lo que el usuario puede aportar. Nada de pedir
 *    Reino, Orden o Familia: eso se deriva del catálogo.
 */
import { locationFixNeed, suggestsPhoto } from '../conservation/mobility';
import { flagFor, isExotic } from '../conservation/status';
import type { ObservationDraft } from '../domain/draft';
import type { GeoFix, SamplingEvent, Station, Taxon } from '../domain/types';
import { distanceMeters } from '../geo/utm';
import type { EffortSummary } from '../effort/session';
import { requirementFor, type RequirableField, type RequirementProfile } from './profiles';

export type IssueSeverity =
  /** Impide guardar. Reservado para lo que hace que el registro no exista. */
  | 'blocker'
  /** Falta un campo exigido por el perfil; se guarda igual y queda pendiente. */
  | 'pending'
  /** Hay que preguntar algo para no inventar el dato. */
  | 'question'
  /** Campo recomendado ausente; se menciona una vez y no insiste. */
  | 'info';

export interface IssueOption {
  label: string;
  /** Parche que se aplica al borrador si el usuario elige esta opción. */
  patch: Partial<ObservationDraft>;
}

export type IssueLevel =
  /** Pertenece al muestreo: se pregunta una vez, no por cada observación. */
  | 'event'
  /** Pertenece a la observación concreta. */
  | 'occurrence';

export interface ValidationIssue {
  field: RequirableField | 'taxonAmbiguity' | 'sexScope' | 'lifeStageScope'
    | 'consistency' | 'conservation' | 'stationDistance';
  severity: IssueSeverity;
  level: IssueLevel;
  message: string;
  options?: IssueOption[];
}

/**
 * Campos que describen el muestreo y no la observación. Si el usuario dicta
 * tres especies seguidas, preguntarle el clima tres veces es exactamente el
 * ruido que el brief §9 pide evitar.
 */
const EVENT_FIELDS = new Set<RequirableField>(['eventDate', 'eventTime', 'station', 'method', 'recordedBy', 'weather']);

const levelOf = (field: RequirableField): IssueLevel => (EVENT_FIELDS.has(field) ? 'event' : 'occurrence');

export interface ValidationContext {
  profile: RequirementProfile;
  taxon?: Taxon | null;
  /** Metodologías habilitadas en el proyecto; se usa para avisar de incoherencias. */
  projectMethods?: string[];
  /** Resolutor de candidatos para las preguntas de desambiguación. */
  resolveTaxon?: (id: string) => Taxon | undefined;
  /** Estado del esfuerzo del muestreo en curso; se evalúa a nivel de evento. */
  effort?: EffortSummary | null;
  /** Condiciones ambientales ya registradas en el evento. */
  conditions?: SamplingEvent['conditions'];
  /** Posición actual del dispositivo y estación seleccionada, para el control de coherencia. */
  fix?: GeoFix | null;
  station?: Station | null;
  /** Estaciones del proyecto, para poder ofrecer la más cercana. */
  nearbyStations?: Station[];
}

/**
 * Distancia a partir de la cual se sospecha que el usuario ya cambió de
 * estación y olvidó actualizarla. Una estación de muestreo rara vez supera los
 * 100-150 m de extensión, así que 200 m es holgado.
 */
const STATION_DRIFT_METERS = 200;

export interface ValidationResult {
  issues: ValidationIssue[];
  canSave: boolean;
  /** Nombres de campo que quedarán marcados como pendientes en el registro. */
  pendingFields: string[];
}

/** Valor presente en el borrador para un campo requerible. */
function valueOf(draft: ObservationDraft, field: RequirableField): unknown {
  switch (field) {
    case 'eventDate': return draft.eventDate;
    case 'eventTime': return draft.eventTime;
    case 'station': return draft.stationId;
    case 'method': return draft.method;
    case 'recordedBy': return draft.recordedBy;
    case 'weather': return draft.weather;
    case 'trapNumber': return draft.trapNumber;
    case 'reproductiveCondition': return draft.reproductiveCondition;
    case 'taxon': return draft.taxonId;
    case 'recordType': return draft.recordTypeInferred ? null : draft.recordType;
    case 'individualCount': return draft.individualCount;
    case 'sex': return draft.sex;
    case 'lifeStage': return draft.lifeStage;
    case 'organismCondition': return draft.organismCondition;
    case 'behaviour': return draft.behaviour;
    case 'notes': return draft.notes;
    case 'photos': return draft.mediaIds.length ? draft.mediaIds : null;
    case 'occurrenceCoordinates': return draft.occurrenceFixRequested ? true : null;
    case 'flightDirection': return draft.aerial?.flightDirection ?? null;
    case 'flightHeight': return draft.aerial?.flightHeightMeters ?? draft.aerial?.flightHeightCategory ?? null;
    case 'flightOrigin': return draft.aerial?.origin ?? null;
    case 'flightDestination': return draft.aerial?.destination ?? null;
    case 'playbackResponse': return draft.playbackResponse ?? null;
    case 'detectionDistance': return draft.detectionDistanceMeters;
    case 'organismId': return draft.organismId;
    // El esfuerzo y las condiciones viven en el evento, no en el borrador;
    // el llamador los inyecta por contexto.
    case 'effort': return null;
    case 'conditions': return null;
    default: return null;
  }
}

const LABELS: Record<RequirableField, string> = {
  eventDate: 'Fecha', eventTime: 'Hora', station: 'Estación', method: 'Metodología',
  recordedBy: 'Observador', weather: 'Clima', taxon: 'Especie', trapNumber: 'N° de trampa',
  reproductiveCondition: 'Condición reproductiva',
  recordType: 'Tipo de registro', individualCount: 'Abundancia', sex: 'Sexo',
  lifeStage: 'Estado de desarrollo', organismCondition: 'Estado del organismo',
  behaviour: 'Comportamiento', notes: 'Observaciones', photos: 'Fotografías',
  occurrenceCoordinates: 'Coordenadas del avistamiento',
  flightDirection: 'Dirección de vuelo', flightHeight: 'Altura de vuelo',
  flightOrigin: 'Origen del vuelo', flightDestination: 'Destino del vuelo',
  playbackResponse: 'Respuesta al playback',
  effort: 'Esfuerzo de muestreo', conditions: 'Condiciones ambientales',
  detectionDistance: 'Distancia de detección', organismId: 'Código del individuo',
};

const ALL_FIELDS = Object.keys(LABELS) as RequirableField[];

export function validateDraft(draft: ObservationDraft, ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const group = ctx.taxon?.group ?? null;
  const recordType = draft.recordType ?? null;

  // --- único bloqueo real: no hay nada que identificar ---
  if (!draft.taxonId && !draft.verbatimTaxonText && !draft.taxonCandidates.length) {
    issues.push({
      field: 'taxon', severity: 'blocker', level: 'occurrence',
      message: 'No se reconoció ninguna especie. Dicta o escribe al menos el nombre común.',
    });
  }

  // --- ambigüedad taxonómica: preguntar, nunca elegir ---
  if (!draft.taxonId && draft.taxonCandidates.length > 1) {
    issues.push({
      field: 'taxonAmbiguity', severity: 'question', level: 'occurrence',
      message: `"${draft.verbatimTaxonText ?? 'ese nombre'}" corresponde a más de una especie. ¿Cuál registraste?`,
      options: draft.taxonCandidates.slice(0, 6).map((id) => {
        const t = ctx.resolveTaxon?.(id);
        return {
          label: t ? `${t.commonName}${t.scientificName ? ` — ${t.scientificName}` : ''}` : id,
          patch: { taxonId: id, taxonCandidates: [] },
        };
      }),
    });
  }
  if (draft.taxonCorrectedFrom && draft.taxonId && ctx.taxon) {
    issues.push({
      field: 'taxonAmbiguity', severity: 'question', level: 'occurrence',
      message: `Escuché "${draft.taxonCorrectedFrom}". ¿Es ${ctx.taxon.commonName}?`,
      options: [
        { label: `Sí, ${ctx.taxon.commonName}`, patch: { taxonCorrectedFrom: undefined } },
        { label: 'No, corregir', patch: { taxonId: null, taxonCorrectedFrom: undefined } },
      ],
    });
  }

  // --- campos exigidos por el perfil ---
  const flag = flagFor(ctx.taxon);
  const threatened = flag.level === 'amenazada';
  // La coordenada propia no depende del perfil sino de si la ubicación
  // significa algo: baja movilidad, evidencia fija o especie amenazada.
  // Un ave en EMF44 queda bien ubicada con el código de la estación.
  const fixNeed = locationFixNeed(ctx.taxon, draft.recordType);

  const pendingFields: string[] = [];
  for (const field of ALL_FIELDS) {
    if (field === 'effort' || field === 'conditions') continue; // se evalúan sobre el evento
    let req = requirementFor(ctx.profile, field, { method: draft.method, group, recordType, threatened });
    if (field === 'occurrenceCoordinates' && req !== 'required') {
      req = fixNeed.required ? 'required' : 'optional';
    }
    if (req === 'hidden' || req === 'optional') continue;
    const v = valueOf(draft, field);
    const missing = v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    if (!missing) continue;
    // La pregunta de desambiguación YA es la petición de especie: repetirla
    // como "falta especie" sería decir dos veces lo mismo.
    if (field === 'taxon' && issues.some((i) => i.field === 'taxon' || i.field === 'taxonAmbiguity')) {
      if (draft.taxonCandidates.length) pendingFields.push(field);
      continue;
    }
    if (draft.acknowledgedPending.includes(field)) { pendingFields.push(field); continue; }
    if (req === 'required') {
      pendingFields.push(field);
      const why = field === 'occurrenceCoordinates' && fixNeed.reason ? ` (${fixNeed.reason})` : '';
      issues.push({ field, severity: 'pending', level: levelOf(field), message: `Falta ${LABELS[field].toLowerCase()}${why}.` });
    } else {
      issues.push({ field, severity: 'info', level: levelOf(field), message: `Sin ${LABELS[field].toLowerCase()} (recomendado).` });
    }
  }

  // --- preguntas de alcance: un atributo individual sobre un grupo ---
  const n = draft.individualCount ?? 0;
  if (n > 1 && draft.sex && draft.sex !== 'Indeterminado' && draft.sexScope === 'sin_definir') {
    issues.push({
      field: 'sexScope', severity: 'question', level: 'occurrence',
      message: `¿Los ${n} individuos son ${draft.sex.toLowerCase()}?`,
      options: [
        { label: 'Sí, todos', patch: { sexScope: 'todos' } },
        { label: 'Sólo uno', patch: { sexScope: 'algunos' } },
        { label: 'Indeterminado', patch: { sex: 'Indeterminado', sexScope: 'todos' } },
      ],
    });
  }
  if (n > 1 && draft.lifeStage && draft.lifeStage !== 'Indeterminado' && draft.lifeStageScope === 'sin_definir') {
    issues.push({
      field: 'lifeStageScope', severity: 'question', level: 'occurrence',
      message: `¿Los ${n} individuos son ${draft.lifeStage.toLowerCase()}?`,
      options: [
        { label: 'Sí, todos', patch: { lifeStageScope: 'todos' } },
        { label: 'Sólo algunos', patch: { lifeStageScope: 'algunos' } },
        { label: 'Indeterminado', patch: { lifeStage: 'Indeterminado', lifeStageScope: 'todos' } },
      ],
    });
  }

  // --- coherencias que la planilla no podía detectar ---
  if (recordType && draft.individualCount !== null && isIndirect(recordType) && draft.individualCount > 0) {
    issues.push({
      field: 'consistency', severity: 'question', level: 'occurrence',
      message: `Registraste ${recordType.toLowerCase()} con abundancia ${draft.individualCount}. ¿La abundancia se refiere a individuos o a signos encontrados?`,
      options: [
        { label: 'Son signos, no individuos', patch: { individualCount: null } },
        { label: 'Mantener la abundancia', patch: {} },
      ],
    });
  }
  if (draft.method && ctx.projectMethods?.length && !ctx.projectMethods.includes(draft.method)) {
    issues.push({
      field: 'method', severity: 'info', level: 'event',
      message: 'La metodología seleccionada no está habilitada para este proyecto.',
    });
  }
  // --- conservación: el técnico tiene que saberlo AHORA, no en gabinete ---
  if (flag.level === 'amenazada' && flag.badge) {
    issues.push({
      field: 'conservation', severity: 'info', level: 'occurrence',
      message: `${ctx.taxon?.commonName ?? 'Esta especie'} está en categoría de conservación: ${flag.badge}. ${flag.detail ?? ''}`.trim(),
    });
  }
  if (isExotic(ctx.taxon)) {
    issues.push({
      field: 'conservation', severity: 'info', level: 'occurrence',
      message: `${ctx.taxon?.commonName ?? 'Esta especie'} es exótica; se informa por separado en la línea base.`,
    });
  }
  // Foto sugerida donde de verdad sirve: lo que otro tendrá que verificar.
  if (!draft.mediaIds.length && suggestsPhoto(ctx.taxon, draft.recordType, draft.identificationConfidence)) {
    const why = flag.level === 'amenazada' ? 'Especie en categoría de conservación'
      : draft.identificationConfidence !== 'seguro' ? `Identificación "${draft.identificationConfidence}"`
      : `Registro por ${draft.recordType?.toLowerCase()}`;
    issues.push({
      field: 'photos', severity: 'info', level: 'occurrence',
      message: `${why}: una fotografía permitiría verificarlo después.`,
    });
  }

  // --- esfuerzo: sólo si alguien lo activó ---
  // Nunca se reclama por iniciativa de la app. Si el usuario abrió un track o
  // declaró trampas y quedó a medias, se le recuerda; si nunca pidió medir,
  // el registro rápido es un modo legítimo y no hay nada que avisar.
  if (ctx.effort?.measured && ctx.effort.incomplete) {
    const effortRequirement = requirementFor(ctx.profile, 'effort', { method: draft.method, group, recordType });
    const unitLabel = ctx.effort.unit === 'distancia' ? 'la distancia recorrida'
      : ctx.effort.unit === 'trampas-noche' ? 'las trampas-noche'
      : 'la duración del muestreo';
    issues.push({
      field: 'effort',
      severity: effortRequirement === 'required' ? 'pending' : 'info',
      level: 'event',
      message: `Mediste esfuerzo pero falta ${unitLabel}. Ciérralo para poder comparar con otras campañas.`,
    });
    if (effortRequirement === 'required') pendingFields.push('effort');
  }

  // --- ¿seguimos en la estación que dice la pantalla? ---
  // Es el error más caro de terreno: caminar a la siguiente estación y seguir
  // dictando con la anterior seleccionada. Se avisa ANTES de guardar y nunca
  // se cambia solo (brief §4).
  const drift = stationDrift(ctx);
  if (drift) {
    const options: IssueOption[] = [];
    if (drift.nearest) {
      options.push({
        label: `Cambiar a ${drift.nearest.station.stationCode} (${drift.nearest.distance} m)`,
        patch: { stationId: drift.nearest.station.id },
      });
    }
    options.push({ label: `Sigo en ${drift.station.stationCode}`, patch: {} });
    issues.push({
      field: 'stationDistance', severity: 'question', level: 'event',
      message: `Estás a ${drift.distance} m de ${drift.station.stationCode}`
        + `${drift.nearest ? `. La más cercana es ${drift.nearest.station.stationCode}` : ''}.`,
      options,
    });
  }

  if (draft.aerial && draft.method !== 'transito_aereo') {
    issues.push({
      field: 'consistency', severity: 'info', level: 'occurrence',
      message: 'Se capturaron datos de vuelo fuera de la metodología de tránsito aéreo; se guardarán como hechos asociados.',
    });
  }

  return {
    issues,
    canSave: !issues.some((i) => i.severity === 'blocker'),
    pendingFields,
  };
}

interface StationDrift {
  station: Station;
  distance: number;
  nearest: { station: Station; distance: number } | null;
}

/**
 * Compara la posición del dispositivo con la de la estación seleccionada.
 * No avisa si el GPS es peor que la propia distancia: sería ruido del GPS,
 * no del usuario.
 */
function stationDrift(ctx: ValidationContext): StationDrift | null {
  const { fix, station } = ctx;
  if (!fix || !station || station.latitude == null || station.longitude == null) return null;

  const here = { latitude: fix.latitude, longitude: fix.longitude };
  const distance = Math.round(distanceMeters(here, { latitude: station.latitude, longitude: station.longitude }));
  if (distance <= STATION_DRIFT_METERS) return null;
  if (distance <= (fix.accuracyMeters ?? 0)) return null;

  let nearest: StationDrift['nearest'] = null;
  for (const candidate of ctx.nearbyStations ?? []) {
    if (candidate.id === station.id || candidate.latitude == null || candidate.longitude == null) continue;
    const d = Math.round(distanceMeters(here, { latitude: candidate.latitude, longitude: candidate.longitude }));
    if (d < distance && (!nearest || d < nearest.distance)) nearest = { station: candidate, distance: d };
  }
  return { station, distance, nearest };
}

function isIndirect(recordType: string): boolean {
  return ['Fecas', 'Huella', 'Plumas', 'Madriguera', 'Cururera', 'Muda', 'Huesos', 'Nido', 'Egagrópila'].includes(recordType);
}

/**
 * Respuesta a "¿qué me falta?": sólo lo accionable, ordenado por urgencia.
 * Nunca incluye campos derivables del catálogo.
 */
export function whatIsMissing(result: ValidationResult): string[] {
  const order: IssueSeverity[] = ['blocker', 'question', 'pending'];
  return result.issues
    .filter((i) => order.includes(i.severity))
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .map((i) => i.message);
}
