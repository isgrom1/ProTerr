/**
 * Registro diferido: lo que se anota después, en la casa.
 *
 * Pasa siempre, y de dos maneras que NO son lo mismo:
 *
 * 1. **Se me olvidó anotarlo.** El transecto fue hoy y en la casa uno se
 *    acuerda de la loica macho del EMF44. Ese registro pertenece a ese
 *    muestreo: entra tal cual, sólo queda constancia de que se escribió después.
 *
 * 2. **Lo vi otro día.** El transecto fue ayer y hoy, pasando por el camino
 *    cerca del punto, aparece una especie. Ese registro pertenece al PUNTO,
 *    pero no al transecto de ayer: meterlo ahí falsearía el esfuerzo de ese
 *    muestreo y la abundancia relativa que se calcula con él. Va como registro
 *    oportunista del día en que se vio, ligado a la misma estación.
 *
 * Y hay un tercer caso que no se puede decidir solo: las **réplicas**. Volver
 * al mismo punto con la misma metodología otro día es normal en una campaña.
 * Cuando no hay forma de distinguir una réplica de un avistamiento de paso, la
 * app pregunta en vez de elegir.
 */
import type { MethodCode, SamplingEvent, Uuid } from '../domain/types';

export type EntryMode =
  /** Registro del día, sin nada especial. */
  | 'normal'
  /** Del mismo muestreo, anotado después. Entra al muestreo tal cual. */
  | 'olvido'
  /** De otro día: va al punto pero fuera del muestreo, como oportunista. */
  | 'otro_dia'
  /** Podría ser una réplica del muestreo o un avistamiento de paso. */
  | 'quizas_replica';

export interface EntryDecision {
  mode: EntryMode;
  /** Fecha con que se guarda el muestreo. */
  eventDate: string;
  /** Metodología con que se guarda: puede no ser la seleccionada. */
  method: MethodCode;
  /** true si se escribió después del día del avistamiento. */
  deferred: boolean;
  /** Qué decirle al usuario. `null` cuando no hay nada que advertir. */
  notice: string | null;
  /**
   * Alternativa que la app NO eligió, para ofrecerla con un botón. Existe
   * sólo cuando la decisión era genuinamente ambigua.
   */
  alternative: { label: string; method: MethodCode } | null;
}

export interface EntryContext {
  /** Fecha del avistamiento (la dicha, o hoy). */
  sightingDate: string;
  today: string;
  stationId: Uuid | null;
  method: MethodCode | null;
  /** Muestreos ya guardados (vivos). */
  events: SamplingEvent[];
}

const OPORTUNISTA: MethodCode = 'registro_oportunista';

export function resolveEntry(ctx: EntryContext): EntryDecision {
  const { sightingDate, today, stationId, method } = ctx;
  const base: EntryDecision = {
    mode: 'normal', eventDate: sightingDate, method: method ?? OPORTUNISTA,
    deferred: sightingDate !== today, notice: null, alternative: null,
  };
  if (!stationId || !method) return base;

  const enEstacion = ctx.events.filter((e) => !e.deletedAt && e.stationId === stationId);
  const mismoMetodo = enEstacion.filter((e) => e.method === method);
  const eseDia = mismoMetodo.find((e) => e.eventDate === sightingDate);

  // --- Hay muestreo de ese día: el registro es de ahí ---
  if (eseDia) {
    if (sightingDate === today) return base;
    return {
      ...base,
      mode: 'olvido',
      notice: `Se agrega al ${nombre(method)} del ${legible(sightingDate)}, anotado hoy.`,
    };
  }

  const otrosDias = mismoMetodo.map((e) => e.eventDate).sort();
  // --- Nunca se ha muestreado aquí con esta metodología: es el primero ---
  if (!otrosDias.length) {
    if (sightingDate === today) return base;
    // Se está abriendo un muestreo con fecha pasada. Es legítimo —el terreno
    // fue ese día y se pasa a la app después— pero tiene que verse.
    return {
      ...base,
      mode: 'olvido',
      notice: `Se guarda con fecha del ${legible(sightingDate)}, no de hoy.`,
    };
  }

  const ultimo = otrosDias[otrosDias.length - 1];

  // --- El usuario dijo una fecha y ese día no hubo muestreo ---
  // Dijo explícitamente cuándo lo vio, así que no hay nada que preguntar: es
  // un avistamiento fuera del muestreo.
  if (sightingDate !== today) {
    return {
      mode: 'otro_dia', eventDate: sightingDate, method: OPORTUNISTA, deferred: true,
      notice: `El ${legible(sightingDate)} no hubo ${nombre(method)} en esta estación`
        + ` (el último fue el ${legible(ultimo)}). Queda como registro oportunista del punto,`
        + ' fuera de ese muestreo.',
      alternative: null,
    };
  }

  // --- Es hoy, ya se muestreó aquí otro día, y hoy no hay muestreo abierto ---
  // Puede ser una réplica de campaña o un avistamiento de paso. No se puede
  // saber, así que se toma la opción que no daña el dato —oportunista, que no
  // inventa esfuerzo— y se ofrece la otra.
  return {
    mode: 'quizas_replica', eventDate: today, method: OPORTUNISTA, deferred: false,
    notice: `El ${nombre(method)} de esta estación fue el ${legible(ultimo)}, no hoy.`
      + ' Se guarda como registro oportunista del punto; si hoy volviste a hacer el'
      + ' muestreo completo, cámbialo.',
    alternative: { label: `Es un ${nombre(method)} nuevo de hoy`, method },
  };
}

const NOMBRES: Partial<Record<MethodCode, string>> = {
  transecto: 'transecto',
  playback_aves: 'playback de aves',
  playback_anfibios: 'playback de anfibios',
  camara_trampa: 'revisión de cámara trampa',
  trampa_sherman: 'trampeo Sherman',
  songmeter: 'monitoreo acústico',
  transito_aereo: 'tránsito aéreo',
  transito_aereo_nocturno: 'tránsito aéreo nocturno',
  punto_conteo: 'punto de conteo',
  atropello: 'registro de atropello',
  registro_oportunista: 'registro oportunista',
};

function nombre(method: MethodCode): string {
  return NOMBRES[method] ?? 'muestreo';
}

/** "2026-09-03" -> "3 de septiembre". El año sólo si no es el mismo. */
function legible(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const mes = meses[(m ?? 1) - 1] ?? '';
  const anio = y === new Date().getFullYear() ? '' : ` de ${y}`;
  return `${d} de ${mes}${anio}`;
}
