/**
 * Pasar la jornada de una vez desde las fotografías.
 *
 * El trabajo lento no es el terreno: es llegar a la casa, ordenar las fotos por
 * día, después por punto de muestreo, y recién ahí transcribir la planilla.
 * Como cada foto ya trae en su EXIF dónde y cuándo se tomó, ese ordenamiento
 * lo puede hacer la app: se seleccionan todas las fotos del día y quedan
 * agrupadas por estación, con la orientación separada de las especies.
 *
 * Todo lo que este módulo decide es una PROPUESTA. Nada se guarda sin que una
 * persona lo revise, porque la evidencia que se cruza —etiqueta y GPS— puede
 * fallar de las dos maneras.
 */
import type { GeoFix, Station } from '../domain/types';
import { distanceMeters } from '../geo/utm';
import { readExif, type PhotoMetadata } from './exif';

/**
 * Verificación de la etiqueta escrita en la cámara contra el GPS de la foto.
 *
 * Es un error real y frecuente: la app de cámara conserva la etiqueta anterior,
 * así que las primeras fotos de una estación salen con el código de la que
 * acabas de dejar. Sin cruzarlo con el GPS, ese error viaja hasta el informe.
 */
export type LabelCheck =
  | { status: 'sin-etiqueta' }
  /** Hay etiqueta pero la foto no trae GPS: no se puede verificar. */
  | { status: 'sin-verificar'; label: string }
  /** La etiqueta no corresponde a ninguna estación del proyecto. */
  | { status: 'desconocida'; label: string }
  | { status: 'coincide'; label: string; distanceMeters: number }
  | {
      status: 'desfasada';
      label: string;
      labelDistanceMeters: number;
      nearest: Station;
      nearestDistanceMeters: number;
    };

/** Distancia sobre la cual se considera que la foto no se tomó en esa estación. */
const LABEL_TOLERANCE_METERS = 200;

export function checkLabel(
  metadata: PhotoMetadata, fix: GeoFix | null, stations: Station[],
): LabelCheck {
  const label = (metadata.description ?? '').trim();
  if (!label) return { status: 'sin-etiqueta' };

  const labelled = stations.find((s) => s.stationCode.toLowerCase() === label.toLowerCase());
  if (!labelled) return { status: 'desconocida', label };
  if (!fix) return { status: 'sin-verificar', label };

  const here = { latitude: fix.latitude, longitude: fix.longitude };
  const toLabel = labelled.latitude != null && labelled.longitude != null
    ? Math.round(distanceMeters(here, { latitude: labelled.latitude, longitude: labelled.longitude }))
    : null;
  if (toLabel === null) return { status: 'sin-verificar', label };

  const closest = nearestStation(fix, stations);
  if (toLabel <= LABEL_TOLERANCE_METERS || !closest || closest.station.id === labelled.id) {
    return { status: 'coincide', label, distanceMeters: toLabel };
  }
  return {
    status: 'desfasada',
    label,
    labelDistanceMeters: toLabel,
    nearest: closest.station,
    nearestDistanceMeters: closest.distance,
  };
}

export function nearestStation(
  fix: GeoFix, stations: Station[],
): { station: Station; distance: number } | null {
  let best: { station: Station; distance: number } | null = null;
  for (const s of stations) {
    if (s.latitude == null || s.longitude == null) continue;
    const d = Math.round(distanceMeters(
      { latitude: fix.latitude, longitude: fix.longitude },
      { latitude: s.latitude, longitude: s.longitude },
    ));
    if (!best || d < best.distance) best = { station: s, distance: d };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Clasificación de la jornada
// ---------------------------------------------------------------------------

export type PhotoRole = 'orientacion' | 'especie' | 'sin-clasificar';
export type Cardinal = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SO' | 'O' | 'NO';

export interface JourneyPhoto {
  fileName: string;
  metadata: PhotoMetadata;
  fix: GeoFix | null;
  takenAt: string | null;
  /** Estación asignada por el GPS de la foto, no por su etiqueta. */
  station: Station | null;
  distanceMeters: number | null;
  labelCheck: LabelCheck;
  /** Propuesta, editable: la app no puede saber con certeza qué retrata la foto. */
  role: PhotoRole;
  cardinal: Cardinal | null;
}

export interface JourneyGroup {
  date: string;
  station: Station | null;
  photos: JourneyPhoto[];
}

/** Rumbo de la cámara a punto cardinal. 197° es Sur. */
export function cardinalOf(heading: number | null): Cardinal | null {
  if (heading === null || !Number.isFinite(heading)) return null;
  const names: Cardinal[] = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return names[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
}

export interface JourneyOptions {
  /** Cuántas fotos de orientación se toman por estación. */
  orientationShots?: number;
  /** Radio para dar por buena la asignación a una estación. */
  maxStationDistanceMeters?: number;
}

const DEFAULTS: Required<JourneyOptions> = { orientationShots: 4, maxStationDistanceMeters: 300 };

export interface JourneyInput {
  fileName: string;
  buffer: ArrayBuffer;
}

export function analyzeJourney(
  files: JourneyInput[], stations: Station[], options: JourneyOptions = {},
): JourneyGroup[] {
  const o = { ...DEFAULTS, ...options };

  const photos: JourneyPhoto[] = files.map(({ fileName, buffer }) => {
    const metadata = readExif(buffer);
    const fix = fixFrom(metadata);
    const closest = fix ? nearestStation(fix, stations) : null;
    const withinRange = closest && closest.distance <= o.maxStationDistanceMeters;
    return {
      fileName, metadata, fix,
      takenAt: metadata.takenAt,
      station: withinRange ? closest.station : null,
      distanceMeters: closest?.distance ?? null,
      labelCheck: checkLabel(metadata, fix, stations),
      role: 'sin-clasificar',
      cardinal: cardinalOf(metadata.headingDegrees),
    };
  });

  const groups = new Map<string, JourneyGroup>();
  for (const photo of photos) {
    const date = photo.takenAt?.slice(0, 10) ?? 'sin fecha';
    const key = `${date}|${photo.station?.id ?? 'sin-estacion'}`;
    const group = groups.get(key) ?? { date, station: photo.station, photos: [] };
    group.photos.push(photo);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.photos.sort(byTime);
    proposeRoles(group.photos, o.orientationShots);
  }

  return [...groups.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
    || (a.station?.stationCode ?? '~').localeCompare(b.station?.stationCode ?? '~'));
}

const byTime = (a: JourneyPhoto, b: JourneyPhoto): number =>
  (a.takenAt ?? '').localeCompare(b.takenAt ?? '') || a.fileName.localeCompare(b.fileName);

/**
 * Propone qué fotos son de orientación.
 *
 * En cada punto se toman primero las fotos de orientación —una por cada rumbo
 * que pida la consultora— y después las de las especies. Se usa esa costumbre:
 * las primeras tomas cuyos rumbos apuntan a cuadrantes distintos son la
 * orientación; el resto, especies. Es una propuesta, no un veredicto: sin
 * rumbo en el EXIF no se adivina nada.
 */
function proposeRoles(photos: JourneyPhoto[], shots: number): void {
  const seen = new Set<Cardinal>();
  let assigned = 0;
  for (const photo of photos) {
    if (assigned >= shots || !photo.cardinal || seen.has(photo.cardinal)) break;
    seen.add(photo.cardinal);
    photo.role = 'orientacion';
    assigned++;
  }
  for (const photo of photos) {
    if (photo.role === 'sin-clasificar') photo.role = 'especie';
  }
  // Con menos rumbos distintos que tomas esperadas, la costumbre no se cumplió:
  // mejor no clasificar que clasificar mal.
  if (assigned > 0 && assigned < Math.min(shots, photos.length)) {
    for (const photo of photos) photo.role = 'sin-clasificar';
  }
}

function fixFrom(meta: PhotoMetadata): GeoFix | null {
  if (meta.latitude === null || meta.longitude === null) return null;
  return {
    latitude: meta.latitude, longitude: meta.longitude,
    accuracyMeters: meta.accuracyMeters, altitudeMeters: meta.altitudeMeters,
    fixedAt: meta.takenAt ?? new Date().toISOString(),
  };
}

export interface JourneySummary {
  days: number;
  stations: number;
  photos: number;
  withoutGps: number;
  unassigned: number;
  mislabelled: number;
}

export function summarize(groups: JourneyGroup[]): JourneySummary {
  const photos = groups.flatMap((g) => g.photos);
  return {
    days: new Set(groups.map((g) => g.date)).size,
    stations: new Set(groups.map((g) => g.station?.id).filter(Boolean)).size,
    photos: photos.length,
    withoutGps: photos.filter((p) => !p.fix).length,
    unassigned: photos.filter((p) => !p.station).length,
    mislabelled: photos.filter((p) => p.labelCheck.status === 'desfasada').length,
  };
}
