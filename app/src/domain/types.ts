/**
 * Modelo de datos normalizado de ProTerr.
 *
 * El modelo NO es la planilla Excel: es una estrella Darwin Core (Event ->
 * Occurrence -> Identification/MeasurementOrFact, con Taxon y Location como
 * catálogos). La planilla es una *salida* (ver src/export/excel.ts), igual que
 * el Darwin Core Archive (src/export/dwca.ts).
 *
 * Los campos que la planilla resolvía con INDEX/MATCH (proyecto, región,
 * ambiente, taxonomía completa, ...) NO se copian en la ocurrencia: se
 * derivan al exportar desde Station y Taxon. Así una corrección del catálogo
 * corrige todos los registros históricos, en vez de dejarlos congelados.
 */

/** Identificador estable, generado en el dispositivo (UUID v4). */
export type Uuid = string;

export type SyncState = 'pending' | 'synced' | 'error';

/** Metadatos de trazabilidad presentes en toda entidad sincronizable. */
export interface Auditable {
  createdAt: string; // ISO 8601 con offset
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string | null; // borrado lógico: nunca se destruye información
  deviceId: string;
  syncState: SyncState;
  syncError?: string | null;
  syncedAt?: string | null;
  /** Se incrementa en cada modificación local; base de la resolución de conflictos. */
  revision: number;
}

// ---------------------------------------------------------------------------
// Catálogos maestros (descargables antes de salir a terreno)
// ---------------------------------------------------------------------------

export interface Project {
  id: Uuid;
  code: string;
  name: string;
  client?: string | null;
  region?: string | null;
  /** Huso UTM y datum usados por el proyecto (la planilla los dejaba en una celda libre). */
  utmZone: number;
  utmHemisphere: 'N' | 'S';
  geodeticDatum: string;
  /** Perfil de campos obligatorios/recomendados; ver src/validation. */
  requirementProfileId: string;
  /** Metodologías habilitadas para este proyecto. */
  methods: MethodCode[];
}

export interface Campaign {
  id: Uuid;
  projectId: Uuid;
  name: string;
  season: string; // Invierno / Primavera / ...
  startDate?: string | null;
  endDate?: string | null;
}

export type MethodCode =
  | 'transecto'
  | 'playback_aves'
  | 'playback_anfibios'
  | 'camara_trampa'
  | 'trampa_sherman'
  | 'songmeter'
  | 'transito_aereo'
  | 'punto_conteo'
  | 'atropello'
  /** Fuera de estación: en tránsito entre estaciones, en campamento, en ruta. */
  | 'registro_oportunista'
  | 'otro';

/** Punto/línea concreto dentro de una estación (punto de playback, cámara, línea Sherman). */
export interface StationSite {
  id: Uuid;
  kind: 'playback_aves' | 'playback_anfibios' | 'camara_trampa' | 'trampa_sherman';
  name: string;
  label?: string | null;
  installedOn?: string | null;
  utmEast?: number | null;
  utmNorth?: number | null;
  utmEndEast?: number | null;
  utmEndNorth?: number | null;
}

export interface Station {
  id: Uuid;
  projectId: Uuid;
  stationCode: string; // 'EMF09'
  finalStationCode: string; // ID final reportable
  /** dwc:locationID — se genera aquí, no se deja vacío como en la planilla. */
  darwinCoreLocationId: string;
  region?: string | null;
  season?: string | null;
  habitat?: string | null;
  slopeAspect?: string | null;
  utmEast?: number | null;
  utmNorth?: number | null;
  utmStartEast?: number | null;
  utmStartNorth?: number | null;
  utmEndEast?: number | null;
  utmEndNorth?: number | null;
  /** Derivadas de UTM al sembrar; permiten la sugerencia por GPS. */
  latitude?: number | null;
  longitude?: number | null;
  methods: MethodCode[];
  sites: StationSite[];
  recordedBy?: string | null;
  identifiedBy?: string | null;
}

export type TaxonRank = 'subspecies' | 'species' | 'genus' | 'family' | 'order' | 'class' | 'unranked';

export interface Taxon {
  id: string;
  /**
   * Literal exacto del nombre común tal como venía en el catálogo de origen.
   * Se conserva aparte del `commonName` normalizado para que una exportación
   * pueda reproducir el texto que espera la planilla de destino.
   */
  sourceCommonName: string;
  commonName: string;
  otherCommonNames: string[];
  scientificName: string | null;
  scientificNameRaw: string | null;
  scientificNameNote: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null; // normalizada a latín (Aves, Mammalia, ...)
  classEs: string | null; // como la escribe la planilla
  order: string | null;
  family: string | null;
  genus: string | null;
  specificEpithet: string | null;
  infraspecificEpithet: string | null;
  taxonRank: TaxonRank;
  group: 'aves' | 'mamiferos' | 'reptiles' | 'anfibios' | 'otros';
  /** Comodines de la planilla ('A Ratón sp'): sirven para registrar sin identificar. */
  isPlaceholder: boolean;
  /** El nombre común no es único en el catálogo: la app debe preguntar, no adivinar. */
  ambiguousCommonName: boolean;
  searchKeys: string[];
  /**
   * Atributos de conservación, cargados como capa aparte sobre el catálogo
   * (la planilla no los trae). Vacío hasta que el proyecto cargue la lista
   * oficial; ver tools/cargar_conservacion.py.
   */
  conservation?: ConservationStatus | null;
}

/** Categorías de conservación y origen. Se cargan desde una fuente oficial, no se inventan. */
export interface ConservationStatus {
  /** Reglamento de Clasificación de Especies (Chile): EX, EW, CR, EN, VU, NT, LC, DD, o null si no clasificada. */
  rce?: string | null;
  /** Decreto que la clasificó (p. ej. 'DS 16/2016 MMA'). */
  rceDecree?: string | null;
  iucn?: string | null;
  /** Nativa, Endémica, Exótica, Exótica asilvestrada, Doméstica. */
  origin?: string | null;
  endemic?: boolean | null;
  migratory?: boolean | null;
  /** Ley de Caza u otra protección específica. */
  legalProtection?: string | null;
  /** Fuente y fecha de la lista cargada, para trazabilidad. */
  source?: string | null;
}

// ---------------------------------------------------------------------------
// Datos de terreno
// ---------------------------------------------------------------------------

export interface GeoFix {
  latitude: number;
  longitude: number;
  /** dwc:coordinateUncertaintyInMeters */
  accuracyMeters?: number | null;
  altitudeMeters?: number | null;
  /** Momento en que el GPS entregó la posición (puede diferir del registro). */
  fixedAt: string;
  utmEast?: number | null;
  utmNorth?: number | null;
  utmZone?: number | null;
  geodeticDatum?: string;
}

export type RecordSource = 'voz' | 'manual' | 'duplicado' | 'importado';

/**
 * dwc:Event — la unidad de muestreo. Varias ocurrencias comparten un evento
 * (misma estación, metodología y ventana temporal), lo que elimina la
 * repetición de ~25 columnas por fila que tenía la planilla.
 */
export interface SamplingEvent extends Auditable {
  id: Uuid;
  projectId: Uuid;
  campaignId: Uuid;
  stationId: Uuid;
  siteId?: Uuid | null;
  method: MethodCode;
  /** Fecha local del evento, YYYY-MM-DD. */
  eventDate: string;
  /** Hora local HH:mm. */
  eventTime: string;
  timezone: string; // IANA, p.ej. 'America/Santiago'
  utcOffsetMinutes: number;
  /** Instante exacto tal como lo entregó el reloj del dispositivo (trazabilidad). */
  deviceTimestamp: string;
  /** true si el usuario editó manualmente fecha/hora (registro diferido). */
  dateTimeEditedByUser: boolean;
  recordedBy?: string | null;
  weather?: string | null;
  notes?: string | null;
  /** Posición del dispositivo al abrir el evento; NO es la posición de la estación. */
  deviceFix?: GeoFix | null;

  // --- Esfuerzo de muestreo (sin esto una línea base no es comparable) ---
  /** Inicio y término reales del muestreo, ISO 8601. `endedAt` nulo = muestreo abierto. */
  startedAt?: string | null;
  endedAt?: string | null;
  /**
   * Recorrido GPS. Sólo existe si el usuario lo pidió explícitamente
   * ("iniciar track"): en el uso normal no se recorre nada automáticamente,
   * porque no siempre hace falta y encender el GPS toda la jornada
   * agota la batería.
   */
  track?: TrackPoint[];
  /** Estado del track explícito. `null` = nunca se inició. */
  trackState?: 'activo' | 'cerrado' | null;
  /** Puntos nombrados del transecto: inicio, 100, 200, final. */
  waypoints?: Waypoint[];
  /** Metros recorridos, derivados del track o de inicio/fin de la estación. */
  distanceMeters?: number | null;
  /** Esfuerzo de trampeo: trampas × noches (Sherman, cámaras). */
  trapCount?: number | null;
  trapNights?: number | null;
  /** Condiciones ambientales estructuradas al inicio del muestreo. */
  conditions?: EnvironmentalConditions | null;
  /**
   * true cuando la estación se muestreó y NO se detectó fauna. Un evento vacío
   * es un dato (ausencia), no una omisión, y se exporta como tal.
   */
  noDetections?: boolean;
  /** Registro fuera de estación (metodología 'registro_oportunista'). */
  incidental?: boolean;
}

/**
 * Punto nombrado del transecto. El usuario dice "punto 100" y queda marcado
 * con su coordenada; es lo que permite reconstruir el recorrido sin tener
 * que grabar el track completo.
 */
export interface Waypoint {
  id: Uuid;
  /** 'inicio', '100', '200', 'final', o lo que el usuario nombre. */
  label: string;
  at: string;
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

/** Punto del recorrido GPS. Compacto: se guardan muchos. */
export interface TrackPoint {
  t: string; // ISO 8601
  lat: number;
  lon: number;
  acc?: number | null;
  alt?: number | null;
}

export interface EnvironmentalConditions {
  temperatureC?: number | null;
  /** Escala Beaufort 0-12. */
  windBeaufort?: number | null;
  /** Cobertura de nubes en octas 0-8. */
  cloudOctas?: number | null;
  precipitation?: 'Sin lluvia' | 'Llovizna' | 'Lluvia' | 'Nieve' | null;
  /** Diurno, crepuscular o nocturno; útil para anfibios y quirópteros. */
  period?: 'Diurno' | 'Crepuscular' | 'Nocturno' | null;
}

export type RecordType =
  | 'Individuo' | 'Vocalización' | 'Fecas' | 'Madriguera' | 'Cururera' | 'Plumas'
  | 'Muda' | 'Huesos' | 'Huella' | 'Nido' | 'Registro de audio' | 'Egagrópila' | 'Otro';

export type Sex = 'Macho' | 'Hembra' | 'Indeterminado';
export type LifeStage = 'Adulto' | 'Juvenil' | 'Cría' | 'Huevo/Larva' | 'Indeterminado';
export type OrganismCondition = 'Vivo' | 'Muerto' | 'Herido' | 'Indeterminado';

/** A qué parte del grupo aplica un atributo declarado (ver validación "5 individuos, macho"). */
export type AttributeScope = 'todos' | 'algunos' | 'sin_definir';

/**
 * dwc:Occurrence — una observación. Contiene sólo lo observado; lo derivable
 * (taxonomía, datos de estación) vive en los catálogos.
 */
export interface Occurrence extends Auditable {
  id: Uuid;
  eventId: Uuid;
  /**
   * Hora local del avistamiento, HH:mm. Cada registro guarda la suya: el
   * usuario dice "EMF44" una vez y luego va nombrando especies durante un
   * rato, así que la hora del evento no sirve para ninguna de ellas.
   */
  occurrenceTime: string;
  /** dwc:occurrenceID estable y global. */
  occurrenceId: string;
  taxonId: string | null;
  /** Texto tal como lo dijo/escribió el usuario, si el taxón no se resolvió. */
  verbatimTaxonText?: string | null;
  recordType: RecordType;
  /** Derivado de recordType, pero editable (la planilla lo calculaba con una fórmula). */
  evidenceKind: 'Directo' | 'Indirecto';
  /**
   * dwc:individualCount. `null` es legítimo: 'fecas de puma' NO son un individuo.
   */
  individualCount: number | null;
  sex?: Sex | null;
  sexScope?: AttributeScope;
  lifeStage?: LifeStage | null;
  lifeStageScope?: AttributeScope;
  organismCondition?: OrganismCondition | null;
  behaviour?: string | null;
  notes?: string | null;
  /** Posición real del avistamiento, distinta de la estación. */
  occurrenceFix?: GeoFix | null;
  /** Campos propios de tránsito aéreo; ausentes en cualquier otra metodología. */
  aerial?: AerialTransit | null;
  source: RecordSource;
  /** Transcripción de voz que originó el registro (trazabilidad + reentrenamiento). */
  verbatimUtterance?: string | null;
  /**
   * Identifica los registros guardados juntos desde un mismo dictado.
   * "Tres loicas vocalizando, una loica macho, dos loicas vocalizando" son
   * grupos distintos que el usuario enumeró a propósito: comparten lote y por
   * eso nunca se confunden entre sí con un doble guardado.
   */
  batchId?: string | null;
  mediaIds: Uuid[];
  /** Preguntas abiertas que el usuario decidió dejar pendientes. */
  pendingFields: string[];

  /**
   * Confianza en la identificación. 'posible' y 'probable' se exportan como
   * dwc:identificationQualifier ('cf.'): decir "posible chercán" y guardarlo
   * como chercán seguro es fabricar un dato.
   */
  identificationConfidence?: IdentificationConfidence;
  /** Distancia perpendicular de detección, en metros (distance sampling). */
  detectionDistanceMeters?: number | null;
  /** Marca o código del individuo (recapturas en trampeo, seguimiento). */
  organismId?: string | null;
  recapture?: boolean | null;

  // --- Flujo de revisión en gabinete ---
  reviewState?: ReviewState;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export type IdentificationConfidence = 'seguro' | 'probable' | 'posible';

/**
 * terreno: recién dictado · revisado: alguien lo leyó en gabinete ·
 * validado: aprobado para el informe; queda protegido de ediciones casuales.
 */
export type ReviewState = 'terreno' | 'revisado' | 'validado';

export interface AerialTransit {
  origin?: string | null; // dirección cardinal de origen
  destination?: string | null;
  flightDirection?: string | null;
  flightHeightCategory?: string | null; // 1..5 según la planilla
  flightHeightMeters?: number | null;
}

export interface Identification extends Auditable {
  id: Uuid;
  occurrenceId: Uuid;
  taxonId: string;
  identifiedBy: string;
  dateIdentified: string;
  /** Nivel al que se llegó con confianza (puede ser menor que el del taxón). */
  identificationQualifier?: string | null;
  identificationRemarks?: string | null;
}

/** dwc extension MeasurementOrFact: variables adicionales sin tocar el esquema. */
export interface MeasurementOrFact extends Auditable {
  id: Uuid;
  occurrenceId: Uuid;
  measurementType: string;
  measurementValue: string;
  measurementUnit?: string | null;
  measurementMethod?: string | null;
}

export interface MediaObject extends Auditable {
  id: Uuid;
  occurrenceId?: Uuid | null;
  eventId?: Uuid | null;
  kind: 'foto' | 'audio';
  mimeType: string;
  blob: Blob;
  capturedAt: string;
  fix?: GeoFix | null;
  headingDegrees?: number | null;
  /** EXIF original preservado tal cual llega del archivo. */
  exif?: Record<string, unknown> | null;
  fileName: string;
}

/** Bitácora de auditoría: qué cambió, quién y cuándo. */
export interface AuditEntry {
  id: Uuid;
  entity: 'event' | 'occurrence' | 'media' | 'identification' | 'measurement';
  entityId: Uuid;
  action: 'create' | 'update' | 'delete' | 'restore' | 'sync';
  at: string;
  by: string;
  deviceId: string;
  /** Sólo los campos que cambiaron: { campo: [antes, después] }. */
  changes?: Record<string, [unknown, unknown]>;
  note?: string | null;
}

export interface SyncLogEntry {
  id: Uuid;
  at: string;
  direction: 'push' | 'pull';
  entity: string;
  entityId: string;
  outcome: 'ok' | 'retry' | 'conflict' | 'error';
  attempt: number;
  message?: string | null;
}
