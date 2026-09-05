/**
 * El nombre del archivo es dato: una carpeta ordenada alfabéticamente tiene que
 * quedar ordenada por punto y por hora, y tiene que sobrevivir a Windows.
 */
import { describe, expect, it } from 'vitest';
import type { MediaObject } from '../domain/types';
import type { FlatRecord } from './shape';
import { fotosDe, nombreDeFoto } from './fotos';

function registro(patch: Record<string, unknown> = {}): FlatRecord {
  return {
    occurrence: { occurrenceTime: '10:34', mediaIds: ['m1'], verbatimTaxonText: null },
    event: { eventDate: '2026-09-04', eventTime: '10:00' },
    station: { stationCode: 'EMF44', finalStationCode: 'EMF44' },
    taxon: { commonName: 'Chucao' },
    site: null, project: null, campaign: null, facts: [],
    ...patch,
  } as unknown as FlatRecord;
}

const foto = (id: string) => ({ id, kind: 'foto', blob: new Blob(['x']) } as unknown as MediaObject);

describe('nombre del archivo de foto', () => {
  it('junta punto, fecha, hora, especie y número', () => {
    expect(nombreDeFoto({ record: registro(), media: foto('m1'), indice: 1 }))
      .toBe('EMF44_2026-09-04_1034_Chucao_1.jpg');
  });

  it('saca tildes y espacios: el archivo termina en un Windows ajeno', () => {
    const r = registro({ taxon: { commonName: 'Cóndor andino' } });
    expect(nombreDeFoto({ record: r, media: foto('m1'), indice: 2 }))
      .toBe('EMF44_2026-09-04_1034_Condor-andino_2.jpg');
  });

  it('usa el código final del punto cuando existe', () => {
    const r = registro({ station: { stationCode: 'EMF44', finalStationCode: 'PMF12' } });
    expect(nombreDeFoto({ record: r, media: foto('m1'), indice: 1 })).toContain('PMF12_');
  });

  it('no se cae si falta el punto o la especie', () => {
    const r = registro({ station: null, taxon: null });
    expect(nombreDeFoto({ record: r, media: foto('m1'), indice: 1 }))
      .toBe('sin-punto_2026-09-04_1034_sin-especie_1.jpg');
  });
});

describe('reunir las fotos de los registros', () => {
  it('numera desde 1 dentro de cada registro', () => {
    const r = registro({ occurrence: { occurrenceTime: '10:34', mediaIds: ['m1', 'm2'], verbatimTaxonText: null } });
    const fotos = fotosDe([r], new Map([['m1', foto('m1')], ['m2', foto('m2')]]));
    expect(fotos.map((f) => f.indice)).toEqual([1, 2]);
  });

  it('ignora el audio y los identificadores sin archivo', () => {
    const r = registro({ occurrence: { occurrenceTime: '10:34', mediaIds: ['m1', 'a1', 'perdida'], verbatimTaxonText: null } });
    const media = new Map<string, MediaObject>([
      ['m1', foto('m1')],
      ['a1', { id: 'a1', kind: 'audio', blob: new Blob(['x']) } as unknown as MediaObject],
    ]);
    expect(fotosDe([r], media)).toHaveLength(1);
  });
});
