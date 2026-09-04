/**
 * Cobertura del plan de terreno.
 *
 * Una campaña no es una lista de lo que se encontró: es una grilla de
 * estaciones por metodología que había que recorrer. Al final del día importa
 * tanto lo que se hizo como lo que quedó pendiente y lo que no se pudo hacer,
 * y esas tres cosas son distintas:
 *
 * - **realizado**: hay muestreo, con o sin detecciones.
 * - **no realizado**: se fue o se intentó y no se pudo (sin acceso, camino
 *   cortado, lluvia). Es un dato, no un hueco, y lleva su motivo.
 * - **pendiente**: todavía no se toca. No es una falla, es trabajo por hacer.
 *
 * El plan sale de lo que ya está en el catálogo: cada estación declara las
 * metodologías que le corresponden. No hay una tabla aparte que mantener.
 */
import type { MethodCode, SamplingEvent, Station, Uuid } from '../domain/types';

export type PlanState = 'realizado' | 'no realizado' | 'pendiente';

export interface PlanRow {
  station: Station;
  method: MethodCode;
  state: PlanState;
  /** El muestreo que cubre esta celda, si existe. */
  event: SamplingEvent | null;
  /** Motivo declarado cuando no se realizó. */
  reason: string | null;
  /** Se recorrió y no se detectó nada: realizado, pero vacío. */
  noDetections: boolean;
}

export interface PlanSummary {
  rows: PlanRow[];
  planned: number;
  done: number;
  notPerformed: number;
  pending: number;
  /** Fracción del plan cubierta, contando sólo lo realizado. */
  coverage: number;
  /** Muestreos que existen fuera del plan (estación sin esa metodología declarada). */
  offPlan: SamplingEvent[];
}

export interface PlanOptions {
  projectId?: Uuid | null;
  campaignId?: Uuid | null;
}

/**
 * Cruza el plan con lo hecho. Un evento marcado `performed === false` cuenta
 * como "no realizado" aunque tenga registros: el usuario lo dijo explícito y
 * su palabra manda sobre lo que se infiera de los datos.
 */
export function summarizePlan(
  stations: Station[], events: SamplingEvent[], options: PlanOptions = {},
): PlanSummary {
  const vivos = events.filter((e) => !e.deletedAt
    && (!options.campaignId || e.campaignId === options.campaignId));

  const porCelda = new Map<string, SamplingEvent>();
  for (const e of vivos) {
    const key = cellKey(e.stationId, e.method);
    const previo = porCelda.get(key);
    // Si hay más de un muestreo para la misma celda, manda el que dice algo:
    // primero lo declarado como no realizado, luego el más reciente.
    if (!previo || e.performed === false || e.eventDate > previo.eventDate) porCelda.set(key, e);
  }

  const enPlan = new Set<string>();
  const rows: PlanRow[] = [];
  for (const station of stations) {
    if (options.projectId && station.projectId !== options.projectId) continue;
    for (const method of station.methods) {
      const key = cellKey(station.id, method);
      enPlan.add(key);
      const event = porCelda.get(key) ?? null;
      rows.push({
        station, method, event,
        state: stateOf(event),
        reason: event?.notPerformedReason ?? null,
        noDetections: event?.noDetections === true,
      });
    }
  }

  const offPlan = vivos.filter((e) => !enPlan.has(cellKey(e.stationId, e.method)));
  const done = rows.filter((r) => r.state === 'realizado').length;
  const notPerformed = rows.filter((r) => r.state === 'no realizado').length;

  return {
    rows,
    planned: rows.length,
    done,
    notPerformed,
    pending: rows.length - done - notPerformed,
    coverage: rows.length ? done / rows.length : 0,
    offPlan,
  };
}

function stateOf(event: SamplingEvent | null): PlanState {
  if (!event) return 'pendiente';
  if (event.performed === false) return 'no realizado';
  return 'realizado';
}

function cellKey(stationId: Uuid, method: MethodCode): string {
  return `${stationId}::${method}`;
}

/** Lo que falta por hacer, ordenado para leerlo en terreno. */
export function pending(summary: PlanSummary): PlanRow[] {
  return summary.rows
    .filter((r) => r.state === 'pendiente')
    .sort((a, b) => a.station.stationCode.localeCompare(b.station.stationCode));
}
