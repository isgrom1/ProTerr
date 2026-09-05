/**
 * El ciclo de licencia: 2 días gratis, 5 de pago, y vuelta a empezar.
 *
 * Dos reglas que parecen detalles y no lo son:
 *
 * 1. **Los 2 gratis no se acumulan.** Son posicionales, no un saldo: caen en los
 *    días 1 y 2 de cada ciclo de siete y se pierden si no se usan. Quien no sale
 *    a terreno en dos semanas no llega con cuatro días guardados. Por eso aquí
 *    no hay contador de días gratis consumidos: la posición en el ciclo es toda
 *    la información que hace falta.
 *
 * 2. **La jornada corre de 04:00 a 04:00, no de medianoche a medianoche.** El
 *    monitoreo de tránsito aéreo nocturno se hace entre las 22:00 y las 02:00.
 *    Con el corte a medianoche la app se bloquearía en mitad de un conteo, con
 *    el observador en un cerro y sin señal para desbloquearla. A las 04:00 no
 *    hay nadie trabajando: es la única hora segura para cambiar de día.
 *
 * Todo aquí es cálculo puro sobre fechas locales. Nada de esto toca la base ni
 * sabe si el usuario pagó: eso vive en `licencia.ts`.
 */

/** Hora a la que cambia la jornada. Ver la regla 2 de arriba. */
export const HORA_CORTE = 4;

export const DIAS_GRATIS = 2;
export const DIAS_PAGO = 5;
export const LARGO_CICLO = DIAS_GRATIS + DIAS_PAGO;

export interface Ciclo {
  /** Qué ciclo va corriendo, contando desde 1 en el primer uso. */
  numero: number;
  /** Posición dentro del ciclo, de 0 a 6. Las dos primeras son gratis. */
  posicion: number;
  gratis: boolean;
  /** Cuántas jornadas faltan para el próximo día gratis. 0 si hoy lo es. */
  diasParaGratis: number;
}

/**
 * A qué jornada pertenece un instante. Devuelve `YYYY-MM-DD` en hora local:
 * las 02:00 del miércoles siguen siendo la jornada del martes.
 */
export function jornadaDe(t: Date = new Date(), horaCorte = HORA_CORTE): string {
  const d = new Date(t.getTime());
  d.setHours(d.getHours() - horaCorte);
  return fechaLocal(d);
}

/**
 * Días calendario entre dos jornadas. Negativo si `b` es anterior a `a`, que es
 * como se detecta un reloj atrasado.
 */
export function diasEntre(a: string, b: string): number {
  // Ancladas al mediodía: así un cambio de horario de verano —que en Chile
  // mueve el reloj en la madrugada— no convierte 24 horas en 23 y desfasa la
  // cuenta un día entero.
  return Math.round((aFecha(b).getTime() - aFecha(a).getTime()) / 86_400_000);
}

/** En qué parte del ciclo cae una jornada, contando desde el primer uso. */
export function cicloDe(inicio: string, jornada: string): Ciclo {
  const transcurridos = diasEntre(inicio, jornada);
  // El módulo se normaliza para que una fecha anterior al inicio no devuelva
  // una posición negativa. Que eso ocurra es problema de `licencia.ts`, no de
  // esta función, pero devolver -3 rompería a quien la llame.
  const posicion = ((transcurridos % LARGO_CICLO) + LARGO_CICLO) % LARGO_CICLO;
  const gratis = posicion < DIAS_GRATIS;
  return {
    numero: Math.floor(Math.max(0, transcurridos) / LARGO_CICLO) + 1,
    posicion,
    gratis,
    diasParaGratis: gratis ? 0 : LARGO_CICLO - posicion,
  };
}

/** Suma días a una jornada. Para calcular hasta cuándo alcanza una suscripción. */
export function sumarDias(jornada: string, dias: number): string {
  const d = aFecha(jornada);
  d.setDate(d.getDate() + dias);
  return fechaLocal(d);
}

function aFecha(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function fechaLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
