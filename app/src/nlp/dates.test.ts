/**
 * Fechas habladas. La referencia se fija a mano para que las pruebas no
 * dependan del día en que se corren.
 */
import { describe, expect, it } from 'vitest';
import { findSpokenDate, readSpokenDate } from './dates';
import { fold } from './text';

// Viernes 4 de septiembre de 2026.
const HOY = new Date(2026, 8, 4);
const leer = (texto: string) => readSpokenDate(fold(texto).split(' '), 0, HOY);

describe('fechas dichas como se dicen', () => {
  const casos: Array<[string, string, number]> = [
    ['hoy', '2026-09-04', 0],
    ['ayer', '2026-09-03', 1],
    ['anteayer', '2026-09-02', 2],
    ['antes de ayer', '2026-09-02', 2],
    ['hace dos días', '2026-09-02', 2],
    ['hace 5 dias', '2026-08-30', 5],
    ['el lunes', '2026-08-31', 4],
    ['el lunes pasado', '2026-08-24', 11],
    ['el 2 de junio', '2026-06-02', 94],
  ];
  for (const [texto, esperado, dias] of casos) {
    it(`"${texto}" → ${esperado}`, () => {
      const d = leer(texto);
      expect(d?.iso).toBe(esperado);
      expect(d?.daysAgo).toBe(dias);
    });
  }

  it('el día de la semana siempre mira hacia atrás', () => {
    expect(leer('el miércoles')?.iso).toBe('2026-09-02');
    // Hoy es viernes: "el viernes" es el de la semana pasada, no hoy.
    expect(leer('el viernes')?.iso).toBe('2026-08-28');
  });

  it('una fecha sin año se resuelve al pasado, no al futuro', () => {
    // 20 de diciembre todavía no llega en 2026: es el de 2025.
    expect(leer('el 20 de diciembre')?.iso).toBe('2025-12-20');
  });

  it('no inventa fechas donde no las hay', () => {
    expect(leer('un chucao cantando')).toBeNull();
    expect(leer('emf44')).toBeNull();
    // "una loica": "una" es cantidad, no un día del mes sin mes.
    expect(leer('una loica')).toBeNull();
  });

  it('la encuentra en medio de la frase', () => {
    const hit = findSpokenDate(fold('emf44 ayer una loica macho').split(' '), HOY);
    expect(hit?.start).toBe(1);
    expect(hit?.date.iso).toBe('2026-09-03');
    expect(hit?.date.length).toBe(1);
  });
});
