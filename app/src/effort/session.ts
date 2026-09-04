/**
 * Esfuerzo de muestreo.
 *
 * Sin esfuerzo, una abundancia no significa nada: "8 chucaos" no es comparable
 * entre campañas si no se sabe si fueron 20 minutos o dos horas, 300 m o 2 km.
 * La planilla original no registraba esfuerzo en absoluto, y eso vuelve
 * inutilizable cualquier análisis de tendencia entre temporadas.
 *
 * Este módulo abre y cierra el muestreo, acumula el recorrido GPS y calcula la
 * distancia. Todo vive en el evento, no en cada observación.
 */
import type {
  EnvironmentalConditions, MethodCode, SamplingEvent, TrackPoint, Waypoint,
} from '../domain/types';
import { distanceMeters } from '../geo/utm';

/** Metodologías cuyo esfuerzo se mide en distancia recorrida. */
export const DISTANCE_METHODS: MethodCode[] = ['transecto', 'registro_oportunista'];
/** Metodologías cuyo esfuerzo se mide en trampas × noches. */
export const TRAP_METHODS: MethodCode[] = ['camara_trampa', 'trampa_sherman'];
/** Metodologías cuyo esfuerzo se mide en tiempo de permanencia. */
export const DURATION_METHODS: MethodCode[] = ['punto_conteo', 'playback_aves', 'playback_anfibios', 'transito_aereo', 'songmeter'];

/**
 * Filtro de puntos GPS antes de sumarlos al recorrido.
 *
 * Un punto con precisión de 100 m añade ruido, no información: aceptarlo puede
 * inflar la distancia en cientos de metros mientras el usuario está detenido.
 * También se descartan los saltos imposibles a pie.
 */
export interface TrackFilterOptions {
  maxAccuracyMeters?: number;
  minStepMeters?: number;
  maxSpeedMetersPerSecond?: number;
}

const DEFAULTS: Required<TrackFilterOptions> = {
  maxAccuracyMeters: 30,
  minStepMeters: 5,
  maxSpeedMetersPerSecond: 5,
};

export interface TrackAppendResult {
  track: TrackPoint[];
  accepted: boolean;
  reason?: 'precision' | 'sin-movimiento' | 'salto-imposible';
}

export function appendTrackPoint(
  track: TrackPoint[], point: TrackPoint, options: TrackFilterOptions = {},
): TrackAppendResult {
  const o = { ...DEFAULTS, ...options };
  if (point.acc != null && point.acc > o.maxAccuracyMeters) {
    return { track, accepted: false, reason: 'precision' };
  }
  const last = track[track.length - 1];
  if (!last) return { track: [...track, point], accepted: true };

  const step = distanceMeters(
    { latitude: last.lat, longitude: last.lon },
    { latitude: point.lat, longitude: point.lon },
  );
  if (step < o.minStepMeters) return { track, accepted: false, reason: 'sin-movimiento' };

  const seconds = (Date.parse(point.t) - Date.parse(last.t)) / 1000;
  if (seconds > 0 && step / seconds > o.maxSpeedMetersPerSecond) {
    return { track, accepted: false, reason: 'salto-imposible' };
  }
  return { track: [...track, point], accepted: true };
}

/** Longitud del recorrido en metros, sumando tramo a tramo. */
export function trackLengthMeters(track: TrackPoint[]): number {
  let total = 0;
  for (let i = 1; i < track.length; i++) {
    total += distanceMeters(
      { latitude: track[i - 1].lat, longitude: track[i - 1].lon },
      { latitude: track[i].lat, longitude: track[i].lon },
    );
  }
  return Math.round(total);
}

export interface EffortSummary {
  durationMinutes: number | null;
  distanceMeters: number | null;
  trapNights: number | null;
  unit: 'distancia' | 'trampas-noche' | 'duración' | 'sin-esfuerzo';
  /** Alguien activó la medición del esfuerzo en este muestreo. */
  measured: boolean;
  /** Texto listo para mostrar, p. ej. "42 min · 1,30 km". */
  label: string;
  /** Se empezó a medir el esfuerzo y quedó a medias. Nunca es true si `measured` es false. */
  incomplete: boolean;
}

/**
 * Etiquetas de waypoint que el usuario dice en voz alta. Un transecto se marca
 * normalmente en el inicio, a los 100 m, a los 200 m y al final; el número es
 * la distancia acumulada, así que sirve de etiqueta tal cual.
 */
export function normalizeWaypointLabel(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (/^(inicio|inicial|partida|comienzo|cero|0)$/.test(t)) return 'inicio';
  if (/^(final|fin|termino|t[eé]rmino|llegada)$/.test(t)) return 'final';
  if (/^(medio|intermedio|mitad)$/.test(t)) return 'medio';
  return t;
}

/**
 * Distancia del transecto a partir de los waypoints, en el orden en que se
 * marcaron. Es la alternativa liviana al track completo: tres puntos bastan
 * para saber cuánto se recorrió, sin el GPS encendido todo el rato.
 */
export function waypointDistanceMeters(waypoints: Waypoint[]): number | null {
  if (waypoints.length < 2) return null;
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += distanceMeters(
      { latitude: waypoints[i - 1].latitude, longitude: waypoints[i - 1].longitude },
      { latitude: waypoints[i].latitude, longitude: waypoints[i].longitude },
    );
  }
  return Math.round(total);
}

export type EffortInput = Pick<SamplingEvent,
  'method' | 'startedAt' | 'endedAt' | 'track' | 'waypoints' | 'distanceMeters' | 'trapCount' | 'trapNights'>;

/**
 * Resume el esfuerzo de un muestreo. Devuelve `measured: false` cuando el
 * usuario nunca pidió medirlo, que es el caso normal: la app no exige
 * esfuerzo, sólo lo calcula si alguien lo activó.
 */
export function summarizeEffort(event: EffortInput, now = new Date()): EffortSummary {
  const start = event.startedAt ? Date.parse(event.startedAt) : null;
  const end = event.endedAt ? Date.parse(event.endedAt) : (start != null ? now.getTime() : null);
  const durationMinutes = start != null && end != null ? Math.max(0, Math.round((end - start) / 60000)) : null;

  const distance = event.distanceMeters
    ?? (event.track?.length ? trackLengthMeters(event.track) : null)
    ?? waypointDistanceMeters(event.waypoints ?? []);
  const trapNights = event.trapNights ?? null;

  const unit: EffortSummary['unit'] = DISTANCE_METHODS.includes(event.method) ? 'distancia'
    : TRAP_METHODS.includes(event.method) ? 'trampas-noche'
    : DURATION_METHODS.includes(event.method) ? 'duración'
    : 'sin-esfuerzo';

  const parts: string[] = [];
  if (durationMinutes != null) parts.push(formatDuration(durationMinutes));
  if (distance != null && unit === 'distancia') parts.push(formatDistance(distance));
  if (trapNights != null && unit === 'trampas-noche') {
    parts.push(`${trapNights} trampa-noche${trapNights === 1 ? '' : 's'}`);
  }

  // ¿Alguien pidió medir el esfuerzo? Si nadie lo activó, no hay nada
  // "incompleto": el registro rápido es un modo legítimo, no un descuido.
  const measured = start != null || Boolean(event.track?.length) || Boolean(event.waypoints?.length)
    || distance != null || trapNights != null;

  const incomplete = measured && (
    (unit === 'distancia' && distance == null)
    || (unit === 'trampas-noche' && trapNights == null)
    || (unit === 'duración' && durationMinutes == null)
  );

  return {
    durationMinutes, distanceMeters: distance, trapNights, unit, measured, incomplete,
    label: parts.join(' · ') || (measured ? 'esfuerzo incompleto' : 'sin medición de esfuerzo'),
  };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(2).replace('.', ',')} km`;
}

/** Trampas × noches: el esfuerzo estándar en trampeo y cámaras trampa. */
export function trapNightsBetween(trapCount: number, installedOn: string, retrievedOn: string): number {
  const nights = Math.max(0, Math.round((Date.parse(retrievedOn) - Date.parse(installedOn)) / 86400000));
  return trapCount * nights;
}

/** Condiciones vacías pero explícitas: distingue "no medido" de "cero". */
export const EMPTY_CONDITIONS: EnvironmentalConditions = {
  temperatureC: null, windBeaufort: null, cloudOctas: null, precipitation: null, period: null,
};

/** Deduce el periodo del día desde la hora local; el usuario puede corregirlo. */
export function inferPeriod(time: string): EnvironmentalConditions['period'] {
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour >= 21 || hour < 5) return 'Nocturno';
  if (hour < 8 || hour >= 19) return 'Crepuscular';
  return 'Diurno';
}

/**
 * Abundancia relativa: individuos por unidad de esfuerzo. Es la cifra que
 * realmente se compara entre campañas, y la que la planilla nunca permitió
 * calcular porque no guardaba el denominador.
 */
export function relativeAbundance(individuals: number, effort: EffortSummary): { value: number; unit: string } | null {
  if (effort.unit === 'distancia' && effort.distanceMeters) {
    return { value: round2((individuals / effort.distanceMeters) * 1000), unit: 'ind/km' };
  }
  if (effort.unit === 'trampas-noche' && effort.trapNights) {
    return { value: round2((individuals / effort.trapNights) * 100), unit: 'ind/100 trampas-noche' };
  }
  if (effort.unit === 'duración' && effort.durationMinutes) {
    return { value: round2((individuals / effort.durationMinutes) * 60), unit: 'ind/h' };
  }
  return null;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
