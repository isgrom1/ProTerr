/**
 * El importador se prueba contra una planilla ficticia con la forma que suelen
 * tener las de las consultoras: cabecera decorativa arriba, encabezado real más
 * abajo, hojas de instrucciones y listas, y los "sin dato" heterogéneos.
 *
 * No se usa ninguna planilla real de terceros: la de este test se construye
 * aquí mismo, así que la prueba es reproducible y el repositorio no arrastra
 * el formulario de nadie.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import taxaSeed from '../data/seed/taxa.json';
import vocabularies from '../data/seed/vocabularies.json';
import type { Taxon } from '../domain/types';
import { analyzeWorkbook } from './planilla';

/** Construye una planilla de prueba con el desorden típico del formato real. */
function buildFixture(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Guía de uso'], ['Completar sólo las columnas blancas.'],
  ]), 'LEER ANTES DE USAR');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Metodología', 'Tipo de registro', 'Dirección de vuelo'],
    ['Transecto', 'Individuo', 'N'],
    ['Cámara trampa', 'Vocalización', 'S'],
  ]), 'validación datos');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CONSULTORA FICTICIA'], ['FORMULARIO DE FAUNA'], [],
    ['Cliente:', 'Minera Ficticia', '', 'Código Proyecto:', 'FIC-01'],
    [],
    // Fila 6: el encabezado real, con nombres de otra consultora.
    ['N°', 'Proyecto', 'Región', 'Fecha', 'ID Estación', 'Hora',
     'Metodología usada para registro', 'Tipo de registro', 'Nombre común',
     'Abundancia', 'Sexo', 'Estado desarrollo', 'Comportamiento', 'Observaciones',
     'Muestreado por'],
    [1, 'Proyecto Ficticio', 'Valparaíso', '2026-09-04', 'EMF01', '08:31',
     'Transecto', 'Vocalización', 'Chucao', 1, 'Indeterminado', 'Adulto', 'Vocalizando', '-', 'A. Pérez'],
    [2, 'Proyecto Ficticio', 'Valparaíso', '2026-09-04', 'EMF01', '08:44',
     'Transecto', 'Individuo', 'rayadito', 3, 0, '-', 'Posado', '', 'A. Pérez'],
    // Especie inexistente: debe reportarse, no importarse mal.
    [3, 'Proyecto Ficticio', 'Valparaíso', '2026-09-04', 'EMF02', '09:02',
     'Transecto', 'Individuo', 'Bicho inventado', 1, '-', '-', '-', '', 'A. Pérez'],
    // Fila preformateada vacía: se ignora en silencio.
    [4, '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]), 'Registros');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['N°', 'Proyecto', 'Región', 'Temporada', 'Ambiente', 'Ladera de Exposición',
     'ID Estación', 'UTM E Estación (X)', 'UTM S Estación (Y)'],
    [1, 'Proyecto Ficticio', 'Valparaíso', 'Primavera', 'Matorral', 'Norte', 'EMF01', 270000, 6350000],
    [2, 'Proyecto Ficticio', 'Valparaíso', 'Primavera', 0, 'Sur', 'EMF02', 270400, 6350200],
  ]), 'Estaciones');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

const preview = analyzeWorkbook(buildFixture(), {
  taxa: taxaSeed as unknown as Taxon[],
  recordTypes: (vocabularies as { recordType: string[] }).recordType,
});

describe('importación de la planilla de una consultora', () => {
  it('reconoce el rol de cada hoja por sus campos, no por su nombre', () => {
    const roles = Object.fromEntries(preview.sheets.map((s) => [s.name, s.role]));
    expect(roles['Registros']).toBe('registros');
    expect(roles['Estaciones']).toBe('estaciones');
    expect(roles['LEER ANTES DE USAR']).toBe('desconocida');
  });

  it('encuentra el encabezado real bajo la cabecera decorativa', () => {
    expect(preview.sheets.find((s) => s.name === 'Registros')?.headerRow).toBe(6);
    expect(preview.sheets.find((s) => s.name === 'Estaciones')?.headerRow).toBe(1);
  });

  it('lee los registros con datos e ignora las filas preformateadas', () => {
    expect(preview.records).toHaveLength(3);
    expect(preview.records.every((r) => r.commonName)).toBe(true);
  });

  it('resuelve la especie aunque venga en minúsculas', () => {
    const rayadito = preview.records.find((r) => r.commonName === 'rayadito')!;
    expect(rayadito.taxonId).not.toBeNull();
    expect(rayadito.individualCount).toBe(3);
  });

  it('normaliza fechas y horas', () => {
    const first = preview.records[0];
    expect(first.eventDate).toBe('2026-09-04');
    expect(first.eventTime).toBe('08:31');
  });

  it('reporta como error la especie que no existe, en vez de inventarla', () => {
    const errors = preview.issues.filter((i) => i.severity === 'error');
    const names = new Set(errors.map((e) => e.message.match(/"(.+?)"/)?.[1]));
    expect(names).toEqual(new Set(['Bicho inventado']));
    expect(preview.canImport).toBe(false); // hay un error: no se importa nada todavía
  });

  it('lee las estaciones con sus coordenadas', () => {
    expect(preview.stations).toHaveLength(2);
    expect(preview.stations[0].stationCode).toBe('EMF01');
    expect(preview.stations[0].utmEast).toBe(270000);
  });

  it('no confunde 0 ni "-" con un dato real', () => {
    expect(preview.records.some((r) => r.sex === '0')).toBe(false);
    expect(preview.records.some((r) => r.notes === '-')).toBe(false);
    expect(preview.stations.some((s) => s.habitat === '0')).toBe(false);
  });
});
