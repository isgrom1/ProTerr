/**
 * Fixture sintético con el EXIF que escriben las apps de cámara con marca de
 * agua usadas en terreno (ver tools/generar_fixture_exif.py). No se guarda
 * ninguna fotografía real de campo: llevaría la coordenada exacta de un
 * proyecto, y eso no corresponde tenerlo en el repositorio.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toUtm } from '../geo/utm';
import { readExif } from './exif';

const file = readFileSync(new URL('./__fixtures__/foto-demo.jpg', import.meta.url));
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const meta = readExif(buffer);

describe('lectura del EXIF de una foto de terreno', () => {
  it('extrae la coordenada con el signo correcto del hemisferio', () => {
    // 32°57'36" S · 71°21'00" W. Sin aplicar S y W, una foto de Chile
    // aparecería en Mongolia.
    expect(meta.latitude).toBeCloseTo(-32.96, 5);
    expect(meta.longitude).toBeCloseTo(-71.35, 5);
  });

  it('la coordenada se convierte al UTM que necesita la planilla', () => {
    const utm = toUtm(meta.latitude!, meta.longitude!, 19);
    expect(utm.zone).toBe(19);
    expect(utm.hemisphere).toBe('S');
    expect(utm.east).toBeGreaterThan(200000);
    expect(utm.north).toBeGreaterThan(6000000);
  });

  it('recupera la estación que el usuario escribió en la cámara', () => {
    expect(meta.description).toBe('EMF01');
  });

  it('trae altitud, precisión y rumbo', () => {
    expect(meta.altitudeMeters).toBeCloseTo(238.5, 0);
    expect(meta.accuracyMeters).toBeCloseTo(12, 0);
    expect(meta.headingDegrees).toBeCloseTo(197.2, 0);
  });

  it('lee la fecha real de la toma', () => {
    expect(meta.takenAt).toBe('2026-09-04T08:31:00');
  });

  it('detecta que la foto está rotada 180°', () => {
    // Por eso el sello se ve al revés si nadie aplica la orientación.
    expect(meta.orientation).toBe(3);
  });

  it('conserva de dónde vino la foto', () => {
    expect(meta.make).toBe('Demo');
    expect(meta.software).toContain('Timestamp');
    expect([meta.width, meta.height]).toEqual([4032, 3024]);
  });
});

describe('robustez', () => {
  it('un archivo que no es JPEG no rompe nada', () => {
    const meta = readExif(new TextEncoder().encode('esto no es una foto').buffer as ArrayBuffer);
    expect(meta.latitude).toBeNull();
    expect(meta.orientation).toBe(1);
  });

  it('un JPEG sin EXIF devuelve valores vacíos, no basura', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
    const meta = readExif(bytes.buffer);
    expect(meta.description).toBeNull();
    expect(meta.takenAt).toBeNull();
  });
});

describe('lo que la foto puede aportar al registro', () => {
  it('propone la estación sólo si existe en el catálogo', async () => {
    const { suggestionFrom } = await import('./photo');
    const prepared = { metadata: meta, fix: null, blob: new Blob(), originalBytes: 0, bytes: 0 };

    expect(suggestionFrom(prepared, ['EMF01', 'EMF02']).stationCode).toBe('EMF01');
    // Una descripción que no calza con ninguna estación no se inventa.
    expect(suggestionFrom(prepared, ['TR-1']).stationCode).toBeNull();
    expect(suggestionFrom(prepared, []).stationCode).toBeNull();
  });

  it('propone la fecha y hora reales de la toma', async () => {
    const { suggestionFrom } = await import('./photo');
    const s = suggestionFrom({ metadata: meta, fix: null, blob: new Blob(), originalBytes: 0, bytes: 0 }, []);
    expect(s.date).toBe('2026-09-04');
    expect(s.time).toBe('08:31');
    expect(s.headingDegrees).toBeCloseTo(197.2, 0);
  });
});
