/**
 * Cargar la lista de especies de la consultora.
 *
 * Reportado desde Atacama: dictó "platero" y no existía en el catálogo de
 * arranque. Parchar especie por especie no escala; la lista la trae la
 * consultora, que además es la que su planilla espera.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { Taxon } from '../domain/types';
import { construirCatalogo, detectarCatalogo } from './catalogo';

/** Una planilla con varias hojas, como las de verdad. */
function libro(filas: string[][], otras: Record<string, string[][]> = {}): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [nombre, datos] of Object.entries(otras)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(datos), nombre);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'nombres BD');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const ENCABEZADO = ['Nombre común (1)', 'Nombre científico (2)', 'Reino (3)', 'Tipo (4)', 'Clase (5)', 'Orden (6)', 'Familia (7)'];
const PLATERO = ['Platero', 'Rhopospina alaudina', 'Animalia', 'Chordata', 'Aves', 'Passeriformes', 'Thraupidae'];
const CHUCAO = ['Chucao', 'Scelorchilus rubecula', 'Animalia', 'Chordata', 'Aves', 'Passeriformes', 'Rhinocryptidae'];

describe('encontrar la hoja del catálogo', () => {
  it('elige la hoja con nombres aunque haya otras', () => {
    const ab = libro([ENCABEZADO, PLATERO, CHUCAO], {
      'LEER ANTES': [['Guía de uso'], ['Primero haga esto']],
    });
    const det = detectarCatalogo(ab)!;
    expect(det.hoja).toBe('nombres BD');
    expect(det.filas).toBe(2);
  });

  it('"Tipo" en una lista de especies es el filo, no el tipo de registro', () => {
    const det = detectarCatalogo(libro([ENCABEZADO, PLATERO]))!;
    expect(det.columnas.find((c) => c.header === 'Tipo (4)')?.campo).toBe('phylum');
  });

  it('un archivo sin nombres de especie no es un catálogo', () => {
    expect(detectarCatalogo(libro([['Fecha', 'Hora', 'Observación'], ['2026-09-04', '10:34', 'nada']]))).toBeNull();
  });
});

describe('construir las especies', () => {
  const ab = libro([ENCABEZADO, PLATERO, CHUCAO]);

  it('deja la especie buscable por nombre común y científico', () => {
    const { taxones } = construirCatalogo(ab, detectarCatalogo(ab)!);
    const platero = taxones.find((t) => t.commonName === 'Platero')!;
    expect(platero.scientificName).toBe('Rhopospina alaudina');
    expect(platero.class).toBe('Aves');
    expect(platero.group).toBe('aves');
    expect(platero.genus).toBe('Rhopospina');
    expect(platero.specificEpithet).toBe('alaudina');
    // "r alaudina" para quien dicta el científico abreviado.
    expect(platero.searchKeys).toContain('platero');
    expect(platero.searchKeys).toContain('r alaudina');
  });

  it('una especie que ya existía conserva su identificador', () => {
    // Si cambiara, los registros que la referencian quedarían huérfanos.
    const previo = [{
      id: 'tx_ya_existia', commonName: 'Chucao', scientificName: 'Scelorchilus rubecula',
      otherCommonNames: ['chucao del sur'], conservation: null,
    } as unknown as Taxon];
    const { taxones } = construirCatalogo(ab, detectarCatalogo(ab)!, previo);
    const chucao = taxones.find((t) => t.commonName === 'Chucao')!;
    expect(chucao.id).toBe('tx_ya_existia');
    expect(chucao.otherCommonNames).toEqual(['chucao del sur']);
  });

  it('el guión de la planilla es un vacío, no un dato', () => {
    const ab2 = libro([ENCABEZADO, ['A Ratón sp', '-', 'Animalia', 'Chordata', 'Mamíferos', 'Rodentia', '-']]);
    const { taxones } = construirCatalogo(ab2, detectarCatalogo(ab2)!);
    expect(taxones[0].scientificName).toBeNull();
    expect(taxones[0].family).toBeNull();
    expect(taxones[0].class).toBe('Mammalia');
    expect(taxones[0].isPlaceholder).toBe(true);
  });

  it('un nombre común en dos especies se marca para preguntar, no se elige', () => {
    const ab2 = libro([ENCABEZADO,
      ['Golondrina', 'Tachycineta meyeni', 'Animalia', 'Chordata', 'Aves', 'Passeriformes', 'Hirundinidae'],
      ['Golondrina', 'Pygochelidon cyanoleuca', 'Animalia', 'Chordata', 'Aves', 'Passeriformes', 'Hirundinidae'],
    ]);
    const { taxones } = construirCatalogo(ab2, detectarCatalogo(ab2)!);
    expect(taxones).toHaveLength(2);
    expect(taxones.every((t) => t.ambiguousCommonName)).toBe(true);
  });

  it('cargar dos veces la misma lista no duplica nada', () => {
    const primera = construirCatalogo(ab, detectarCatalogo(ab)!).taxones;
    const segunda = construirCatalogo(ab, detectarCatalogo(ab)!, primera).taxones;
    expect(segunda).toHaveLength(primera.length);
    expect(segunda.map((t) => t.id).sort()).toEqual(primera.map((t) => t.id).sort());
  });
});
