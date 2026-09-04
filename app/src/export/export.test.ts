import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import stationsSeed from '../data/seed/stations.json';
import taxaSeed from '../data/seed/taxa.json';
import type { Campaign, Occurrence, Project, SamplingEvent, Station, Taxon } from '../domain/types';
import { buildDwcArchive, OCCURRENCE_TERMS, toCsv } from './dwca';
import { NATIVE_TEMPLATE, guessField, type ExportTemplate } from './template';
import { buildWorkbook } from './workbook';
import { flatten, type Catalogs } from './shape';

const taxa = taxaSeed as unknown as Taxon[];
const byName = (n: string) => taxa.find((t) => t.commonName === n)!;

const project: Project = {
  id: 'p1', code: 'DEMO-01', name: 'Proyecto de demostración', client: 'Cliente demo', region: 'Valparaíso',
  utmZone: 19, utmHemisphere: 'S', geodeticDatum: 'WGS84',
  requirementProfileId: 'linea-base-fauna', methods: ['transecto', 'transito_aereo'],
};
const campaign: Campaign = { id: 'c1', projectId: 'p1', name: 'Primavera', season: 'Primavera' };
const rawStation = (stationsSeed as Array<Record<string, unknown>>)[0];
const station: Station = {
  id: 's1', projectId: 'p1', stationCode: 'EMF01', finalStationCode: 'EMF01',
  darwinCoreLocationId: 'urn:proterr:demo-01:loc:emf01',
  region: 'Valparaíso', season: 'Primavera', habitat: 'Matorral esclerófilo', slopeAspect: 'Plano',
  utmEast: rawStation.utmEast as number, utmNorth: rawStation.utmNorth as number,
  utmStartEast: null, utmStartNorth: null, utmEndEast: null, utmEndNorth: null,
  latitude: -31.2465, longitude: -71.5312,
  methods: ['transecto'], sites: [], recordedBy: 'Isaac Rojas', identifiedBy: null,
};

const audit = {
  createdAt: '2026-09-04T10:34:00-04:00', createdBy: 'u1', updatedAt: '2026-09-04T10:34:00-04:00',
  updatedBy: 'u1', deletedAt: null, deviceId: 'dev1', syncState: 'pending' as const,
  syncError: null, syncedAt: null, revision: 1,
};

function event(id: string, method: SamplingEvent['method']): SamplingEvent {
  return {
    id, projectId: 'p1', campaignId: 'c1', stationId: 's1', siteId: null, method,
    eventDate: '2026-09-04', eventTime: '10:34', timezone: 'America/Santiago',
    utcOffsetMinutes: -240, deviceTimestamp: '2026-09-04T14:34:00Z', dateTimeEditedByUser: false,
    recordedBy: 'Equipo de terreno', weather: 'Despejado', notes: null, deviceFix: null, ...audit,
  };
}

function occurrence(id: string, eventId: string, patch: Partial<Occurrence>): Occurrence {
  return {
    id, eventId, occurrenceId: `urn:proterr:demo-01:occ:${id}`,
    occurrenceTime: '10:34',
    taxonId: byName('Chucao').id, verbatimTaxonText: null,
    recordType: 'Vocalización', evidenceKind: 'Directo', individualCount: 1,
    sex: null, sexScope: 'sin_definir', lifeStage: null, lifeStageScope: 'sin_definir',
    organismCondition: 'Vivo', behaviour: 'Vocalizando', notes: null, occurrenceFix: null,
    aerial: null, source: 'voz', verbatimUtterance: 'EMF01 chucao uno sonido',
    mediaIds: [], pendingFields: [], ...audit, ...patch,
  };
}

const catalogs: Catalogs = {
  projects: new Map([[project.id, project]]),
  campaigns: new Map([[campaign.id, campaign]]),
  stations: new Map([[station.id, station]]),
  taxa: new Map(taxa.map((t) => [t.id, t])),
};

const e1 = event('e1', 'transecto');
const e2 = event('e2', 'transito_aereo');
const e3 = event('e3', 'trampa_sherman');
const occs = [
  occurrence('o1', 'e1', {}),
  occurrence('o2', 'e1', { taxonId: byName('Puma').id, recordType: 'Fecas', evidenceKind: 'Indirecto', individualCount: null, behaviour: null }),
  occurrence('o3', 'e2', {
    taxonId: byName('Cóndor').id, recordType: 'Individuo', individualCount: 2, behaviour: 'Volando',
    aerial: { flightDirection: 'N', destination: 'N', flightHeightMeters: 20, flightHeightCategory: '3', origin: 'S' },
  }),
  occurrence('o4', 'e1', { deletedAt: '2026-09-04T11:00:00-04:00' }),
  occurrence('o5', 'e3', {
    taxonId: byName('Ratón oliváceo').id, recordType: 'Individuo', individualCount: 1,
    behaviour: null, trapNumber: '11', organismId: 'M-07', recapture: false,
  }),
];
const records = flatten(occs, new Map([[e1.id, e1], [e2.id, e2], [e3.id, e3]]), catalogs);

describe('aplanado', () => {
  it('omite los registros borrados lógicamente', () => {
    expect(records).toHaveLength(4);
  });
});

describe('exportación por plantilla', () => {
  const wb = buildWorkbook(records, NATIVE_TEMPLATE, {
    placeholders: { cliente: 'Cliente demo', proyecto: 'Proyecto de demostración' },
  });

  it('la hoja del plan sale con lo planificado, se haya hecho o no', () => {
    // La estación declara dos metodologías y sólo se hizo una; la otra
    // quedó marcada como no realizada, con su motivo.
    const planeada: Station = { ...station, methods: ['transecto', 'trampa_sherman'] };
    const noRealizado = {
      ...event('e9', 'trampa_sherman'),
      performed: false, notPerformedReason: 'camino cortado',
    };
    const conPlan = buildWorkbook(records, NATIVE_TEMPLATE, {
      events: [e1, e2, e3, noRealizado], stations: [planeada],
    });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(conPlan.Sheets.Plan);
    const sherman = filas.find((f) => f['Metodología'] === 'Trampas Sherman')!;
    expect(sherman['¿Se realizó?']).toBe('NO');
    expect(sherman['¿Por qué no se realizó?']).toBe('camino cortado');
    expect(filas.some((f) => f['Metodología'] === 'Transecto')).toBe(true);
  });

  it('una celda del plan que nadie tocó sale en blanco, no marcada', () => {
    const planeada: Station = { ...station, methods: ['transecto', 'playback_aves'] };
    const conPlan = buildWorkbook(records, NATIVE_TEMPLATE, { events: [e1], stations: [planeada] });
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(conPlan.Sheets.Plan, { defval: '' });
    const pendiente = filas.find((f) => f['Metodología'] === 'Playback aves')!;
    // Pendiente no es lo mismo que "no se realizó": esa distinción es el dato.
    expect(pendiente['¿Se realizó?']).toBe('');
    expect(pendiente['ID Estación']).toBe('EMF01');
  });

  it('produce las hojas que declara la plantilla, no un formato fijo', () => {
    expect(wb.SheetNames).toEqual(NATIVE_TEMPLATE.sheets.map((sh) => sh.name));
  });

  it('escribe los encabezados exactos de la plantilla', () => {
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Registros, { header: 1 })[0] as string[];
    expect(header).toEqual(NATIVE_TEMPLATE.sheets[0].columns.map((c) => c.header));
  });

  it('no mezcla las columnas de vuelo en la hoja de registros', () => {
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Registros, { header: 1 })[0] as string[];
    expect(header.some((h) => /vuelo|altura/i.test(h))).toBe(false);
    const codes = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Registros)
      .map((r) => r['Metodología']);
    expect(codes).not.toContain('Tránsito aéreo');
  });

  it('lleva el trampeo a su propia hoja, con la trampa donde cayó el animal', () => {
    const trampeo = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Trampeo);
    expect(trampeo).toHaveLength(1);
    expect(trampeo[0]['Nombre común']).toBe('Ratón oliváceo');
    expect(trampeo[0]['N° de trampa']).toBe('11');
    expect(trampeo[0]['Código del individuo']).toBe('M-07');
    // Y no aparece además en la hoja general.
    const registros = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Registros);
    expect(registros.map((r) => r['Nombre común'])).not.toContain('Ratón oliváceo');
  });

  it('lleva el tránsito aéreo a su propia hoja, con origen y destino de vuelo', () => {
    const aerea = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Tránsito aéreo']);
    expect(aerea).toHaveLength(1);
    expect(aerea[0]['Nombre común']).toBe('Cóndor');
    expect(aerea[0]['Origen del vuelo']).toBe('S');
    expect(aerea[0]['Destino del vuelo']).toBe('N');
  });

  it('resuelve contra el catálogo lo que antes eran fórmulas de la planilla', () => {
    const first = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Registros)[0];
    expect(first['Proyecto']).toBe('Proyecto de demostración');
    expect(first['Región']).toBe('Valparaíso');
    expect(first['Nombre común']).toBe('Chucao');
    expect(first['Nombre científico']).toBe('Scelorchilus rubecula');
    expect(first['Clase']).toBe('Aves');
    expect(first['Familia']).toBe('Rhinocryptidae');
    expect(first['Hora']).toBe('10:34');
  });

  it('deja la abundancia vacía en evidencia indirecta, no en 0', () => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Registros, { defval: '' });
    const fecas = rows.find((r) => r['Tipo de registro'] === 'Fecas')!;
    expect(fecas['Abundancia']).toBe('');
    expect(fecas['Directo/Indirecto']).toBe('Indirecto');
  });

  it('una plantilla de otra consultora produce SUS columnas y SU orden', () => {
    // Lo que define la salida es la plantilla, no el código.
    const ajena: ExportTemplate = {
      id: 'otra', name: 'Consultora X', createdAt: '2026-01-01T00:00:00Z',
      sheets: [{
        name: 'FORMULARIO',
        scope: 'registros_todos',
        preamble: [['Consultora X'], ['Cliente:', '{{cliente}}'], []],
        columns: [
          { header: 'ESPECIE', fieldId: 'occurrence.commonName' },
          { header: 'N', fieldId: 'occurrence.count' },
          { header: 'PUNTO', fieldId: 'station.code' },
          { header: 'RESERVADO', fieldId: null },
        ],
      }],
    };
    const otro = buildWorkbook(records, ajena, { placeholders: { cliente: 'Minera Y' } });
    expect(otro.SheetNames).toEqual(['FORMULARIO']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(otro.Sheets.FORMULARIO, { header: 1, blankrows: true });
    expect(rows[0]).toEqual(['Consultora X']);
    expect(rows[1]).toEqual(['Cliente:', 'Minera Y']);   // el preámbulo se rellena
    expect(rows[3]).toEqual(['ESPECIE', 'N', 'PUNTO', 'RESERVADO']);
    const firstRow = rows[4] as unknown[];
    expect(firstRow[0]).toBe('Chucao');
    expect(firstRow[2]).toBe('EMF01');
    expect(firstRow[3]).toBe('');                        // columna sin asignar: vacía
  });

  it('el tránsito aéreo va a su hoja si la plantilla lo separa', () => {
    const separada: ExportTemplate = {
      id: 'sep', name: 'Separada', createdAt: '2026-01-01T00:00:00Z',
      sheets: [
        { name: 'General', scope: 'registros', columns: [{ header: 'Especie', fieldId: 'occurrence.commonName' }] },
        { name: 'Vuelo', scope: 'transito_aereo', columns: [
          { header: 'Especie', fieldId: 'occurrence.commonName' },
          { header: 'Altura', fieldId: 'aerial.heightMeters' },
        ] },
      ],
    };
    const otro = buildWorkbook(records, separada);
    const vuelo = XLSX.utils.sheet_to_json<Record<string, unknown>>(otro.Sheets.Vuelo);
    expect(vuelo).toHaveLength(1);
    expect(vuelo[0]['Especie']).toBe('Cóndor');
    expect(vuelo[0]['Altura']).toBe(20);
    const general = XLSX.utils.sheet_to_json<Record<string, unknown>>(otro.Sheets.General);
    expect(general.some((r) => r['Especie'] === 'Cóndor')).toBe(false);
  });
});

describe('reconocimiento de encabezados ajenos', () => {
  it('empareja los nombres habituales de otras consultoras', () => {
    const casos: Array<[string, string]> = [
      ['Nombre común', 'occurrence.commonName'],
      ['NOMBRE CIENTIFICO', 'taxon.scientificName'],
      ['Abundancia', 'occurrence.count'],
      ['N° de individuos', 'occurrence.count'],
      ['ID Estación', 'station.code'],
      ['Punto', 'station.code'],
      ['Metodología usada para registro', 'event.method'],
      ['Estado desarrollo', 'occurrence.lifeStage'],
      ['UTM E Estación (X)', 'station.utmEast'],
      ['Dirección de vuelo', 'aerial.direction'],
      ['Muestreado por', 'event.recordedBy'],
    ];
    for (const [header, expected] of casos) {
      expect([header, guessField(header).fieldId]).toEqual([header, expected]);
    }
  });

  it('no adivina cuando no reconoce: prefiere dejarlo sin asignar', () => {
    expect(guessField('Columna interna 47').fieldId).toBeNull();
    expect(guessField('').fieldId).toBeNull();
  });
});

describe('exportación Darwin Core', () => {
  const archive = buildDwcArchive(records, { title: 'Línea base de demostración' });

  it('genera los archivos del Darwin Core Archive', () => {
    expect(Object.keys(archive)).toEqual(['event.txt', 'occurrence.txt', 'measurementorfact.txt', 'meta.xml', 'eml.xml']);
    expect(archive['meta.xml']).toContain('rowType="http://rs.tdwg.org/dwc/terms/Event"');
    expect(archive['meta.xml']).toContain('occurrence.txt');
  });

  it('escribe un evento por muestreo, no uno por observación', () => {
    const lines = archive['event.txt'].trim().split('\n');
    expect(lines).toHaveLength(4); // encabezado + 3 eventos
  });

  it('usa basisOfRecord válido y no inventa individuos en evidencia indirecta', () => {
    const lines = archive['occurrence.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    expect(header).toEqual(OCCURRENCE_TERMS);
    const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])));
    expect(new Set(rows.map((r) => r.basisOfRecord))).toEqual(new Set(['HumanObservation']));
    const fecas = rows.find((r) => r.occurrenceRemarks.includes('tipoRegistro=Fecas'))!;
    expect(fecas.individualCount).toBe('');
    expect(fecas.scientificName).toBe('Puma concolor');
  });

  it('lleva los datos de vuelo a MeasurementOrFact', () => {
    const mof = archive['measurementorfact.txt'].trim().split('\n').slice(1).map((l) => l.split('\t'));
    const types = mof.map((r) => r[1]);
    expect(types).toContain('alturaDeVuelo');
    expect(types).toContain('direccionDeVuelo');
    expect(mof.find((r) => r[1] === 'alturaDeVuelo')?.[2]).toBe('20');
  });

  it('exporta CSV con el mismo encabezado Darwin Core', () => {
    const csv = toCsv(records);
    expect(csv.split('\n')[0]).toBe(OCCURRENCE_TERMS.join(','));
    expect(csv.trim().split('\n')).toHaveLength(5);
  });
});

describe('esfuerzo, conservación y datos sensibles', () => {
  const withEffort = { ...e1, distanceMeters: 1500, startedAt: '2026-09-04T14:00:00Z', endedAt: '2026-09-04T15:00:00Z' };
  const emptyEvent: SamplingEvent = {
    ...event('e3', 'transecto'), noDetections: true, distanceMeters: 800,
    startedAt: '2026-09-04T16:00:00Z', endedAt: '2026-09-04T16:40:00Z',
  };
  const condorOcc = occurrence('o5', 'e1', {
    taxonId: byName('Cóndor').id, recordType: 'Individuo', individualCount: 1,
    identificationConfidence: 'probable',
    occurrenceFix: { latitude: -31.24657, longitude: -71.53128, accuracyMeters: 6, fixedAt: '2026-09-04T14:34:00Z' },
  });
  const withCondor = flatten(
    [...occs, condorOcc],
    new Map([[withEffort.id, withEffort], [e2.id, e2]]),
    catalogs,
  );

  it('la hoja de muestreos trae el esfuerzo por evento, incluidos los vacíos', () => {
    const wb = buildWorkbook(withCondor, NATIVE_TEMPLATE, { events: [withEffort, e2, emptyEvent] });
    expect(wb.SheetNames).toContain('Muestreos');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Muestreos, { defval: '' });
    expect(rows).toHaveLength(3);
    const transecto = rows.find((r) => r['ID del muestreo'] === 'e1')!;
    expect(transecto['Distancia recorrida (m)']).toBe(1500);
    expect(transecto['Duración (min)']).toBe(60);
    expect(rows.some((r) => r['ID del muestreo'] === 'e3')).toBe(true); // el muestreo sin detecciones
  });

  it('la conservación y la confianza salen como columnas del catálogo de campos', () => {
    const wb = buildWorkbook(withCondor, NATIVE_TEMPLATE, {});
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Registros, { defval: '' });
    const condor = rows.find((r) => String(r['ID del registro']).endsWith(':occ:o5'))!;
    expect(String(condor['Categoría de conservación'])).toContain('VU');
    expect(String(condor['Fuente de conservación'])).toContain('EJEMPLO');
    expect(condor['Confianza de identificación']).toBe('probable');
  });

  it('exporta los muestreos sin detecciones como ausencia Darwin Core', () => {
    const archive = buildDwcArchive(withCondor, { title: 'x', events: [withEffort, e2, emptyEvent] });
    const lines = archive['occurrence.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])));
    const absent = rows.find((r) => r.occurrenceStatus === 'absent')!;
    expect(absent.individualCount).toBe('0');
    expect(absent.occurrenceRemarks).toContain('sin detecciones');
    expect(rows.filter((r) => r.occurrenceStatus === 'present')).toHaveLength(4);
  });

  it('escribe el esfuerzo en los términos Darwin Core del evento', () => {
    const archive = buildDwcArchive(withCondor, { title: 'x' });
    const lines = archive['event.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    const row = Object.fromEntries(lines[1].split('\t').map((v, i) => [header[i], v]));
    expect(row.sampleSizeValue).toBe('1500');
    expect(row.sampleSizeUnit).toBe('m');
    expect(row.samplingEffort).toBe('1 h · 1,50 km');
  });

  it('marca la duda con el calificador que corresponde', () => {
    const archive = buildDwcArchive(withCondor, { title: 'x' });
    const lines = archive['occurrence.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])));
    const condor = rows.find((r) => r.occurrenceID.endsWith(':occ:o5'))!;
    expect(condor.identificationQualifier).toBe('cf.'); // "probable", no certeza
    expect(condor.occurrenceRemarks).toContain('conservacion=VU');
  });

  it('generaliza la coordenada de una especie sensible al entregar a terceros', () => {
    const exacta = buildDwcArchive(withCondor, { title: 'x', policy: 'exacta' });
    const generalizada = buildDwcArchive(withCondor, { title: 'x', policy: 'generalizada' });
    const read = (archive: Record<string, string>) => {
      const lines = archive['occurrence.txt'].trim().split('\n');
      const header = lines[0].split('\t');
      return lines.slice(1)
        .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])))
        .find((r) => r.occurrenceID.endsWith(':occ:o5'))!;
    };
    expect(read(exacta).decimalLatitude).toBe('-31.24657');
    // Las coordenadas salen a 6 decimales: más dígitos son ruido de la conversión.
    const chucaoLat = exacta['occurrence.txt'].split('\n').slice(1)
      .map((l) => l.split('\t'))
      .find((c) => c.includes('Scelorchilus rubecula'))![OCCURRENCE_TERMS.indexOf('decimalLatitude')];
    expect(chucaoLat.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
    expect(read(exacta).dataGeneralizations).toBe('');

    const gen = read(generalizada);
    expect(Number(gen.decimalLatitude)).toBeCloseTo(-31.25, 4);
    expect(gen.dataGeneralizations).toContain('generalizadas');
    expect(Number(gen.coordinateUncertaintyInMeters)).toBeGreaterThanOrEqual(1100);
  });

  it('no toca las coordenadas de una especie no sensible', () => {
    const generalizada = buildDwcArchive(withCondor, { title: 'x', policy: 'generalizada' });
    const lines = generalizada['occurrence.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    const chucao = lines.slice(1)
      .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])))
      .find((r) => r.scientificName === 'Scelorchilus rubecula')!;
    expect(chucao.dataGeneralizations).toBe('');
  });

  it('omitir es más fuerte que generalizar', () => {
    const omitida = buildDwcArchive(withCondor, { title: 'x', policy: 'omitida' });
    const lines = omitida['occurrence.txt'].trim().split('\n');
    const header = lines[0].split('\t');
    const condor = lines.slice(1)
      .map((l) => Object.fromEntries(l.split('\t').map((v, i) => [header[i], v])))
      .find((r) => r.occurrenceID.endsWith(':occ:o5'))!;
    expect(condor.decimalLatitude).toBe('');
    expect(condor.informationWithheld).toContain('omitidas');
  });
});
