/**
 * El lector de la Nómina del MMA. El archivo de prueba imita la FORMA del
 * oficial —los mismos encabezados y las mismas rarezas— con especies
 * inventadas: no se incorpora la lista real al repositorio.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { leerNomina, resumirNomina } from './nomina';

const ENCABEZADO = [
  'NOMBRE CIENTÍFICO', 'NOMBRE COMÚN', 'SINONIMIA incompleta', 'Arbusto',
  'REINO', 'PHYLLUM /\nDIVISIÓN', 'CLASE', 'ORDEN', 'FAMILIA',
  'ENDÉMICA\nrespecto de Chile', 'DISTRIBUCIÓN REGIONES:',
  'CATEGORÍA VIGENTE:\nCR = En peligro crítico',
  'FUENTE DE CATEGORÍA VIGENTE:',
  'NÚMERO PROCESO RCE  \nse clasificó categoría Vigente',
  'REFERENCIA o DECRETO\nCategoría Vigente',
];

function fila(nombre: string, cat: string, proc: number | '', extra: Partial<{
  comun: string; clase: string; endemica: string; decreto: string;
}> = {}) {
  return [
    nombre, extra.comun ?? '', '', '', 'Animalia', 'Chordata', extra.clase ?? 'Mammalia',
    'Carnivora', 'Canidae', extra.endemica ?? 'NO', 'III-VIII',
    cat, 'RCE', proc, extra.decreto ?? 'DS 1/2020 MMA',
  ];
}

function libro(filas: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ACTUALIZADO']]), 'Ayuda');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([ENCABEZADO, ...filas]), 'Especies');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

describe('Nómina del MMA', () => {
  it('lee la hoja de especies, no la de ayuda', () => {
    const n = leerNomina(libro([fila('Genus unus', 'EN', 12)]), 'nomina.xlsx');
    expect(n.especies).toHaveLength(1);
    expect(n.especies[0].scientificName).toBe('Genus unus');
    expect(n.especies[0].codigo).toBe('EN');
    expect(n.especies[0].decreto).toBe('DS 1/2020 MMA');
  });

  it('con la especie repetida se queda con el proceso más reciente', () => {
    // Es el caso real de Aegla papudo y Sophora masafuerana: la nómina las
    // lista dos veces y quedarse con la primera fila deja la categoría vieja.
    const n = leerNomina(libro([
      fila('Genus bis', 'EN', 10),
      fila('Genus bis', 'CR', 18),
    ]), 'nomina.xlsx');
    expect(n.especies).toHaveLength(1);
    expect(n.especies[0].categoria).toBe('CR');
    expect(n.especies[0].proceso).toBe(18);
    expect(n.duplicadosResueltos[0]).toEqual({
      scientificName: 'Genus bis',
      descartado: 'EN (proceso 10)',
      vigente: 'CR (proceso 18)',
    });
  });

  it('da igual el orden en que vengan las dos filas', () => {
    const n = leerNomina(libro([
      fila('Genus bis', 'CR', 18),
      fila('Genus bis', 'EN', 10),
    ]), 'nomina.xlsx');
    expect(n.especies[0].categoria).toBe('CR');
  });

  it('guarda tal cual la categoría regional, sin reducirla a un código', () => {
    // "La categoría depende de dónde está el animal" es el dato. Elegir una
    // de las dos sería inventar.
    const compuesta = 'EN (JF); LC (Chile continental)';
    const n = leerNomina(libro([fila('Genus regional', compuesta, 7)]), 'nomina.xlsx');
    expect(n.especies[0].categoria).toBe(compuesta);
    expect(n.especies[0].codigo).toBeNull();
    expect(n.especies[0].compuesta).toBe(true);
  });

  it('marca las entradas que la nómina declara nombre no válido', () => {
    const n = leerNomina(libro([
      fila('Genus obsoletum', 'Nombre científico NO válido; sinonimia de Genus unus', ''),
    ]), 'nomina.xlsx');
    expect(n.especies[0].sinonimia).toBe(true);
  });

  it('encuentra las columnas aunque cambien de posición', () => {
    // El MMA reordena el archivo entre versiones; por eso se busca por
    // encabezado y no por número de columna.
    const alReves = [['CATEGORÍA VIGENTE:', 'NOMBRE CIENTÍFICO'], ['VU', 'Genus movido']];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(alReves), 'Especies');
    const n = leerNomina(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer, 'x.xlsx');
    expect(n.especies[0]).toMatchObject({ scientificName: 'Genus movido', codigo: 'VU' });
  });

  it('rechaza un archivo que no es la nómina', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fecha', 'Especie'], ['hoy', 'x']]), 'Hoja1');
    expect(() => leerNomina(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer, 'otro.xlsx'))
      .toThrow('no parece la Nómina del MMA');
  });

  it('resume lo que trae para poder revisarlo al cargar', () => {
    const n = leerNomina(libro([
      fila('Genus unus', 'EN', 1), fila('Genus duo', 'LC', 2),
      fila('Genus tres', 'CR (norte); LC (sur)', 3),
      fila('Genus quattuor', 'Nombre científico NO válido; sinonimia de Genus unus', ''),
    ]), 'nomina.xlsx');
    // "amenazadas" cuenta sólo las de código simple: una categoría regional
    // como "CR (norte); LC (sur)" no se puede contar como amenazada a secas,
    // porque depende de dónde esté el animal. Sale aparte, en "compuestas".
    expect(resumirNomina(n)).toEqual({
      total: 4, conCategoria: 4, compuestas: 1, sinonimias: 1, amenazadas: 1,
    });
  });
});
