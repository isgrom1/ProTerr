/**
 * La aritmética del ciclo. Es corta y no puede tener errores: un día mal
 * contado es alguien que llega al cerro y encuentra la app cerrada.
 */
import { describe, expect, it } from 'vitest';
import { cicloDe, diasEntre, jornadaDe, sumarDias } from './ciclo';

describe('la jornada cambia a las 04:00, no a medianoche', () => {
  it('las dos de la mañana siguen siendo el día anterior', () => {
    // Conteo de tránsito aéreo nocturno: empezó el sábado a las 22:00 y sigue.
    expect(jornadaDe(new Date(2026, 8, 6, 2, 0))).toBe('2026-09-05');
  });

  it('a las cuatro empieza el día nuevo', () => {
    expect(jornadaDe(new Date(2026, 8, 6, 4, 0))).toBe('2026-09-06');
  });

  it('el resto del día es lo obvio', () => {
    expect(jornadaDe(new Date(2026, 8, 6, 10, 30))).toBe('2026-09-06');
    expect(jornadaDe(new Date(2026, 8, 6, 23, 59))).toBe('2026-09-06');
  });
});

describe('posición en el ciclo', () => {
  const inicio = '2026-09-05';

  it('los dos primeros días son gratis', () => {
    expect(cicloDe(inicio, '2026-09-05')).toMatchObject({ posicion: 0, gratis: true, numero: 1 });
    expect(cicloDe(inicio, '2026-09-06')).toMatchObject({ posicion: 1, gratis: true });
  });

  it('los cinco siguientes son de pago', () => {
    for (const [dia, posicion] of [['2026-09-07', 2], ['2026-09-08', 3], ['2026-09-09', 4], ['2026-09-10', 5], ['2026-09-11', 6]] as const) {
      expect(cicloDe(inicio, dia)).toMatchObject({ posicion, gratis: false });
    }
  });

  it('al octavo día vuelve a empezar', () => {
    expect(cicloDe(inicio, '2026-09-12')).toMatchObject({ posicion: 0, gratis: true, numero: 2 });
  });

  it('dice cuántos días faltan para el próximo gratis', () => {
    expect(cicloDe(inicio, '2026-09-07').diasParaGratis).toBe(5);
    expect(cicloDe(inicio, '2026-09-11').diasParaGratis).toBe(1);
    expect(cicloDe(inicio, '2026-09-12').diasParaGratis).toBe(0);
  });

  it('los días gratis NO se acumulan al no usar la app', () => {
    // Tres semanas sin salir a terreno. Al volver hay dos días gratis, no seis.
    expect(cicloDe(inicio, '2026-09-26').gratis).toBe(true);
    expect(cicloDe(inicio, '2026-09-27').gratis).toBe(true);
    expect(cicloDe(inicio, '2026-09-28').gratis).toBe(false);
  });

  it('una fecha anterior al inicio no devuelve una posición negativa', () => {
    expect(cicloDe(inicio, '2026-09-03').posicion).toBe(5);
  });
});

describe('cuentas de fechas', () => {
  it('cuenta días entre jornadas, con signo', () => {
    expect(diasEntre('2026-09-05', '2026-09-12')).toBe(7);
    expect(diasEntre('2026-09-12', '2026-09-05')).toBe(-7);
    expect(diasEntre('2026-09-05', '2026-09-05')).toBe(0);
  });

  it('el cambio de hora de verano no desfasa la cuenta', () => {
    // En Chile el reloj se adelanta la primera madrugada de septiembre.
    expect(diasEntre('2026-09-05', '2026-10-05')).toBe(30);
  });

  it('suma días cruzando el fin de mes', () => {
    expect(sumarDias('2026-09-28', 5)).toBe('2026-10-03');
  });
});
