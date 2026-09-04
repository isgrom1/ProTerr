/**
 * Los cuatro casos que se dan de verdad al anotar en la casa lo que faltó.
 */
import { describe, expect, it } from 'vitest';
import type { MethodCode, SamplingEvent } from '../domain/types';
import { resolveEntry } from './deferred';

const audit = {
  createdAt: '2026-09-03T10:00:00Z', createdBy: 'u1', updatedAt: '2026-09-03T10:00:00Z',
  updatedBy: 'u1', deletedAt: null, deviceId: 'dev1', syncState: 'pending' as const,
  syncError: null, syncedAt: null, revision: 1,
};

function event(date: string, method: MethodCode = 'transecto', stationId = 'st1'): SamplingEvent {
  return {
    id: `ev_${date}_${method}`, projectId: 'p1', campaignId: 'c1', stationId, siteId: null,
    method, eventDate: date, eventTime: '10:00', timezone: 'America/Santiago',
    utcOffsetMinutes: -240, deviceTimestamp: `${date}T14:00:00Z`, dateTimeEditedByUser: false,
    recordedBy: 'I. Rojas', weather: null, notes: null, deviceFix: null, ...audit,
  };
}

const HOY = '2026-09-04';
const AYER = '2026-09-03';
const base = { today: HOY, stationId: 'st1', method: 'transecto' as MethodCode };

describe('registro diferido', () => {
  it('un registro normal del día no advierte nada', () => {
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [event(HOY)] });
    expect(d.mode).toBe('normal');
    expect(d.method).toBe('transecto');
    expect(d.notice).toBeNull();
    expect(d.deferred).toBe(false);
  });

  it('la primera vez en una estación se abre el muestreo sin preguntar', () => {
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [] });
    expect(d.mode).toBe('normal');
    expect(d.method).toBe('transecto');
  });

  it('abrir un muestreo con fecha pasada es legítimo, pero se avisa', () => {
    // El terreno fue ayer y recién ahora se pasa a la app.
    const d = resolveEntry({ ...base, sightingDate: AYER, events: [] });
    expect(d.mode).toBe('olvido');
    expect(d.method).toBe('transecto');
    expect(d.eventDate).toBe(AYER);
    expect(d.deferred).toBe(true);
    expect(d.notice).toContain('no de hoy');
  });

  it('lo que se olvidó del mismo muestreo entra a ese muestreo', () => {
    // "Ayer en el EMF44 no puse que había una loica macho", y ayer sí hubo
    // transecto ahí: el registro es de ese transecto.
    const d = resolveEntry({ ...base, sightingDate: AYER, events: [event(AYER)] });
    expect(d.mode).toBe('olvido');
    expect(d.method).toBe('transecto');
    expect(d.eventDate).toBe(AYER);
    expect(d.deferred).toBe(true);
    expect(d.notice).toContain('transecto del 3 de septiembre');
  });

  it('lo visto otro día NO entra al muestreo: queda oportunista en el punto', () => {
    // El transecto fue ayer; el avistamiento es de anteayer, cuando no hubo
    // nada. Meterlo en el transecto de ayer falsearía su esfuerzo.
    const d = resolveEntry({ ...base, sightingDate: '2026-09-02', events: [event(AYER)] });
    expect(d.mode).toBe('otro_dia');
    expect(d.method).toBe('registro_oportunista');
    expect(d.eventDate).toBe('2026-09-02');
    expect(d.notice).toContain('fuera de ese muestreo');
  });

  it('lo visto hoy de paso, con el transecto hecho ayer, no abre un transecto nuevo', () => {
    // Éste es el caso del enunciado: hoy paso por el camino cerca del punto y
    // veo algo. Abrir un "transecto de hoy" inventaría esfuerzo que no existió.
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [event(AYER)] });
    expect(d.mode).toBe('quizas_replica');
    expect(d.method).toBe('registro_oportunista');
    expect(d.eventDate).toBe(HOY);
    expect(d.notice).toContain('3 de septiembre');
  });

  it('pero deja convertirlo en réplica, porque volver al punto es normal', () => {
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [event(AYER)] });
    expect(d.alternative).toEqual({ label: 'Es un transecto nuevo de hoy', method: 'transecto' });
  });

  it('una metodología distinta en la misma estación no interfiere', () => {
    // Ayer hubo transecto; hoy toca el playback, que nunca se ha hecho aquí.
    const d = resolveEntry({
      ...base, method: 'playback_aves', sightingDate: HOY, events: [event(AYER, 'transecto')],
    });
    expect(d.mode).toBe('normal');
    expect(d.method).toBe('playback_aves');
  });

  it('el muestreo borrado no cuenta como muestreo previo', () => {
    const borrado = { ...event(AYER), deletedAt: '2026-09-04T00:00:00Z' };
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [borrado] });
    expect(d.mode).toBe('normal');
  });

  it('el muestreo de otra estación no interfiere', () => {
    const d = resolveEntry({ ...base, sightingDate: HOY, events: [event(AYER, 'transecto', 'st9')] });
    expect(d.mode).toBe('normal');
  });
});
