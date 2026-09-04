/**
 * Comandos de voz (brief §19). Se interpretan ANTES que una observación:
 * "cambiar estación a EMF10" es una orden, no un avistamiento.
 */
import { fold } from './text';

export type VoiceCommand =
  | { kind: 'nuevo_registro' }
  | { kind: 'guardar' }
  | { kind: 'cancelar' }
  | { kind: 'eliminar' }
  | { kind: 'agregar_foto' }
  | { kind: 'agregar_individuo'; delta: number }
  | { kind: 'editar_abundancia'; value: number }
  | { kind: 'cambiar_estacion'; stationCode: string }
  | { kind: 'cambiar_metodologia'; text: string }
  | { kind: 'revisar_pendientes' }
  | { kind: 'que_me_falta' }
  | { kind: 'resumen' }
  | { kind: 'sincronizar' }
  | { kind: 'duplicar' }
  /** Recorrido explícito: la app nunca graba el track por su cuenta. */
  | { kind: 'iniciar_track' }
  | { kind: 'cerrar_track' }
  | { kind: 'marcar_punto'; label: string }
  | { kind: 'sin_detecciones' };

interface Rule {
  test: RegExp;
  build: (m: RegExpMatchArray) => VoiceCommand | null;
}

const RULES: Rule[] = [
  { test: /^(que me falta|qué me falta|que falta|falta algo)$/, build: () => ({ kind: 'que_me_falta' }) },
  { test: /^(nuevo registro|otra observacion|siguiente registro|nueva observacion)$/, build: () => ({ kind: 'nuevo_registro' }) },
  { test: /^(guardar|guarda|listo|ok guardar|confirmar)$/, build: () => ({ kind: 'guardar' }) },
  { test: /^(cancelar|descartar|borrar esto|olvidalo)$/, build: () => ({ kind: 'cancelar' }) },
  { test: /^(eliminar|eliminar registro|borrar registro)$/, build: () => ({ kind: 'eliminar' }) },
  { test: /^(duplicar|duplicar registro|repetir registro|otro igual)$/, build: () => ({ kind: 'duplicar' }) },
  { test: /^(agregar foto|agrega foto|tomar foto|tomar fotografia|agregar fotografia)$/, build: () => ({ kind: 'agregar_foto' }) },
  { test: /^(revisar pendientes|ver pendientes|pendientes)$/, build: () => ({ kind: 'revisar_pendientes' }) },
  { test: /^(resumen|resumen del dia|resumen de terreno|resumen de la jornada)$/, build: () => ({ kind: 'resumen' }) },
  { test: /^(sincronizar|sincroniza|subir datos|subir registros)$/, build: () => ({ kind: 'sincronizar' }) },
  {
    test: /^agregar (otro individuo|un individuo|(\d+) individuos)$/,
    build: (m) => ({ kind: 'agregar_individuo', delta: m[2] ? Number(m[2]) : 1 }),
  },
  {
    test: /^(?:editar |cambiar |corregir )?abundancia (?:a |en )?(\d+)$/,
    build: (m) => ({ kind: 'editar_abundancia', value: Number(m[1]) }),
  },
  {
    test: /^cambiar estacion (?:a |por )?([a-z]{1,5}) ?(\d{1,3})$/,
    build: (m) => ({ kind: 'cambiar_estacion', stationCode: (m[1] + m[2]).toUpperCase() }),
  },
  {
    test: /^(iniciar|comenzar|empezar|abrir|partir) (el )?track(eo)?$/,
    build: () => ({ kind: 'iniciar_track' }),
  },
  {
    test: /^(cerrar|terminar|finalizar|detener|parar) (el )?track(eo)?$/,
    build: () => ({ kind: 'cerrar_track' }),
  },
  {
    // "punto 100", "marcar punto medio", "pto final", "punto de inicio"
    test: /^(?:marcar |marca )?(?:punto|pto|waypoint) (?:de )?([a-z0-9]+)$/,
    build: (m) => ({ kind: 'marcar_punto', label: m[1] }),
  },
  {
    test: /^(sin registros?|sin detecciones?|nada que registrar|estacion vacia)$/,
    build: () => ({ kind: 'sin_detecciones' }),
  },
  {
    test: /^(?:cambiar |usar )?metodologia (?:a |por )?(.+)$/,
    build: (m) => ({ kind: 'cambiar_metodologia', text: m[1] }),
  },
];

/**
 * Devuelve el comando si la frase ES un comando completo. Si el usuario dice
 * "cambiar estación a EMF10 y un chucao", no es un comando: se trata como
 * dictado normal para no perder la observación.
 */
export function parseCommand(raw: string): VoiceCommand | null {
  const text = fold(raw);
  for (const rule of RULES) {
    const m = text.match(rule.test);
    if (m) return rule.build(m);
  }
  return null;
}
