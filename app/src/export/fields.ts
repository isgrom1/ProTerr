/**
 * Catálogo de campos exportables.
 *
 * Es la lista de todo lo que ProTerr sabe poner en una celda, con un
 * identificador estable y los nombres con que cada consultora suele llamarlo.
 * Una plantilla de exportación no es más que un mapeo
 * «encabezado de la planilla → identificador de este catálogo».
 *
 * Los alias existen para que, al subir una planilla nueva, la app pueda
 * proponer el mapeo sola en vez de obligar a emparejar 50 columnas a mano.
 */
import { flagFor } from '../conservation/status';
import type { MethodCode } from '../domain/types';
import { summarizeEffort } from '../effort/session';
import { coordinatesOf, type FlatRecord } from './shape';

/** Etiquetas de metodología en español, para la salida. */
export const METHOD_LABEL: Record<MethodCode, string> = {
  transecto: 'Transecto',
  playback_aves: 'Playback aves',
  playback_anfibios: 'Playback anfibios',
  camara_trampa: 'Cámara trampa',
  trampa_sherman: 'Trampas Sherman',
  songmeter: 'Grabadora acústica',
  transito_aereo: 'Tránsito aéreo',
  transito_aereo_nocturno: 'Tránsito aéreo nocturno (MTAN)',
  punto_conteo: 'Punto de conteo',
  atropello: 'Atropello',
  registro_oportunista: 'Registro oportunista',
  otro: 'Otro',
};

export type FieldGroup = 'Evento' | 'Estación' | 'Registro' | 'Taxonomía' | 'Vuelo' | 'Esfuerzo' | 'Conservación' | 'Trazabilidad';

export interface ExportField {
  id: string;
  label: string;
  group: FieldGroup;
  /** Formas en que otras planillas nombran esta misma columna. */
  aliases: string[];
  resolve: (r: FlatRecord) => unknown;
}

const blank = <T>(v: T | null | undefined): T | '' => (v === null || v === undefined ? '' : v);
const yesNo = (on: boolean | undefined | null): string => (on ? 'Sí' : '');

function amPm(time: string | null | undefined): string {
  const hour = Number(String(time ?? '').slice(0, 2));
  return Number.isFinite(hour) ? (hour > 11 ? 'PM' : 'AM') : '';
}

export const EXPORT_FIELDS: ExportField[] = [
  // --- Evento ---
  { id: 'event.date', label: 'Fecha', group: 'Evento', aliases: ['fecha', 'date', 'fecha de registro', 'fecha muestreo', 'fecha hora', 'fecha y hora'], resolve: (r) => r.event.eventDate },
  { id: 'event.year', label: 'Año', group: 'Evento', aliases: ['ano', 'year'], resolve: (r) => Number(r.event.eventDate.slice(0, 4)) },
  { id: 'event.month', label: 'Mes', group: 'Evento', aliases: ['mes', 'month'], resolve: (r) => Number(r.event.eventDate.slice(5, 7)) },
  { id: 'event.day', label: 'Día', group: 'Evento', aliases: ['dia', 'day'], resolve: (r) => Number(r.event.eventDate.slice(8, 10)) },
  { id: 'occurrence.time', label: 'Hora', group: 'Evento', aliases: ['hora', 'time', 'hora de registro', 'hora observacion'], resolve: (r) => r.occurrence.occurrenceTime },
  { id: 'occurrence.amPm', label: 'AM/PM', group: 'Evento', aliases: ['am pm', 'am/pm', 'periodo'], resolve: (r) => amPm(r.occurrence.occurrenceTime) },
  { id: 'event.method', label: 'Metodología', group: 'Evento', aliases: ['metodologia', 'metodologia usada para registro', 'metodo', 'protocolo', 'tipo de muestreo'], resolve: (r) => METHOD_LABEL[r.event.method] },
  { id: 'event.recordedBy', label: 'Observador', group: 'Evento', aliases: ['observador', 'muestreado por', 'registrado por', 'evaluador', 'recorded by', 'colector', 'responsable', 'responsables'], resolve: (r) => blank(r.event.recordedBy ?? r.station?.recordedBy) },
  { id: 'event.identifiedBy', label: 'Identificado por', group: 'Evento', aliases: ['identificado por', 'determinado por', 'identified by'], resolve: (r) => blank(r.station?.identifiedBy) },
  { id: 'event.team', label: 'Equipo', group: 'Evento', aliases: ['equipo', 'brigada', 'cuadrilla', 'team', 'equipo de terreno'], resolve: (r) => blank(r.event.team) },
  { id: 'event.weather', label: 'Clima', group: 'Evento', aliases: ['clima', 'condiciones', 'tiempo', 'weather'], resolve: (r) => blank(r.event.weather) },
  { id: 'event.period', label: 'Periodo del día', group: 'Evento', aliases: ['periodo del dia', 'momento del dia', 'jornada'], resolve: (r) => blank(r.event.conditions?.period) },
  { id: 'event.temperature', label: 'Temperatura (°C)', group: 'Evento', aliases: ['temperatura', 'temp'], resolve: (r) => blank(r.event.conditions?.temperatureC) },
  { id: 'event.wind', label: 'Viento (Beaufort)', group: 'Evento', aliases: ['viento', 'beaufort'], resolve: (r) => blank(r.event.conditions?.windBeaufort) },
  { id: 'event.cloud', label: 'Nubosidad (octas)', group: 'Evento', aliases: ['nubosidad', 'nubes', 'octas'], resolve: (r) => blank(r.event.conditions?.cloudOctas) },
  { id: 'event.precipitation', label: 'Precipitación', group: 'Evento', aliases: ['precipitacion', 'lluvia'], resolve: (r) => blank(r.event.conditions?.precipitation) },
  { id: 'event.performed', label: '¿Se realizó?', group: 'Evento', aliases: ['se realizo', 'se realizo si o no', 'porque se realizo', 'realizado', 'ejecutado', 'se ejecuto', 'se hizo'], resolve: (r) => (r.event.performed === false ? 'NO' : r.event.performed === true ? 'SI' : '') },
  { id: 'event.notPerformedReason', label: '¿Por qué no se realizó?', group: 'Evento', aliases: ['porque no se realizo', 'por que no se realizo', 'motivo', 'razon', 'porque no se hizo', 'motivo de no ejecucion'], resolve: (r) => blank(r.event.notPerformedReason) },
  { id: 'event.noDetections', label: 'Sin detecciones', group: 'Evento', aliases: ['sin detecciones', 'sin registros', 'estacion vacia'], resolve: (r) => yesNo(r.event.noDetections) },
  { id: 'event.notes', label: 'Observaciones del muestreo', group: 'Evento', aliases: ['observaciones del muestreo', 'notas del muestreo'], resolve: (r) => blank(r.event.notes) },
  { id: 'event.id', label: 'ID del muestreo', group: 'Evento', aliases: ['eventid', 'id muestreo', 'id evento'], resolve: (r) => r.event.id },

  // --- Proyecto y estación ---
  { id: 'project.name', label: 'Proyecto', group: 'Estación', aliases: ['proyecto', 'project', 'nombre proyecto'], resolve: (r) => blank(r.project?.name) },
  { id: 'project.client', label: 'Cliente', group: 'Estación', aliases: ['cliente', 'mandante', 'titular'], resolve: (r) => blank(r.project?.client) },
  { id: 'campaign.name', label: 'Campaña', group: 'Estación', aliases: ['campana', 'campaña'], resolve: (r) => blank(r.campaign?.name) },
  { id: 'campaign.season', label: 'Temporada', group: 'Estación', aliases: ['temporada', 'estacion del ano', 'season'], resolve: (r) => blank(r.campaign?.season ?? r.station?.season) },
  { id: 'station.code', label: 'ID Estación', group: 'Estación', aliases: ['id estacion', 'estacion', 'codigo estacion', 'punto', 'sitio', 'transecto', 'station'], resolve: (r) => blank(r.station?.stationCode) },
  { id: 'station.finalCode', label: 'ID Final Estación', group: 'Estación', aliases: ['id final estacion', 'id estacion final', 'codigo final'], resolve: (r) => blank(r.station?.finalStationCode) },
  { id: 'station.sector', label: 'Sector', group: 'Estación', aliases: ['sector', 'localidad', 'zona', 'area de estudio', 'unidad territorial'], resolve: (r) => blank(r.station?.sector) },
  { id: 'station.region', label: 'Región', group: 'Estación', aliases: ['region', 'provincia', 'state province'], resolve: (r) => blank(r.station?.region ?? r.project?.region) },
  { id: 'station.habitat', label: 'Ambiente', group: 'Estación', aliases: ['ambiente', 'habitat', 'formacion vegetal', 'unidad ambiental'], resolve: (r) => blank(r.station?.habitat) },
  { id: 'station.slope', label: 'Ladera de exposición', group: 'Estación', aliases: ['ladera', 'ladera de exposicion', 'exposicion'], resolve: (r) => blank(r.station?.slopeAspect) },
  { id: 'station.utmEast', label: 'UTM E estación', group: 'Estación', aliases: ['utm e estacion', 'utm e estacion x', 'este estacion', 'utm este', 'coordenada x'], resolve: (r) => blank(r.station?.utmEast) },
  { id: 'station.utmNorth', label: 'UTM N estación', group: 'Estación', aliases: ['utm s estacion', 'utm n estacion', 'utm s estacion y', 'norte estacion', 'utm norte', 'coordenada y'], resolve: (r) => blank(r.station?.utmNorth) },
  { id: 'station.utmStartEast', label: 'UTM E inicio', group: 'Estación', aliases: ['utm e inicio', 'este inicio', 'inicio x'], resolve: (r) => blank(r.station?.utmStartEast) },
  { id: 'station.utmStartNorth', label: 'UTM N inicio', group: 'Estación', aliases: ['utm s inicio', 'utm n inicio', 'norte inicio', 'inicio y'], resolve: (r) => blank(r.station?.utmStartNorth) },
  { id: 'station.utmEndEast', label: 'UTM E fin', group: 'Estación', aliases: ['utm e fin', 'este fin', 'fin x'], resolve: (r) => blank(r.station?.utmEndEast) },
  { id: 'station.utmEndNorth', label: 'UTM N fin', group: 'Estación', aliases: ['utm s fin', 'utm n fin', 'norte fin', 'fin y'], resolve: (r) => blank(r.station?.utmEndNorth) },
  { id: 'station.latitude', label: 'Latitud estación', group: 'Estación', aliases: ['latitud estacion', 'lat estacion'], resolve: (r) => blank(r.station?.latitude) },
  { id: 'station.longitude', label: 'Longitud estación', group: 'Estación', aliases: ['longitud estacion', 'lon estacion'], resolve: (r) => blank(r.station?.longitude) },
  { id: 'station.methodTransecto', label: '¿Transecto?', group: 'Estación', aliases: ['transecto general'], resolve: (r) => yesNo(r.station?.methods.includes('transecto')) },
  { id: 'station.methodPlaybackAves', label: '¿Playback aves?', group: 'Estación', aliases: ['playback aves'], resolve: (r) => yesNo(r.station?.methods.includes('playback_aves')) },
  { id: 'station.methodPlaybackAnfibios', label: '¿Playback anfibios?', group: 'Estación', aliases: ['playback anfibios'], resolve: (r) => yesNo(r.station?.methods.includes('playback_anfibios')) },
  { id: 'station.methodCamara', label: '¿Cámara trampa?', group: 'Estación', aliases: ['camara trampa'], resolve: (r) => yesNo(r.station?.methods.includes('camara_trampa')) },
  { id: 'station.methodSherman', label: '¿Trampas Sherman?', group: 'Estación', aliases: ['trampas sherman'], resolve: (r) => yesNo(r.station?.methods.includes('trampa_sherman')) },

  // --- Registro ---
  { id: 'occurrence.commonName', label: 'Nombre común', group: 'Registro', aliases: ['nombre comun', 'especie', 'nombre vulgar', 'vernacular', 'common name'], resolve: (r) => blank(r.taxon?.commonName ?? r.occurrence.verbatimTaxonText) },
  { id: 'occurrence.recordType', label: 'Tipo de registro', group: 'Registro', aliases: ['tipo de registro', 'registro', 'evidencia', 'tipo registro', 'tipo de actividad', 'tipo actividad'], resolve: (r) => r.occurrence.recordType },
  { id: 'occurrence.evidenceKind', label: 'Directo/Indirecto', group: 'Registro', aliases: ['directo indirecto', 'tipo registro directo indirecto', 'tipo de evidencia'], resolve: (r) => r.occurrence.evidenceKind },
  { id: 'occurrence.count', label: 'Abundancia', group: 'Registro', aliases: ['abundancia', 'n individuos', 'numero de individuos', 'cantidad', 'individuos', 'individual count'], resolve: (r) => r.occurrence.individualCount ?? '' },
  { id: 'occurrence.sex', label: 'Sexo', group: 'Registro', aliases: ['sexo', 'sex'], resolve: (r) => blank(r.occurrence.sex) },
  { id: 'occurrence.lifeStage', label: 'Estado de desarrollo', group: 'Registro', aliases: ['estado desarrollo', 'estado de desarrollo', 'edad', 'life stage', 'clase etaria', 'etapa de vida', 'estadio'], resolve: (r) => blank(r.occurrence.lifeStage) },
  { id: 'occurrence.condition', label: 'Estado del organismo', group: 'Registro', aliases: ['estado del organismo', 'condicion', 'vivo muerto'], resolve: (r) => blank(r.occurrence.organismCondition) },
  { id: 'occurrence.behaviour', label: 'Comportamiento', group: 'Registro', aliases: ['comportamiento', 'conducta', 'actividad', 'behavior'], resolve: (r) => blank(r.occurrence.behaviour) },
  { id: 'occurrence.notes', label: 'Observaciones', group: 'Registro', aliases: ['observaciones', 'comentarios', 'notas', 'remarks', 'obs general', 'observaciones generales', 'observacion general'], resolve: (r) => blank(r.occurrence.notes) },
  { id: 'occurrence.photos', label: 'Fotos', group: 'Registro', aliases: ['fotos', 'fotografias', 'imagenes', 'media'], resolve: (r) => (r.occurrence.mediaIds.length ? `${r.occurrence.mediaIds.length} foto(s)` : '') },
  { id: 'occurrence.confidence', label: 'Confianza de identificación', group: 'Registro', aliases: ['confianza', 'certeza', 'nivel de identificacion'], resolve: (r) => blank(r.occurrence.identificationConfidence) },
  { id: 'occurrence.detectionDistance', label: 'Distancia de detección (m)', group: 'Registro', aliases: ['distancia de deteccion', 'distancia'], resolve: (r) => blank(r.occurrence.detectionDistanceMeters) },
  { id: 'occurrence.organismId', label: 'Código del individuo', group: 'Registro', aliases: ['codigo individuo', 'marca', 'anillo', 'chip', 'organism id'], resolve: (r) => blank(r.occurrence.organismId) },
  { id: 'occurrence.reproductiveCondition', label: 'Condición reproductiva', group: 'Registro', aliases: ['condicion reproductiva', 'conducta reprod', 'condicion reprod', 'estado reproductivo', 'reproductive condition'], resolve: (r) => blank(r.occurrence.reproductiveCondition) },
  { id: 'occurrence.trapNumber', label: 'N° de trampa', group: 'Registro', aliases: ['n de trampa', 'numero de trampa', 'trampa', 'trap number'], resolve: (r) => blank(r.occurrence.trapNumber) },
  { id: 'occurrence.site', label: 'Punto o línea', group: 'Registro', aliases: ['punto de playback', 'linea', 'nombre pb', 'nombre linea', 'sitio', 'id tecnica', 'id de tecnica', 'codigo tecnica'], resolve: (r) => blank(r.site?.name) },
  { id: 'occurrence.recapture', label: 'Recaptura', group: 'Registro', aliases: ['recaptura'], resolve: (r) => yesNo(r.occurrence.recapture) },
  { id: 'occurrence.utmEast', label: 'UTM E del avistamiento', group: 'Registro', aliases: ['utm e captura', 'utm e captura x', 'este captura', 'utm e avistamiento', 'utm e', 'e utm', 'utm este'], resolve: (r) => (r.occurrence.occurrenceFix ? blank(coordinatesOf(r).utmEast) : '') },
  { id: 'occurrence.utmNorth', label: 'UTM N del avistamiento', group: 'Registro', aliases: ['utm s captura', 'utm n captura', 'utm s captura y', 'norte captura', 'utm n avistamiento', 'utm n', 'n utm', 'utm norte'], resolve: (r) => (r.occurrence.occurrenceFix ? blank(coordinatesOf(r).utmNorth) : '') },
  { id: 'occurrence.latitude', label: 'Latitud del avistamiento', group: 'Registro', aliases: ['latitud', 'lat', 'decimal latitude'], resolve: (r) => blank(r.occurrence.occurrenceFix?.latitude) },
  { id: 'occurrence.longitude', label: 'Longitud del avistamiento', group: 'Registro', aliases: ['longitud', 'lon', 'decimal longitude'], resolve: (r) => blank(r.occurrence.occurrenceFix?.longitude) },

  // --- Taxonomía ---
  { id: 'taxon.scientificName', label: 'Nombre científico', group: 'Taxonomía', aliases: ['nombre cientifico', 'scientific name', 'binomio', 'taxon'], resolve: (r) => blank(r.taxon?.scientificName) },
  { id: 'taxon.kingdom', label: 'Reino', group: 'Taxonomía', aliases: ['reino', 'kingdom'], resolve: (r) => blank(r.taxon?.kingdom) },
  { id: 'taxon.phylum', label: 'Filo', group: 'Taxonomía', // "tipo" NO es alias: en las planillas de terreno casi siempre significa
  // tipo de estación o de vuelo, y emparejarlo con el filo llena la columna
  // taxonómica con "Tipo C".
  aliases: ['filo', 'phylum'], resolve: (r) => blank(r.taxon?.phylum) },
  { id: 'taxon.class', label: 'Clase', group: 'Taxonomía', aliases: ['clase', 'class'], resolve: (r) => blank(r.taxon?.classEs ?? r.taxon?.class) },
  { id: 'taxon.classLatin', label: 'Clase (latín)', group: 'Taxonomía', aliases: ['clase latin', 'class latin'], resolve: (r) => blank(r.taxon?.class) },
  { id: 'taxon.order', label: 'Orden', group: 'Taxonomía', aliases: ['orden', 'order'], resolve: (r) => blank(r.taxon?.order) },
  { id: 'taxon.family', label: 'Familia', group: 'Taxonomía', aliases: ['familia', 'family'], resolve: (r) => blank(r.taxon?.family) },
  { id: 'taxon.genus', label: 'Género', group: 'Taxonomía', aliases: ['genero', 'genus'], resolve: (r) => blank(r.taxon?.genus) },
  { id: 'taxon.specificEpithet', label: 'Epíteto específico', group: 'Taxonomía', aliases: ['epiteto especifico', 'specific epithet', 'especie epiteto'], resolve: (r) => blank(r.taxon?.specificEpithet) },
  { id: 'taxon.infraspecificEpithet', label: 'Epíteto infraespecífico', group: 'Taxonomía', aliases: ['epiteto infraespecifico', 'subespecie', 'infraspecific epithet'], resolve: (r) => blank(r.taxon?.infraspecificEpithet) },
  { id: 'taxon.rank', label: 'Rango taxonómico', group: 'Taxonomía', aliases: ['rango', 'taxon rank', 'nivel taxonomico'], resolve: (r) => blank(r.taxon?.taxonRank) },

  // --- Vuelo (tránsito aéreo) ---
  { id: 'aerial.origin', label: 'Origen del vuelo', group: 'Vuelo', aliases: ['origen', 'origin'], resolve: (r) => blank(r.occurrence.aerial?.origin) },
  { id: 'aerial.destination', label: 'Destino del vuelo', group: 'Vuelo', aliases: ['destino', 'destination'], resolve: (r) => blank(r.occurrence.aerial?.destination) },
  { id: 'aerial.direction', label: 'Dirección de vuelo', group: 'Vuelo', aliases: ['direccion de vuelo', 'direccion vuelo', 'rumbo'], resolve: (r) => blank(r.occurrence.aerial?.flightDirection) },
  { id: 'aerial.heightCategory', label: 'Categoría de altura', group: 'Vuelo', aliases: ['altura vuelo', 'categoria de altura', 'categoria altura', 'referencia de altura', 'referencia altura'], resolve: (r) => blank(r.occurrence.aerial?.flightHeightCategory) },
  { id: 'aerial.heightReference', label: 'Referencia de altura', group: 'Vuelo', aliases: ['referencia de altura', 'referencia altura', 'altura referencia'], resolve: (r) => blank(r.occurrence.aerial?.heightReference) },
  { id: 'aerial.flightType', label: 'Tipo de vuelo', group: 'Vuelo', // "tipo vuelo" a secas se parece demasiado a un "TIPO" suelto, que en las
  // planillas es el tipo de estación: se deja sólo la forma completa.
  aliases: ['tipo de vuelo', 'patron de vuelo', 'patron vuelo'], resolve: (r) => blank(r.occurrence.aerial?.flightType) },
  { id: 'event.timeBlock', label: 'Bloque horario', group: 'Evento', aliases: ['bloque horario', 'bloque horario de em', 'turno', 'franja horaria'], resolve: (r) => blank(r.event.timeBlock) },
  { id: 'aerial.heightMeters', label: 'Altura de vuelo (m)', group: 'Vuelo', aliases: ['altura vuelo lat o metros', 'altura en metros', 'altura m'], resolve: (r) => blank(r.occurrence.aerial?.flightHeightMeters) },

  // --- Esfuerzo ---
  { id: 'effort.label', label: 'Esfuerzo', group: 'Esfuerzo', aliases: ['esfuerzo', 'sampling effort'], resolve: (r) => summarizeEffort(r.event).label },
  { id: 'effort.duration', label: 'Duración (min)', group: 'Esfuerzo', aliases: ['duracion', 'minutos', 'tiempo de muestreo'], resolve: (r) => blank(summarizeEffort(r.event).durationMinutes) },
  { id: 'effort.distance', label: 'Distancia recorrida (m)', group: 'Esfuerzo', aliases: ['distancia recorrida', 'metros recorridos', 'longitud transecto'], resolve: (r) => blank(summarizeEffort(r.event).distanceMeters) },
  { id: 'effort.trapNights', label: 'Trampas-noche', group: 'Esfuerzo', aliases: ['trampas noche', 'trampa noche', 'trap nights'], resolve: (r) => blank(summarizeEffort(r.event).trapNights) },

  // --- Conservación ---
  { id: 'conservation.category', label: 'Categoría de conservación', group: 'Conservación', aliases: ['categoria de conservacion', 'categoria rce', 'rce', 'estado de conservacion', 'clasificacion'], resolve: (r) => blank(flagFor(r.taxon).badge) },
  { id: 'conservation.origin', label: 'Origen', group: 'Conservación', aliases: ['origen de la especie', 'nativa exotica', 'procedencia'], resolve: (r) => blank(r.taxon?.conservation?.origin) },
  { id: 'conservation.endemic', label: 'Endémica', group: 'Conservación', aliases: ['endemica', 'endemismo'], resolve: (r) => (r.taxon?.conservation?.endemic === true ? 'Sí' : r.taxon?.conservation?.endemic === false ? 'No' : '') },
  { id: 'conservation.source', label: 'Fuente de conservación', group: 'Conservación', aliases: ['fuente conservacion', 'fuente de la clasificacion'], resolve: (r) => blank(r.taxon?.conservation?.source) },

  // --- Trazabilidad ---
  { id: 'trace.occurrenceId', label: 'ID del registro', group: 'Trazabilidad', aliases: ['occurrenceid', 'id registro', 'uuid'], resolve: (r) => r.occurrence.occurrenceId },
  { id: 'trace.syncState', label: 'Estado de sincronización', group: 'Trazabilidad', aliases: ['estado sincronizacion', 'sincronizado'], resolve: (r) => ({ synced: 'Sincronizado', error: 'Error', pending: 'Pendiente' }[r.occurrence.syncState] ?? r.occurrence.syncState) },
  { id: 'trace.reviewState', label: 'Estado de revisión', group: 'Trazabilidad', aliases: ['estado de revision', 'revision', 'validado'], resolve: (r) => blank(r.occurrence.reviewState) },
  { id: 'trace.source', label: 'Origen del registro', group: 'Trazabilidad', aliases: ['origen del registro', 'como se registro'], resolve: (r) => r.occurrence.source },
  { id: 'trace.utterance', label: 'Dictado original', group: 'Trazabilidad', aliases: ['dictado', 'texto original', 'verbatim'], resolve: (r) => blank(r.occurrence.verbatimUtterance) },
  { id: 'trace.pendingFields', label: 'Campos pendientes', group: 'Trazabilidad', aliases: ['campos pendientes', 'pendientes'], resolve: (r) => r.occurrence.pendingFields.join('; ') },
  { id: 'trace.createdBy', label: 'Creado por', group: 'Trazabilidad', aliases: ['creado por', 'created by'], resolve: (r) => r.occurrence.createdBy },
  { id: 'trace.createdAt', label: 'Creado el', group: 'Trazabilidad', aliases: ['creado el', 'fecha de creacion'], resolve: (r) => r.occurrence.createdAt },
  { id: 'trace.updatedBy', label: 'Modificado por', group: 'Trazabilidad', aliases: ['modificado por', 'updated by'], resolve: (r) => r.occurrence.updatedBy },
  { id: 'trace.updatedAt', label: 'Modificado el', group: 'Trazabilidad', aliases: ['modificado el', 'fecha de modificacion'], resolve: (r) => r.occurrence.updatedAt },
];

export const FIELDS_BY_ID = new Map(EXPORT_FIELDS.map((f) => [f.id, f]));

export function resolveField(id: string, record: FlatRecord): unknown {
  return FIELDS_BY_ID.get(id)?.resolve(record) ?? '';
}
