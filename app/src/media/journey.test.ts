/**
 * Fotos sintéticas que reproducen una jornada real de dos estaciones, con el
 * error de etiqueta que ocurre en terreno (ver tools/generar_fixtures_jornada.py).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Station } from '../domain/types';
import { analyzeJourney, cardinalOf, checkLabel, summarize, type JourneyInput } from './journey';
import { readExif } from './exif';

const dir = fileURLToPath(new URL('./__fixtures__/jornada/', import.meta.url));
const files: JourneyInput[] = readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((fileName) => {
  const b = readFileSync(dir + fileName);
  return { fileName, buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
});

const station = (id: string, code: string, latitude: number, longitude: number): Station => ({
  id, projectId: 'p', stationCode: code, finalStationCode: code,
  darwinCoreLocationId: `urn:x:${code}`, latitude, longitude,
  methods: ['transecto'], sites: [],
} as Station);

const EMF01 = station('s1', 'EMF01', -32.96, -71.35);
const EMF02 = station('s2', 'EMF02', -32.963627, -71.35);
const stations = [EMF01, EMF02];

describe('etiqueta de la cámara contra el GPS de la foto', () => {
  it('detecta la etiqueta que quedó del punto anterior', () => {
    // El caso real: se saca la primera foto de EMF02 y la cámara aún dice EMF01.
    const b = readFileSync(dir + 'emf02-orient-0.jpg');
    const meta = readExif(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const fix = { latitude: meta.latitude!, longitude: meta.longitude!, fixedAt: '' };
    const check = checkLabel(meta, fix, stations);

    expect(check.status).toBe('desfasada');
    if (check.status !== 'desfasada') return;
    expect(check.label).toBe('EMF01');
    expect(check.labelDistanceMeters).toBeGreaterThan(300);
    expect(check.nearest.stationCode).toBe('EMF02');
    expect(check.nearestDistanceMeters).toBeLessThan(50);
  });

  it('da por buena la etiqueta cuando calza con el GPS', () => {
    const b = readFileSync(dir + 'emf01-especie.jpg');
    const meta = readExif(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    const check = checkLabel(meta, { latitude: meta.latitude!, longitude: meta.longitude!, fixedAt: '' }, stations);
    expect(check.status).toBe('coincide');
  });

  it('sin GPS no acusa a nadie: no se puede verificar', () => {
    const check = checkLabel(
      { description: 'EMF01' } as never, null, stations);
    expect(check.status).toBe('sin-verificar');
  });

  it('una etiqueta que no es de este proyecto se marca aparte', () => {
    const check = checkLabel(
      { description: 'ZZZ99' } as never,
      { latitude: -32.96, longitude: -71.35, fixedAt: '' }, stations);
    expect(check.status).toBe('desconocida');
  });
});

describe('rumbo a punto cardinal', () => {
  it('convierte el rumbo de la cámara', () => {
    expect(cardinalOf(0)).toBe('N');
    expect(cardinalOf(90)).toBe('E');
    expect(cardinalOf(197)).toBe('S');
    expect(cardinalOf(272)).toBe('O');
    expect(cardinalOf(359)).toBe('N');
    expect(cardinalOf(null)).toBeNull();
  });
});

describe('una jornada completa desde las fotos', () => {
  const groups = analyzeJourney(files, stations);

  it('agrupa por día y por estación', () => {
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g.date, g.station?.stationCode, g.photos.length])).toEqual([
      ['2026-09-04', 'EMF01', 5],
      ['2026-09-04', 'EMF02', 5],
    ]);
  });

  it('asigna la estación por el GPS, no por la etiqueta', () => {
    // Las cuatro fotos mal etiquetadas de EMF02 quedan igualmente en EMF02.
    const emf02 = groups.find((g) => g.station?.stationCode === 'EMF02')!;
    expect(emf02.photos.filter((p) => p.labelCheck.status === 'desfasada')).toHaveLength(4);
    expect(emf02.photos.every((p) => p.station?.stationCode === 'EMF02')).toBe(true);
  });

  it('separa las cuatro tomas de orientación de las de especies', () => {
    for (const g of groups) {
      const orientacion = g.photos.filter((p) => p.role === 'orientacion');
      expect(orientacion).toHaveLength(4);
      expect(orientacion.map((p) => p.cardinal)).toEqual(['N', 'E', 'S', 'O']);
      expect(g.photos.filter((p) => p.role === 'especie')).toHaveLength(1);
    }
  });

  it('ordena las fotos de cada estación por hora', () => {
    const emf01 = groups[0].photos.map((p) => p.takenAt);
    expect([...emf01].sort()).toEqual(emf01);
  });

  it('resume lo que hay que revisar antes de importar', () => {
    const s = summarize(groups);
    expect(s).toEqual({ days: 1, stations: 2, photos: 10, withoutGps: 0, unassigned: 0, mislabelled: 4 });
  });
});
