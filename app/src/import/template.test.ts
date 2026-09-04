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
