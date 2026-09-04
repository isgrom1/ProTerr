/**
 * Unir la jornada de dos personas.
 *
 * En terreno se sale de a dos —"Isaac Rojas – Diego Segovia"— y cada uno lleva
 * su teléfono. Al llegar, hay dos bases que nadie sabe juntar, y esa es la
 * razón por la que el equipo vuelve al Excel compartido.
 *
 * Se resuelve sin servidor: cada uno exporta su respaldo y uno de los dos los
 * une. Lo que importa es que la unión NO sea a ciegas. Dos personas que
 * recorren el mismo transecto anotan el mismo chucao, y sumar las dos bases
 * diría dos individuos donde había uno. Este módulo mira los dos archivos y
 * dice qué va a pasar ANTES de escribir nada.
 */
import type { Occurrence, SamplingEvent } from '../domain/types';
import { isBackupFile, type BackupFile } from './backup';
import { db } from './db';

/** Minutos dentro de los cuales dos registros de la misma especie se miran con lupa. */
export const VENTANA_MINUTOS = 30;

export interface PosibleDoble {
  /** Nombre científico o el texto dictado, para poder nombrarlo en pantalla. */
  taxon: string;
  stationId: string;
  eventDate: string;
  /** Hora de cada uno de los dos registros. */
  horas: [string, string];
  observadores: [string, string];
  /** Ambos identificadores, para poder abrir cualquiera de los dos. */
  ids: [string, string];
}

export interface MergePreview {
  /** De quién es el archivo. */
  origen: { deviceId: string; observadores: string[]; creado: string | null };
  /** Días que cubre. */
  dias: string[];
  /** Estaciones que toca, por código si se pudo resolver. */
  estaciones: string[];
  nuevos: number;
  yaEstaban: number;
  /** Registros con el mismo id pero distinto contenido: hay que mirarlos. */
  enConflicto: number;
  /**
   * Mismo taxón, misma estación, mismo día y a menos de media hora, anotado
   * por dos personas distintas. Probablemente es UN animal, no dos.
   */
  posiblesDobles: PosibleDoble[];
  avisos: string[];
}

/** Lee el respaldo del compañero y dice qué pasaría al unirlo. No escribe nada. */
export async function previewMerge(file: unknown): Promise<MergePreview> {
  if (!isBackupFile(file)) throw new Error('El archivo no es un respaldo de ProTerr.');
  const backup = file as BackupFile;

  const ajenas = (backup.data.occurrences ?? []) as unknown as Occurrence[];
  const ajenosEventos = (backup.data.events ?? []) as unknown as SamplingEvent[];
  const vivas = ajenas.filter((o) => !o.deletedAt);

  const locales = await db.occurrences.toArray();
  const localesPorId = new Map(locales.map((o) => [o.id, o]));

  let nuevos = 0;
  let yaEstaban = 0;
  let enConflicto = 0;
  for (const o of vivas) {
    const local = localesPorId.get(o.id);
    if (!local) { nuevos++; continue; }
    yaEstaban++;
    if (JSON.stringify(local) !== JSON.stringify(o)) enConflicto++;
  }

  const eventoDe = new Map(ajenosEventos.map((e) => [e.id, e]));
  const estaciones = await db.stations.toArray();
  const codigoDe = new Map(estaciones.map((s) => [s.id, s.stationCode]));

  const dias = [...new Set(ajenosEventos.filter((e) => !e.deletedAt).map((e) => e.eventDate))].sort();
  const estacionesTocadas = [...new Set(
    ajenosEventos.filter((e) => !e.deletedAt).map((e) => codigoDe.get(e.stationId) ?? e.stationId),
  )].sort();

  const observadores = [...new Set(
    ajenosEventos.map((e) => e.recordedBy).filter((v): v is string => Boolean(v)),
  )];

  return {
    origen: {
      deviceId: backup.deviceId ?? 'desconocido',
      observadores,
      creado: backup.createdAt ?? null,
    },
    dias,
    estaciones: estacionesTocadas,
    nuevos,
    yaEstaban,
    enConflicto,
    posiblesDobles: buscarDobles(vivas, locales, eventoDe, await eventosLocales()),
    avisos: avisosDe(backup, dias),
  };
}

async function eventosLocales(): Promise<Map<string, SamplingEvent>> {
  const eventos = await db.events.toArray();
  return new Map(eventos.map((e) => [e.id, e]));
}

/**
 * Dos registros de la misma especie, en la misma estación y el mismo día, a
 * menos de media hora y por observadores distintos. No se borra ninguno: se
 * muestran para que una persona decida, porque a veces sí eran dos animales.
 */
function buscarDobles(
  ajenas: Occurrence[],
  locales: Occurrence[],
  eventosAjenos: Map<string, SamplingEvent>,
  eventosLocales: Map<string, SamplingEvent>,
): PosibleDoble[] {
  const out: PosibleDoble[] = [];
  const vivasLocales = locales.filter((o) => !o.deletedAt);

  for (const a of ajenas) {
    const ea = eventosAjenos.get(a.eventId);
    if (!ea) continue;
    for (const l of vivasLocales) {
      if (l.id === a.id) continue;
      const el = eventosLocales.get(l.eventId);
      if (!el) continue;
      if (el.stationId !== ea.stationId || el.eventDate !== ea.eventDate) continue;
      if (!mismoTaxon(a, l)) continue;
      // Si los anotó la misma persona no es un doble conteo: es que vio dos.
      const obsA = ea.recordedBy ?? '';
      const obsL = el.recordedBy ?? '';
      if (obsA && obsL && obsA === obsL) continue;
      if (minutosEntre(a.occurrenceTime, l.occurrenceTime) > VENTANA_MINUTOS) continue;

      out.push({
        taxon: a.taxonId ?? a.verbatimTaxonText ?? 'especie sin identificar',
        stationId: ea.stationId,
        eventDate: ea.eventDate,
        horas: [l.occurrenceTime, a.occurrenceTime],
        observadores: [obsL || 'sin observador', obsA || 'sin observador'],
        ids: [l.id, a.id],
      });
    }
  }
  return out;
}

function mismoTaxon(a: Occurrence, b: Occurrence): boolean {
  if (a.taxonId && b.taxonId) return a.taxonId === b.taxonId;
  const ta = (a.verbatimTaxonText ?? '').trim().toLowerCase();
  const tb = (b.verbatimTaxonText ?? '').trim().toLowerCase();
  return Boolean(ta) && ta === tb;
}

function minutosEntre(a: string, b: string): number {
  const m = (t: string) => {
    const [h, min] = t.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(min) ? h * 60 + min : NaN;
  };
  const x = m(a);
  const y = m(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.abs(x - y);
}

function avisosDe(backup: BackupFile, dias: string[]): string[] {
  const avisos: string[] = [];
  const sinFotos = (backup.data.media ?? []).some(
    (m) => (m as unknown as { blobOmitted?: boolean }).blobOmitted,
  );
  if (sinFotos) {
    avisos.push('El respaldo se exportó sin las fotografías: se van a unir los registros, pero las imágenes de tu compañero no vienen.');
  }
  if (!dias.length) avisos.push('El respaldo no trae ningún muestreo.');
  return avisos;
}
