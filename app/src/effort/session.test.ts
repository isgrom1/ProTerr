import { describe, expect, it } from 'vitest';
import type { TrackPoint } from '../domain/types';
import {
  appendTrackPoint, formatDistance, inferPeriod, relativeAbundance,
  summarizeEffort, trackLengthMeters, trapNightsBetween,
} from './session';

const at = (min: number) => new Date(Date.UTC(2026, 8, 4, 10, min)).toISOString();
/** ~11,1 m por cada 0,0001° de latitud. */
const point = (min: number, latOffset: number, acc = 8): TrackPoint =>
  ({ t: at(min), lat: -31.2465 + latOffset, lon: -71.5312, acc });

describe('filtrado del recorrido GPS', () => {
  it('descarta puntos con mala precisión en vez de inflar la distancia', () => {
    const r = appendTrackPoint([point(0, 0)], point(1, 0.001, 120));
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('precision');
  });

  it('ignora la deriva del GPS cuando el usuario está detenido', () => {
    const r = appendTrackPoint([point(0, 0)], point(1, 0.00002)); // ~2 m
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('sin-movimiento');
  });

  it('rechaza saltos imposibles a pie', () => {
    // ~1,1 km en 1 minuto = 18 m/s
    const r = appendTrackPoint([point(0, 0)], point(1, 0.01));
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('salto-imposible');
  });

  it('acepta un desplazamiento normal', () => {
    const r = appendTrackPoint([point(0, 0)], point(1, 0.0009)); // ~100 m en 60 s
    expect(r.accepted).toBe(true);
    expect(r.track).toHaveLength(2);
  });

  it('suma la longitud del recorrido tramo a tramo', () => {
    const track = [point(0, 0), point(1, 0.0009), point(2, 0.0018)];
    expect(trackLengthMeters(track)).toBeGreaterThan(180);
    expect(trackLengthMeters(track)).toBeLessThan(220);
  });
});

describe('resumen de esfuerzo por metodología', () => {
  const now = new Date(Date.UTC(2026, 8, 4, 11, 0));

  it('un transecto se mide en distancia', () => {
    const e = summarizeEffort({
      method: 'transecto', startedAt: at(0), endedAt: at(42),
      track: [point(0, 0), point(1, 0.0009)], distanceMeters: null, trapCount: null, trapNights: null,
    }, now);
    expect(e.unit).toBe('distancia');
    expect(e.durationMinutes).toBe(42);
    expect(e.label).toContain('42 min');
    expect(e.incomplete).toBe(false);
  });

  it('un transecto sin recorrido queda marcado como incompleto', () => {
    const e = summarizeEffort({
      method: 'transecto', startedAt: at(0), endedAt: at(42),
      track: [], distanceMeters: null, trapCount: null, trapNights: null,
    }, now);
    expect(e.incomplete).toBe(true);
  });

  it('una cámara trampa se mide en trampas-noche', () => {
    const e = summarizeEffort({
      method: 'camara_trampa', startedAt: null, endedAt: null,
      track: [], distanceMeters: null, trapCount: 3, trapNights: 45,
    }, now);
    expect(e.unit).toBe('trampas-noche');
    expect(e.label).toBe('45 trampa-noches');
  });

  it('un punto de conteo se mide en duración', () => {
    const e = summarizeEffort({
      method: 'punto_conteo', startedAt: at(0), endedAt: at(10),
      track: [], distanceMeters: null, trapCount: null, trapNights: null,
    }, now);
    expect(e.unit).toBe('duración');
    expect(e.label).toBe('10 min');
  });

  it('un muestreo abierto cuenta el tiempo hasta ahora', () => {
    const e = summarizeEffort({
      method: 'punto_conteo', startedAt: at(0), endedAt: null,
      track: [], distanceMeters: null, trapCount: null, trapNights: null,
    }, now);
    expect(e.durationMinutes).toBe(60);
  });

  it('calcula trampas-noche entre instalación y retiro', () => {
    expect(trapNightsBetween(15, '2026-08-26', '2026-08-29')).toBe(45);
  });
});

describe('abundancia relativa', () => {
  it('convierte individuos y esfuerzo en la cifra comparable entre campañas', () => {
    const transecto = summarizeEffort({
      method: 'transecto', startedAt: at(0), endedAt: at(60),
      track: [], distanceMeters: 2000, trapCount: null, trapNights: null,
    });
    expect(relativeAbundance(8, transecto)).toEqual({ value: 4, unit: 'ind/km' });

    const camara = summarizeEffort({
      method: 'camara_trampa', startedAt: null, endedAt: null,
      track: [], distanceMeters: null, trapCount: 3, trapNights: 45,
    });
    expect(relativeAbundance(9, camara)).toEqual({ value: 20, unit: 'ind/100 trampas-noche' });
  });

  it('sin esfuerzo no inventa una cifra', () => {
    const sinEsfuerzo = summarizeEffort({
      method: 'transecto', startedAt: null, endedAt: null,
      track: [], distanceMeters: null, trapCount: null, trapNights: null,
    });
    expect(relativeAbundance(8, sinEsfuerzo)).toBeNull();
  });
});

describe('utilidades', () => {
  it('formatea distancias en la unidad legible', () => {
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(2340)).toBe('2,34 km');
  });

  it('deduce el periodo del día', () => {
    expect(inferPeriod('12:00')).toBe('Diurno');
    expect(inferPeriod('20:30')).toBe('Crepuscular');
    expect(inferPeriod('23:15')).toBe('Nocturno');
    expect(inferPeriod('03:00')).toBe('Nocturno');
  });
});
