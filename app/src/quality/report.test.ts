import { describe, expect, it } from 'vitest';
import taxaSeed from '../data/seed/taxa.json';
import type { Occurrence, SamplingEvent, Taxon } from '../domain/types';
import { analyzeQuality, tallyBySpecies } from './report';

const taxaList = taxaSeed as unknown as Taxon[];
const taxa = new Map(taxaList.map((t) => [t.id, t]));
const byName = (n: string) => taxaList.find((t) => t.commonName === n)!;

const audit = {
  createdAt: '2026-09-04T10:00:00-04:00', createdBy: 'u1', updatedAt: '2026-09-04T10:00:00-04:00',
  updatedBy: 'u1', deletedAt: null, deviceId: 'd1', syncState: 'pending' as const,
  syncError: null, syncedAt: null, revision: 1,
};

function event(patch: Partial<SamplingEvent> = {}): SamplingEvent {
  return {
    id: 'e1', projectId: 'p', campaignId: 'c', stationId: 's', siteId: null, method: 'transecto',
    eventDate: '2026-09-04', eventTime: '10:00', timezone: 'America/Santiago', utcOffsetMinutes: -240,
    deviceTimestamp: '2026-09-04T14:00:00Z', dateTimeEditedByUser: false,
    recordedBy: 'I. Rojas', weather: null, notes: null, deviceFix: null,
    startedAt: '2026-09-04T14:00:00Z', endedAt: '2026-09-04T15:00:00Z',
    distanceMeters: 1500, ...audit, ...patch,
  };
}

function occ(id: string, patch: Partial<Occurrence> = {}): Occurrence {
  return {
    id, eventId: 'e1', occurrenceId: `urn:x:${id}`, taxonId: byName('Chucao').id,
    occurrenceTime: '10:34',
    verbatimTaxonText: null, recordType: 'Vocalización', evidenceKind: 'Directo',
    individualCount: 1, sex: null, sexScope: 'sin_definir', lifeStage: null,
    lifeStageScope: 'sin_definir', organismCondition: null, behaviour: null, notes: null,
    occurrenceFix: null, aerial: null, source: 'voz', verbatimUtterance: null,
    mediaIds: [], pendingFields: [], ...audit, ...patch,
  };
}

describe('detección de duplicados', () => {
  it('agrupa registros idénticos guardados con segundos de diferencia', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('a', { createdAt: '2026-09-04T14:00:00Z' }),
        occ('b', { createdAt: '2026-09-04T14:00:20Z' }),
      ],
    });
    const dup = r.issues.find((i) => i.kind === 'duplicado')!;
    expect(dup.severity).toBe('alta');
    expect(dup.occurrenceIds).toEqual(['a', 'b']);
  });

  it('no marca como duplicado lo que está separado en el tiempo', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('a', { createdAt: '2026-09-04T14:00:00Z' }),
        occ('b', { createdAt: '2026-09-04T14:20:00Z' }),
      ],
    });
    expect(r.issues.some((i) => i.kind === 'duplicado')).toBe(false);
  });

  it('no confunde especies distintas en la misma hora', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('a', { createdAt: '2026-09-04T14:00:00Z' }),
        occ('b', { taxonId: byName('Rayadito').id, createdAt: '2026-09-04T14:00:10Z' }),
      ],
    });
    expect(r.issues.some((i) => i.kind === 'duplicado')).toBe(false);
  });
});

describe('esfuerzo y evidencia', () => {
  it('un registro rápido sin track NO se reporta como falta de esfuerzo', () => {
    // Es el modo normal: "EMF44 y las especies". La app no debe reclamar
    // un esfuerzo que nadie pidió medir.
    const r = analyzeQuality({
      events: [event({ startedAt: null, endedAt: null, distanceMeters: null, track: [], waypoints: [] })],
      taxa, occurrences: [occ('a')],
    });
    expect(r.issues.some((i) => i.kind === 'sin-esfuerzo')).toBe(false);
  });

  it('avisa sólo cuando se activó la medición y quedó a medias', () => {
    const r = analyzeQuality({
      events: [event({ startedAt: '2026-09-04T14:00:00Z', endedAt: null, distanceMeters: null, track: [], waypoints: [] })],
      taxa, occurrences: [occ('a')],
    });
    const gap = r.issues.find((i) => i.kind === 'sin-esfuerzo')!;
    expect(gap.message).toContain('quedó a medias');
  });

  it('un muestreo con esfuerzo completo no genera avisos de esfuerzo', () => {
    const r = analyzeQuality({ events: [event()], taxa, occurrences: [occ('a')] });
    expect(r.issues.some((i) => i.kind === 'sin-esfuerzo')).toBe(false);
  });

  it('echa de menos la coordenada sólo donde la ubicación significa algo', () => {
    const lagarto = taxaList.find((t) => t.commonName === 'Lagarto de Zapallar')!;
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('ave'),                                    // chucao: no necesita punto
        occ('rep', { taxonId: lagarto.id, recordType: 'Individuo' }),
      ],
    });
    const faltantes = r.issues.filter((i) => i.kind === 'sin-coordenada');
    expect(faltantes).toHaveLength(1);
    expect(faltantes[0].occurrenceIds).toEqual(['rep']);
    expect(faltantes[0].message).toContain('baja movilidad');
  });

  it('exige fotografía a las especies amenazadas', () => {
    const condor = byName('Cóndor');
    expect(condor.conservation?.rce).toBe('VU'); // viene de la capa de conservación
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [occ('a', { taxonId: condor.id, recordType: 'Individuo' })],
    });
    const issue = r.issues.find((i) => i.kind === 'sin-evidencia')!;
    expect(issue.severity).toBe('alta');
    expect(r.threatenedRecords).toBe(1);
  });

  it('marca una identificación dudosa sin evidencia', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [occ('a', { identificationConfidence: 'probable' })],
    });
    expect(r.issues.some((i) => i.kind === 'identificacion-dudosa')).toBe(true);
  });

  it('detecta un registro validado con campos aún pendientes', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [occ('a', { reviewState: 'validado', pendingFields: ['individualCount'] })],
    });
    expect(r.issues.some((i) => i.kind === 'sin-revisar' && i.severity === 'alta')).toBe(true);
  });

  it('cuenta como dato el muestreo sin detecciones', () => {
    const r = analyzeQuality({
      events: [event({ id: 'vacio', noDetections: true })], taxa, occurrences: [],
    });
    expect(r.emptyEvents).toBe(1);
  });
});

describe('tabla de especies', () => {
  it('agrupa por especie y ordena por abundancia', () => {
    const rows = tallyBySpecies([
      occ('a', { individualCount: 1 }),
      occ('b', { individualCount: 2 }),
      occ('c', { taxonId: byName('Rayadito').id, individualCount: 5 }),
      occ('d', { deletedAt: '2026-09-04T16:00:00Z' }),
    ], taxa);
    expect(rows.map((r) => [r.name, r.records, r.individuals])).toEqual([
      ['Rayadito', 1, 5],
      ['Chucao', 2, 3],
    ]);
  });

  it('marca amenazadas y exóticas', () => {
    const rows = tallyBySpecies([
      occ('a', { taxonId: byName('Cóndor').id }),
      occ('b', { taxonId: byName('Paloma').id }),
    ], taxa);
    expect(rows.find((r) => r.name === 'Cóndor')?.threatened).toBe(true);
    expect(rows.find((r) => r.name === 'Paloma')?.exotic).toBe(true);
  });
});

describe('lo dictado junto no es un duplicado', () => {
  it('varios grupos de la misma especie en una frase no se marcan', () => {
    // "Tres loicas vocalizando... dos loicas vocalizando" son grupos distintos.
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('a', { individualCount: 3, batchId: 'lote-1', createdAt: '2026-09-04T14:00:00Z' }),
        occ('b', { individualCount: 2, batchId: 'lote-1', createdAt: '2026-09-04T14:00:01Z' }),
      ],
    });
    expect(r.issues.some((i) => i.kind === 'duplicado')).toBe(false);
  });

  it('pero un re-dictado en otro lote sí se marca', () => {
    const r = analyzeQuality({
      events: [event()], taxa,
      occurrences: [
        occ('a', { batchId: 'lote-1', createdAt: '2026-09-04T14:00:00Z' }),
        occ('b', { batchId: 'lote-2', createdAt: '2026-09-04T14:00:20Z' }),
      ],
    });
    expect(r.issues.some((i) => i.kind === 'duplicado')).toBe(true);
  });
});
