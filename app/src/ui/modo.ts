/**
 * Modo de pantalla: sombra, sol o noche.
 *
 * No es una preferencia estética, es una condición de trabajo. El modo noche
 * existe porque el monitoreo de tránsito aéreo nocturno se hace con visor, y
 * una pantalla blanca destruye la adaptación a la oscuridad del observador
 * durante varios minutos. Por eso se enciende SOLO al elegir esa metodología,
 * sin preguntar: para cuando uno se acuerda de cambiarlo, ya se perdió el ojo.
 *
 * Lo que el usuario elige a mano manda por el resto de la jornada; el
 * automático vuelve a actuar recién al día siguiente.
 */
import type { MethodCode } from '../domain/types';

export type Modo = 'sombra' | 'sol' | 'noche';

const CLAVE = 'proterr.modo';
const CLAVE_MANUAL = 'proterr.modo.manual';

export const MODOS: Array<{ id: Modo; label: string; detalle: string }> = [
  { id: 'sombra', label: 'Sombra', detalle: 'El de siempre. Ahorra batería y no encandila.' },
  { id: 'sol', label: 'Sol', detalle: 'Máximo contraste para mediodía a pleno sol.' },
  { id: 'noche', label: 'Noche', detalle: 'Sólo rojo. Conserva la visión nocturna con visor.' },
];

/** Metodologías que se trabajan de noche y exigen el modo rojo. */
const NOCTURNAS: MethodCode[] = ['transito_aereo_nocturno', 'playback_anfibios'];

export function readModo(): Modo | null {
  const v = globalThis.localStorage?.getItem(CLAVE);
  return v === 'sombra' || v === 'sol' || v === 'noche' ? v : null;
}

export function applyModo(modo: Modo | null): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (modo) root.setAttribute('data-modo', modo);
  else root.removeAttribute('data-modo');
}

/** Elección explícita: se recuerda y bloquea el automático hasta mañana. */
export function setModo(modo: Modo): void {
  globalThis.localStorage?.setItem(CLAVE, modo);
  globalThis.localStorage?.setItem(CLAVE_MANUAL, hoy());
  applyModo(modo);
}

/**
 * Ajuste automático al cambiar de metodología. Devuelve el modo aplicado, o
 * null si no correspondía tocar nada.
 */
export function modoParaMetodo(method: MethodCode | null): Modo | null {
  if (!method) return null;
  // Si la persona ya eligió hoy, su decisión manda.
  if (globalThis.localStorage?.getItem(CLAVE_MANUAL) === hoy()) return null;

  const actual = readModo();
  if (NOCTURNAS.includes(method)) {
    if (actual === 'noche') return null;
    globalThis.localStorage?.setItem(CLAVE, 'noche');
    applyModo('noche');
    return 'noche';
  }
  // Al salir de una metodología nocturna se vuelve a sombra, no a sol: nadie
  // quiere un fogonazo blanco al terminar el turno de noche.
  if (actual === 'noche') {
    globalThis.localStorage?.setItem(CLAVE, 'sombra');
    applyModo('sombra');
    return 'sombra';
  }
  return null;
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}
