/**
 * Qué dice el rótulo. Lo que importa probar es que salga del registro —para que
 * no pueda quedarse atrasado como la pizarra— y que no invente líneas vacías.
 */
import { describe, expect, it } from 'vitest';
import type { FlatRecord } from '../export/shape';
import {
  CAMPO_LATLON, CAMPO_UTM, CAMPOS_ROTULO_POR_DEFECTO, construirRotulo, etiquetaDeCampo,
} from './rotulo';

function registro(patch: Partial<{
  stationCode: string; fecha: string; hora: string; proyecto: string;
  utmEast: number | null; utmNorth: number | null; lat: number | null; lon: number | null;
  observador: string | null;
}> = {}): FlatRecord {
  const p = {
    stationCode: 'EMF44', fecha: '2026-09-04', hora: '10:34', proyecto: 'Línea base Quilapilún',
    utmEast: 340512, utmNorth: 6312044, lat: -33.2465, lon: -70.7312, observador: 'Isaac Rojas',
    ...patch,
  };
  return {
    occurrence: { occurrenceTime: p.hora, occurrenceFix: null, mediaIds: [] },
    event: { eventDate: p.fecha, recordedBy: p.observador, method: 'transecto' },
    station: {
      stationCode: p.stationCode, finalStationCode: p.stationCode,
      utmEast: p.utmEast, utmNorth: p.utmNorth, latitude: p.lat, longitude: p.lon,
    },
    site: null,
    project: { name: p.proyecto, utmZone: 19, geodeticDatum: 'WGS84' },
    campaign: null, taxon: null, facts: [],
  } as unknown as FlatRecord;
}

describe('el rótulo sale del registro, no de una pizarra', () => {
  it('arma las cinco líneas de una pizarra de terreno', () => {
    const lineas = construirRotulo(registro());
    expect(lineas.map((l) => `${l.etiqueta}: ${l.valor}`)).toEqual([
      'Punto: EMF44',
      'Fecha: 2026-09-04',
      'Hora: 10:34',
      'UTM: 19S 340512 E / 6312044 N',
      'Proyecto: Línea base Quilapilún',
    ]);
  });

  it('el punto es el del registro: cambiarlo cambia el rótulo', () => {
    // Éste es el problema de J.16 resuelto de raíz: se camina de EMF44 a EMF45,
    // se elige el punto nuevo y el rótulo ya dice EMF45. No hay nada que borrar.
    const lineas = construirRotulo(registro({ stationCode: 'EMF45' }));
    expect(lineas[0].valor).toBe('EMF45');
  });

  it('omite las líneas sin valor en vez de escribir un guión', () => {
    const lineas = construirRotulo(registro({ utmEast: null, utmNorth: null }));
    expect(lineas.map((l) => l.etiqueta)).not.toContain('UTM');
    expect(lineas).toHaveLength(4);
  });

  it('sin ninguna coordenada no pone la línea', () => {
    const lineas = construirRotulo(
      registro({ utmEast: null, utmNorth: null, lat: null, lon: null }),
      [CAMPO_UTM, CAMPO_LATLON],
    );
    expect(lineas).toHaveLength(0);
  });

  it('deja elegir cualquier campo del catálogo de exportación', () => {
    const lineas = construirRotulo(registro(), ['event.recordedBy', 'event.method']);
    expect(lineas).toEqual([
      { etiqueta: 'Observador', valor: 'Isaac Rojas' },
      { etiqueta: 'Metodología', valor: 'Transecto' },
    ]);
  });

  it('da latitud y longitud en una sola línea cuando se pide', () => {
    const [linea] = construirRotulo(registro(), [CAMPO_LATLON]);
    expect(linea.valor).toBe('-33.24650, -70.73120');
  });

  it('nombra los campos para poder ofrecerlos en Ajustes', () => {
    expect(etiquetaDeCampo(CAMPO_UTM)).toBe('Coordenadas UTM (una línea)');
    expect(etiquetaDeCampo('station.habitat')).toBe('Ambiente');
    expect(CAMPOS_ROTULO_POR_DEFECTO).toHaveLength(5);
  });
});
