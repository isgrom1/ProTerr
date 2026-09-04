/**
 * Exportación Darwin Core.
 *
 * El modelo interno ya es Darwin Core (Event -> Occurrence, con Taxon y
 * Location como catálogos), así que esto es una proyección directa y no una
 * traducción forzada: es la razón de haber separado las entidades desde el
 * inicio en vez de replicar la fila plana de la planilla.
 *
 * Produce los archivos de un Darwin Core Archive: event.txt, occurrence.txt,
 * measurementorfact.txt y meta.xml. El empaquetado en .zip lo hace quien llame
 * (en la app, con la API de compresión del navegador).
 */
import type { SamplingEvent } from '../domain/types';
import { flagFor } from '../conservation/status';
import { summarizeEffort } from '../effort/session';
import { applySensitivity, type SensitivityPolicy } from './sensitive';
import type { FlatRecord } from './shape';
import { coordinatesOf } from './shape';

const SEP = '\t';

function tsv(headers: string[], rows: unknown[][]): string {
  const esc = (v: unknown) =>
    v === null || v === undefined ? '' : String(v).replace(/[\t\r\n]+/g, ' ').trim();
  return [headers.join(SEP), ...rows.map((r) => r.map(esc).join(SEP))].join('\n') + '\n';
}

export const EVENT_TERMS = [
  'eventID', 'eventDate', 'eventTime', 'year', 'month', 'day',
  'samplingProtocol', 'sampleSizeValue', 'sampleSizeUnit',
  'samplingEffort', 'locationID', 'locality',
  'decimalLatitude', 'decimalLongitude', 'geodeticDatum', 'coordinateUncertaintyInMeters',
  'verbatimCoordinates', 'verbatimCoordinateSystem', 'verbatimSRS',
  'country', 'countryCode', 'stateProvince', 'habitat', 'recordedBy',
  'fieldNotes', 'parentEventID', 'eventRemarks',
];

export const OCCURRENCE_TERMS = [
  'occurrenceID', 'eventID', 'basisOfRecord', 'occurrenceStatus', 'individualCount',
  'organismID', 'dataGeneralizations', 'informationWithheld',
  'organismQuantity', 'organismQuantityType', 'sex', 'lifeStage', 'behavior',
  'reproductiveCondition', 'vitality', 'establishmentMeans', 'recordedBy',
  'identifiedBy', 'dateIdentified', 'identificationRemarks', 'occurrenceRemarks',
  'associatedMedia', 'decimalLatitude', 'decimalLongitude', 'coordinateUncertaintyInMeters',
  'scientificName', 'vernacularName', 'kingdom', 'phylum', 'class', 'order', 'family',
  'genus', 'specificEpithet', 'infraspecificEpithet', 'taxonRank', 'identificationQualifier',
];

export const MOF_TERMS = ['occurrenceID', 'measurementType', 'measurementValue', 'measurementUnit', 'measurementMethod'];

/**
 * dwc:basisOfRecord. Sólo dos valores son correctos aquí: lo observado en
 * terreno es HumanObservation; una foto de cámara trampa es MachineObservation.
 * El detalle fino ("fecas", "huella") va en occurrenceRemarks y en MeasurementOrFact,
 * que es donde Darwin Core lo espera.
 */
function basisOfRecord(r: FlatRecord): string {
  if (r.event.method === 'camara_trampa' || r.event.method === 'songmeter') return 'MachineObservation';
  return 'HumanObservation';
}

export function eventRows(records: FlatRecord[]): string {
  const seen = new Set<string>();
  const rows: unknown[][] = [];
  for (const r of records) {
    if (seen.has(r.event.id)) continue;
    seen.add(r.event.id);
    const c = coordinatesOf(r);
    const [y, m, d] = r.event.eventDate.split('-');
    // sampleSizeValue/Unit y samplingEffort son los términos con que Darwin
    // Core expresa el esfuerzo. Sin ellos la abundancia no es interpretable.
    const effort = summarizeEffort(r.event);
    const [sizeValue, sizeUnit] = effort.unit === 'distancia' && effort.distanceMeters != null
      ? [effort.distanceMeters, 'm']
      : effort.unit === 'trampas-noche' && effort.trapNights != null
        ? [effort.trapNights, 'trap-nights']
        : effort.durationMinutes != null ? [effort.durationMinutes, 'minutes'] : ['', ''];
    rows.push([
      r.event.id, r.event.eventDate, r.event.eventTime, y, Number(m), Number(d),
      r.event.method, sizeValue, sizeUnit, effort.label,
      r.station?.darwinCoreLocationId ?? '', r.station?.stationCode ?? '',
      c.latitude ?? '', c.longitude ?? '', c.datum, r.event.deviceFix?.accuracyMeters ?? '',
      c.utmEast != null ? `${c.zone ?? ''}${c.utmEast} ${c.utmNorth}` : '',
      'UTM', c.datum,
      'Chile', 'CL', r.station?.region ?? '', r.station?.habitat ?? '',
      r.event.recordedBy ?? r.station?.recordedBy ?? '',
      r.event.notes ?? '', r.campaign?.id ?? '',
      eventRemarks(r),
    ]);
  }
  return tsv(EVENT_TERMS, rows);
}

function eventRemarks(r: FlatRecord): string {
  const c = r.event.conditions;
  return [
    r.event.weather ? `Clima: ${r.event.weather}` : null,
    c?.period ? `Periodo: ${c.period}` : null,
    c?.temperatureC != null ? `Temperatura: ${c.temperatureC} °C` : null,
    c?.windBeaufort != null ? `Viento Beaufort: ${c.windBeaufort}` : null,
    c?.cloudOctas != null ? `Nubosidad: ${c.cloudOctas}/8` : null,
    c?.precipitation ? `Precipitación: ${c.precipitation}` : null,
    r.event.noDetections ? 'Muestreo sin detecciones' : null,
    r.event.incidental ? 'Registro oportunista fuera de estación' : null,
  ].filter(Boolean).join('; ');
}

/**
 * Muestreos sin detecciones. GBIF los representa como una ocurrencia con
 * `occurrenceStatus=absent`: una estación recorrida sin fauna es un dato de
 * ausencia, y omitirla convierte la campaña en un sesgo de sólo-presencias.
 */
function absenceRows(records: FlatRecord[], events: SamplingEvent[]): unknown[][] {
  const withRecords = new Set(records.map((r) => r.event.id));
  return events
    .filter((e) => !e.deletedAt && e.noDetections && !withRecords.has(e.id))
    .map((e) => {
      const row = new Array(OCCURRENCE_TERMS.length).fill('');
      const at = (term: string, value: unknown) => { row[OCCURRENCE_TERMS.indexOf(term)] = value; };
      at('occurrenceID', `${e.id}:absent`);
      at('eventID', e.id);
      at('basisOfRecord', e.method === 'camara_trampa' || e.method === 'songmeter' ? 'MachineObservation' : 'HumanObservation');
      at('occurrenceStatus', 'absent');
      at('individualCount', 0);
      at('recordedBy', e.recordedBy ?? '');
      at('occurrenceRemarks', 'Muestreo realizado sin detecciones de fauna.');
      return row;
    });
}

export function occurrenceRows(
  records: FlatRecord[],
  options: { policy?: SensitivityPolicy; events?: SamplingEvent[] } = {},
): string {
  const policy = options.policy ?? 'exacta';
  const rows: unknown[][] = records.map((r) => {
    const o = r.occurrence;
    const t = r.taxon;
    const c = coordinatesOf(r);
    const flag = flagFor(t);
    const applied = applySensitivity(r, {
      latitude: o.occurrenceFix?.latitude ?? c.latitude,
      longitude: o.occurrenceFix?.longitude ?? c.longitude,
      uncertaintyMeters: o.occurrenceFix?.accuracyMeters ?? null,
    }, policy);
    const remarks = [
      `tipoRegistro=${o.recordType}`,
      `evidencia=${o.evidenceKind}`,
      o.sexScope === 'algunos' ? 'sexoAplicaAAlgunosIndividuos' : null,
      o.lifeStageScope === 'algunos' ? 'estadoAplicaAAlgunosIndividuos' : null,
      o.occurrenceTime && o.occurrenceTime !== r.event.eventTime ? `hora=${o.occurrenceTime}` : null,
      o.detectionDistanceMeters != null ? `distanciaDeteccion=${o.detectionDistanceMeters} m` : null,
      o.recapture ? 'recaptura' : null,
      flag.badge ? `conservacion=${flag.badge}` : null,
      o.reviewState && o.reviewState !== 'terreno' ? `revision=${o.reviewState}` : null,
      o.notes,
    ].filter(Boolean).join('; ');
    return [
      o.occurrenceId, r.event.id, basisOfRecord(r), 'present',
      o.individualCount ?? '',
      o.organismId ?? '', applied.dataGeneralizations ?? '', applied.informationWithheld ?? '',
      o.individualCount ?? '', o.individualCount != null ? 'individuos' : '',
      o.sex ?? '', o.lifeStage ?? '', o.behaviour ?? '',
      '', o.organismCondition ?? '', '',
      r.event.recordedBy ?? r.station?.recordedBy ?? '',
      r.station?.identifiedBy ?? '', '', '',
      remarks,
      o.mediaIds.join(' | '),
      applied.latitude ?? '', applied.longitude ?? '', applied.uncertaintyMeters ?? '',
      t?.scientificName ?? '', t?.commonName ?? o.verbatimTaxonText ?? '',
      t?.kingdom ?? '', t?.phylum ?? '', t?.class ?? '', t?.order ?? '',
      t?.family ?? '', t?.genus ?? '', t?.specificEpithet ?? '', t?.infraspecificEpithet ?? '',
      t?.taxonRank ?? '', identificationQualifier(r),
    ];
  });
  rows.push(...absenceRows(records, options.events ?? []));
  return tsv(OCCURRENCE_TERMS, rows);
}

/**
 * dwc:identificationQualifier. 'cf.' es la convención para "probablemente
 * esta especie" y '?' para una determinación insegura; el comodín de grupo
 * se marca 'sp.'. Guardar una duda como certeza es fabricar un dato.
 */
function identificationQualifier(r: FlatRecord): string {
  const confidence = r.occurrence.identificationConfidence ?? 'seguro';
  if (confidence === 'probable') return 'cf.';
  if (confidence === 'posible') return '?';
  return r.taxon?.isPlaceholder ? 'sp.' : '';
}

/**
 * Todo lo que no cabe en un término estándar de Occurrence viaja aquí:
 * altura y dirección de vuelo, respuesta al playback, etc. Es el mecanismo
 * previsto por Darwin Core para extender sin romper el esquema (brief §6).
 */
export function measurementRows(records: FlatRecord[]): string {
  const rows: unknown[][] = [];
  for (const r of records) {
    const o = r.occurrence;
    const a = o.aerial;
    if (a?.flightHeightMeters != null) rows.push([o.occurrenceId, 'alturaDeVuelo', a.flightHeightMeters, 'm', 'estimación visual']);
    if (a?.flightHeightCategory) rows.push([o.occurrenceId, 'categoriaAlturaDeVuelo', a.flightHeightCategory, '', 'categorías 1-5 de la planilla']);
    if (a?.flightDirection) rows.push([o.occurrenceId, 'direccionDeVuelo', a.flightDirection, '', '']);
    if (a?.origin) rows.push([o.occurrenceId, 'origenDeVuelo', a.origin, '', '']);
    if (a?.destination) rows.push([o.occurrenceId, 'destinoDeVuelo', a.destination, '', '']);
    for (const f of r.facts) {
      rows.push([o.occurrenceId, f.measurementType, f.measurementValue, f.measurementUnit ?? '', f.measurementMethod ?? '']);
    }
  }
  return tsv(MOF_TERMS, rows);
}

function fieldsXml(terms: string[], startIndex: number, namespace: string): string {
  return terms
    .map((term, i) => `    <field index="${startIndex + i}" term="${namespace}${term}"/>`)
    .join('\n');
}

export function metaXml(): string {
  const DWC = 'http://rs.tdwg.org/dwc/terms/';
  return `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" ignoreHeaderLines="1" rowType="${DWC}Event">
    <files><location>event.txt</location></files>
    <id index="0"/>
${fieldsXml(EVENT_TERMS, 0, DWC)}
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" ignoreHeaderLines="1" rowType="${DWC}Occurrence">
    <files><location>occurrence.txt</location></files>
    <coreid index="1"/>
${fieldsXml(OCCURRENCE_TERMS, 0, DWC)}
  </extension>
  <extension encoding="UTF-8" fieldsTerminatedBy="\\t" linesTerminatedBy="\\n" ignoreHeaderLines="1" rowType="${DWC}MeasurementOrFact">
    <files><location>measurementorfact.txt</location></files>
    <coreid index="0"/>
${fieldsXml(MOF_TERMS, 0, DWC)}
  </extension>
</archive>
`;
}

export function emlXml(meta: { title: string; abstract?: string; contact?: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="https://eml.ecoinformatics.org/eml-2.2.0" packageId="proterr-${Date.now()}" system="ProTerr">
  <dataset>
    <title>${escapeXml(meta.title)}</title>
    <abstract><para>${escapeXml(meta.abstract ?? 'Línea base de fauna registrada en terreno con ProTerr.')}</para></abstract>
    <contact><individualName><surName>${escapeXml(meta.contact ?? 'Equipo de terreno')}</surName></individualName></contact>
  </dataset>
</eml:eml>
`;
}

function escapeXml(v: string): string {
  return v.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

/** Los archivos del DwC-A, listos para empaquetar en un .zip. */
export interface DwcArchive extends Record<string, string> {
  'event.txt': string;
  'occurrence.txt': string;
  'measurementorfact.txt': string;
  'meta.xml': string;
  'eml.xml': string;
}

export interface DwcArchiveOptions {
  title: string;
  abstract?: string;
  contact?: string;
  /** Política de coordenadas para especies sensibles; ver export/sensitive.ts. */
  policy?: SensitivityPolicy;
  /** Eventos completos, para poder exportar los muestreos sin detecciones. */
  events?: SamplingEvent[];
}

export function buildDwcArchive(records: FlatRecord[], meta: DwcArchiveOptions): DwcArchive {
  return {
    'event.txt': eventRows(records),
    'occurrence.txt': occurrenceRows(records, { policy: meta.policy, events: meta.events }),
    'measurementorfact.txt': measurementRows(records),
    'meta.xml': metaXml(),
    'eml.xml': emlXml(meta),
  };
}

/** CSV plano para quien sólo quiere una tabla (brief §22). */
export function toCsv(records: FlatRecord[], policy: SensitivityPolicy = 'exacta'): string {
  const header = OCCURRENCE_TERMS;
  const body = occurrenceRows(records, { policy }).split('\n').slice(1).filter(Boolean);
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header.join(','), ...body.map((line) => line.split(SEP).map(quote).join(','))].join('\n') + '\n';
}
