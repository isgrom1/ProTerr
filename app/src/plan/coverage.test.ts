/**
 * El plan es la grilla con que sale el equipo a terreno: estación por
 * metodología. Lo que importa probar es que las tres situaciones se
 * distingan, porque en la planilla se llenan en columnas distintas.
 */
import { describe, expect, it } from 'vitest';
import type { MethodCode, SamplingEvent, Station } from '../domain/types';
import { pending, summarizePlan } from './coverage';

const audit = {
  createdAt: '2026-06-02T10:00:00Z', createdBy: 'u1', updatedAt: '2026-06-02T10:00:00Z',
  updatedBy: 'u1', deletedAt: null, deviceId: 'dev1', syncState: 'pending' as const,
  syncError: null, syncedAt: null, revision: 1,
};

function station(code: string, methods: MethodCode[]): Station {
  return {
    id: `st_${code}`, projectId: 'p1', stationCode: code, finalStationCode: code,
    darwinCoreLocationId: `urn:demo:${code}`, region: null, season: null, habitat: null,
    slopeAspect: null, utmEast: null, utmNorth: null,
    utmStartEast: null, utmStartNorth: null, utmEndEast: null, utmEndNorth: null,
    latitude: null, longitude: null, methods, sites: [], recordedBy: null, identifiedBy: null,
  };
}

function event(stationId: string, method: MethodCode, patch: Partial<SamplingEvent> = {}): SamplingEvent {
  return {
    id: `ev_${stationId}_${method}`, projectId: 'p1', campaignId: 'c1', stationId, siteId: null,
    method, eventDate: '2026-06-02', eventTime: '10:00', timezone: 'America/Santiago',
    utcOffsetMinutes: -240, deviceTimestamp: '2026-06-02T14:00:00Z', dateTimeEditedByUser: false,
    recordedBy: 'Equipo 3', weather: null, notes: null, deviceFix: null, ...audit, ...patch,
  };
}

const stations = [
  station('EM01', ['transecto', 'camara_trampa']),
  station('EM02', ['transecto']),
  station('EM03', ['transecto']),
];

describe('cobertura del plan', () => {
  const events = [
    event('st_EM01', 'transecto'),
    event('st_EM01', 'camara_trampa', { performed: false, notPerformedReason: 'camino cortado' }),
    event('st_EM02', 'transecto', { noDetections: true }),
  ];
  const plan = summarizePlan(stations, events, { projectId: 'p1' });

  it('cuenta el plan completo, no sólo lo que se hizo', () => {
    expect(plan.planned).toBe(4); // EM01 x2 + EM02 + EM03
  });

  it('distingue realizado, no realizado y pendiente', () => {
    expect(plan.done).toBe(2);
    expect(plan.notPerformed).toBe(1);
    expect(plan.pending).toBe(1);
    expect(plan.coverage).toBeCloseTo(0.5);
  });

  it('recorrer y no ver nada es realizado, no pendiente', () => {
    const fila = plan.rows.find((r) => r.station.stationCode === 'EM02')!;
    expect(fila.state).toBe('realizado');
    expect(fila.noDetections).toBe(true);
  });

  it('conserva el motivo de lo que no se pudo hacer', () => {
    const fila = plan.rows.find((r) => r.method === 'camara_trampa')!;
    expect(fila.state).toBe('no realizado');
    expect(fila.reason).toBe('camino cortado');
  });

  it('lo pendiente sale ordenado para leerlo en terreno', () => {
    expect(pending(plan).map((r) => r.station.stationCode)).toEqual(['EM03']);
  });

  it('un muestreo fuera del plan no se pierde', () => {
    const extra = event('st_EM03', 'trampa_sherman');
    const otro = summarizePlan(stations, [...events, extra], { projectId: 'p1' });
    expect(otro.offPlan.map((e) => e.method)).toEqual(['trampa_sherman']);
    // Y no infla la cobertura: el plan sigue siendo el mismo.
    expect(otro.planned).toBe(4);
  });

  it('el muestreo borrado no cuenta como realizado', () => {
    const borrado = summarizePlan(stations, [
      { ...events[0], deletedAt: '2026-06-03T00:00:00Z' },
      ...events.slice(1),
    ], { projectId: 'p1' });
    expect(borrado.done).toBe(1);
    expect(borrado.pending).toBe(2);
  });
});
