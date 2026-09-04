/**
 * El detector se prueba contra planillas ficticias construidas aquí: ProTerr
 * no incorpora el formulario de ninguna consultora.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildWorkbook } from '../export/workbook';
import { detectTemplate, toTemplate } from './template';

function workbook(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

const consultoraA = workbook({
  'Instrucciones': [['Cómo llenar este formulario'], ['Completar sólo lo blanco.']],
  'Listas': [['Metodología', 'Tipo de registro'], ['Transecto', 'Individuo']],
  'FORMULARIO FAUNA': [
    ['CONSULTORA A'], ['Cliente:', ''], [],
    ['Fecha', 'Hora', 'ID Estación', 'Nombre común', 'Nombre científico',
     'Abundancia', 'Sexo', 'Comportamiento', 'Código interno 47'],
  ],
  'Vuelo': [
    ['Fecha', 'Nombre común', 'Origen', 'Destino', 'Altura vuelo (LAT o metros)', 'Abundancia'],
  ],
});

describe('detección de la plantilla de una consultora', () => {
  const found = detectTemplate(consultoraA, 'formulario-consultora-a.xlsx');

  it('descarta las hojas que no son formularios de registro', () => {
    const ignored = found.sheets.filter((s) => s.ignored).map((s) => s.name);
    expect(ignored).toContain('Instrucciones');
    expect(ignored).toContain('Listas');
  });

  it('encuentra el encabezado bajo la cabecera y conserva el preámbulo', () => {
    const sheet = found.sheets.find((s) => s.name === 'FORMULARIO FAUNA')!;
    expect(sheet.headerRow).toBe(4);
    expect(sheet.preamble[0][0]).toBe('CONSULTORA A');
  });

  it('empareja las columnas conocidas y deja sin asignar la que no reconoce', () => {
    const sheet = found.sheets.find((s) => s.name === 'FORMULARIO FAUNA')!;
    const byHeader = Object.fromEntries(sheet.columns.map((c) => [c.header, c.fieldId]));
    expect(byHeader['Nombre común']).toBe('occurrence.commonName');
    expect(byHeader['Abundancia']).toBe('occurrence.count');
    expect(byHeader['ID Estación']).toBe('station.code');
    expect(byHeader['Código interno 47']).toBeNull(); // no inventa un mapeo
  });

  it('reconoce la hoja de tránsito aéreo por sus campos de vuelo', () => {
    expect(found.sheets.find((s) => s.name === 'Vuelo')?.scope).toBe('transito_aereo');
  });

  it('cuenta lo que quedó sin emparejar para que una persona lo revise', () => {
    expect(found.unmapped).toBe(1);
    expect(found.totalColumns).toBe(15);
  });
});

describe('la plantilla resultante reproduce el formato de origen', () => {
  it('exporta exactamente los encabezados de la consultora', () => {
    const template = toTemplate(detectTemplate(consultoraA, 'a.xlsx'), {
      id: 'a', name: 'Consultora A', organization: 'Consultora A',
    });
    const wb = buildWorkbook([], template, {});
    expect(wb.SheetNames).toEqual(['FORMULARIO FAUNA', 'Vuelo']);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['FORMULARIO FAUNA'], { header: 1, blankrows: true });
    expect(rows[0]).toEqual(['CONSULTORA A']);
    expect(rows[3]).toEqual([
      'Fecha', 'Hora', 'ID Estación', 'Nombre común', 'Nombre científico',
      'Abundancia', 'Sexo', 'Comportamiento', 'Código interno 47',
    ]);
  });

  it('una segunda consultora con otros nombres también se reconoce', () => {
    const consultoraB = workbook({
      'Datos': [['DÍA', 'PUNTO', 'ESPECIE', 'N° de individuos', 'OBSERVADOR']],
    });
    const found = detectTemplate(consultoraB, 'b.xlsx');
    const columns = found.sheets[0].columns.map((c) => c.fieldId);
    expect(columns).toEqual([
      'event.day', 'station.code', 'occurrence.commonName',
      'occurrence.count', 'event.recordedBy',
    ]);
  });
});

/**
 * Formulario con las mañas que traen las planillas reales de terreno: la
 * instrucción metida en el propio encabezado, un correlativo llamado "Orden"
 * y columnas con nombres cortos y ambiguos.
 */
const consultoraC = workbook({
  'LDB': [
    ['Orden (No cambiar numeración)', 'Responsable', 'Equipo', 'Fecha', 'Hora',
     'ID. Estación de Muestreo (No modificar)', 'ID_TECNICA (no modifcar)',
     'TIPO (no modificar)', 'Método (no modificar)', 'UTM -E (no modificar)',
     'UTM-N (no modificar)', 'Sector', 'Clase', 'Abundancia',
     'Condición reproductiva', 'Etapa de vida', 'Estado del organismo'],
    [1, 'A. Pérez', 'Equipo 3', '2026-06-02', '10:00', 'EM11', 'CT11C', 'Tipo C',
     'Camara trampa', 360309, 7441359, 'Norte', 'Mammalia', 2,
     'Hembra con crías', 'Adulto', 'Vivo'],
    [2, 'A. Pérez', 'Equipo 3', '2026-06-02', '10:30', 'EM12', 'CT12C', 'Tipo C',
     'Camara trampa', 360409, 7441459, 'Norte', 'Aves', 1,
     'No registrada', 'Adulto', 'Vivo'],
    [3, 'A. Pérez', 'Equipo 3', '2026-06-03', '09:00', 'EM13', 'CT13C', 'Tipo B',
     'Camara trampa', 360509, 7441559, 'Sur', 'Aves', 4,
     'No registrada', 'Adulto', 'Vivo'],
  ],
});

describe('encabezados con instrucciones adentro', () => {
  const d = detectTemplate(consultoraC, 'consultora-c.xlsx');
  const hoja = d.sheets.find((s) => s.name === 'LDB')!;
  const campo = (header: string) => hoja.columns.find((c) => c.header === header)?.fieldId ?? null;

  it('ignora la instrucción entre paréntesis para reconocer la columna', () => {
    expect(campo('UTM -E (no modificar)')).toBe('occurrence.utmEast');
    expect(campo('UTM-N (no modificar)')).toBe('occurrence.utmNorth');
    expect(campo('Método (no modificar)')).toBe('event.method');
    expect(campo('ID. Estación de Muestreo (No modificar)')).toBe('station.code');
  });

  it('no confunde el correlativo de filas con el orden taxonómico', () => {
    // "Orden" es a la vez el orden de Linneo y el número de fila. Si la
    // columna trae puros números, no es taxonomía: mejor vacía que errada.
    expect(campo('Orden (No cambiar numeración)')).toBeNull();
  });

  it('no empareja un encabezado corto por aparecer dentro de un alias largo', () => {
    // "TIPO" es tipo de estación aquí, no el filo ni el tipo de registro.
    expect(campo('TIPO (no modificar)')).toBeNull();
  });

  it('reconoce las columnas que las planillas de terreno traen aparte', () => {
    expect(campo('Responsable')).toBe('event.recordedBy');
    expect(campo('Equipo')).toBe('event.team');
    expect(campo('Sector')).toBe('station.sector');
    expect(campo('ID_TECNICA (no modifcar)')).toBe('occurrence.site');
    expect(campo('Etapa de vida')).toBe('occurrence.lifeStage');
  });

  it('separa la condición reproductiva del estado del organismo', () => {
    // Confundirlas convierte "Hembra con crías" en "Vivo" y se pierde el dato.
    expect(campo('Condición reproductiva')).toBe('occurrence.reproductiveCondition');
    expect(campo('Estado del organismo')).toBe('occurrence.condition');
  });
});
