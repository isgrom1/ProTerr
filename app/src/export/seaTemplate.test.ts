/**
 * La planilla del SEA es la que llega a la autoridad: su forma no puede
 * cambiar por accidente.
 */
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { SEA_DWC_TEMPLATE } from './seaTemplate';
import { FIELDS_BY_ID } from './fields';
import { buildWorkbook } from './workbook';

const hoja = SEA_DWC_TEMPLATE.sheets[0];

describe('planilla oficial del SEA', () => {
  it('trae las 170 columnas del anexo, en su orden', () => {
    expect(hoja.columns).toHaveLength(170);
    expect(hoja.columns[0].header).toBe('occurrenceID');
    expect(hoja.columns[1].header).toBe('basisOfRecord');
    expect(hoja.columns.at(-1)!.header).toBe('expedition');
  });

  it('los encabezados son términos Darwin Core, no traducciones', () => {
    // El anexo trae la fila en español como ayuda, pero la que vale es ésta.
    for (const c of hoja.columns) expect(c.header).toMatch(/^[a-zA-Z]+$/);
  });

  it('cada columna mapeada apunta a un campo que existe', () => {
    for (const c of hoja.columns) {
      if (c.fieldId) expect(FIELDS_BY_ID.has(c.fieldId), `${c.header} → ${c.fieldId}`).toBe(true);
    }
  });

  it('las constantes que exige el estándar salen llenas', () => {
    const constante = (h: string) => hoja.columns.find((c) => c.header === h)?.constant;
    expect(constante('basisOfRecord')).toBe('HumanObservation');
    expect(constante('geodeticDatum')).toBe('WGS84');
    expect(constante('country')).toBe('Chile');
    expect(constante('countryCode')).toBe('CL');
    expect(constante('nomenclaturalCode')).toBe('ICZN');
  });

  it('exporta una hoja sola, con una fila por registro', () => {
    const wb = buildWorkbook([], SEA_DWC_TEMPLATE, {});
    expect(wb.SheetNames).toEqual(['Planilla']);
    const encabezado = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Planilla, { header: 1 })[0];
    expect(encabezado).toHaveLength(170);
  });

  it('lo que no se puede llenar queda vacío, no inventado', () => {
    // Preferimos una celda en blanco que se completa en gabinete antes que un
    // dato fabricado que llega a un informe.
    const sinDato = hoja.columns.filter((c) => !c.fieldId && !c.constant);
    expect(sinDato.length).toBeGreaterThan(0);
    expect(sinDato.some((c) => c.header === 'namePublishedIn')).toBe(true);
  });
});
