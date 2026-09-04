/**
 * Preparación de una fotografía para guardarla en el dispositivo.
 *
 * Dos cosas que en terreno importan de verdad:
 *
 *  - **Comprimir.** Una foto de teléfono pesa 5-6 MB. Cien fotos de jornada son
 *    600 MB en IndexedDB: el respaldo se vuelve inmanejable y la sincronización
 *    inviable con la señal que hay en un cerro. A 1600 px de lado largo la foto
 *    sigue sirviendo para verificar una identificación y pesa ~40 veces menos.
 *
 *  - **Aplicar la orientación.** El EXIF dice cómo estaba el teléfono; si no se
 *    aplica, la foto se ve de lado o al revés. Al recomprimir se pierde el EXIF,
 *    así que la rotación hay que hornearla en los píxeles.
 *
 * Los metadatos se leen ANTES de comprimir y se guardan aparte en el registro,
 * que es donde sirven.
 */
import type { GeoFix } from '../domain/types';
import { readExif, type PhotoMetadata } from './exif';

export interface PreparedPhoto {
  blob: Blob;
  metadata: PhotoMetadata;
  originalBytes: number;
  bytes: number;
  /** Posición de la foto, si el EXIF la traía. */
  fix: GeoFix | null;
}

export interface PhotoOptions {
  /** Lado largo máximo, en píxeles. */
  maxSide?: number;
  quality?: number;
}

const DEFAULTS: Required<PhotoOptions> = { maxSide: 1600, quality: 0.82 };

/** Transformaciones de canvas por valor de orientación EXIF (1-8). */
function applyOrientation(
  ctx: CanvasRenderingContext2D, orientation: number, w: number, h: number,
): void {
  switch (orientation) {
    case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
    case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
    case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
    case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
    case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
    case 7: ctx.transform(0, -1, -1, 0, h, w); break;
    case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    default: break;
  }
}

const SWAPS_AXES = new Set([5, 6, 7, 8]);

export async function preparePhoto(file: File | Blob, options: PhotoOptions = {}): Promise<PreparedPhoto> {
  const o = { ...DEFAULTS, ...options };
  const buffer = await file.arrayBuffer();
  const metadata = readExif(buffer);
  const fix = fixFrom(metadata);

  let blob: Blob = file;
  try {
    blob = await compress(file, metadata.orientation, o);
  } catch {
    // Si el navegador no puede decodificar la imagen, se guarda tal cual:
    // perder la foto sería mucho peor que guardarla pesada.
  }
  return { blob, metadata, fix, originalBytes: file.size, bytes: blob.size };
}

async function compress(file: File | Blob, orientation: number, o: Required<PhotoOptions>): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const swap = SWAPS_AXES.has(orientation);
    const srcW = swap ? bitmap.height : bitmap.width;
    const srcH = swap ? bitmap.width : bitmap.height;
    const scale = Math.min(1, o.maxSide / Math.max(srcW, srcH));
    const width = Math.round(srcW * scale);
    const height = Math.round(srcH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('sin canvas 2d');

    ctx.save();
    ctx.scale(scale, scale);
    applyOrientation(ctx, orientation, swap ? srcH : srcW, swap ? srcW : srcH);
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', o.quality));
    if (!out) throw new Error('no se pudo codificar');
    // Si comprimir no ganó nada (foto ya pequeña), se conserva la original.
    return out.size < file.size ? out : file;
  } finally {
    bitmap.close();
  }
}

function fixFrom(meta: PhotoMetadata): GeoFix | null {
  if (meta.latitude === null || meta.longitude === null) return null;
  return {
    latitude: meta.latitude,
    longitude: meta.longitude,
    accuracyMeters: meta.accuracyMeters,
    altitudeMeters: meta.altitudeMeters,
    fixedAt: meta.takenAt ?? new Date().toISOString(),
  };
}

/**
 * Lo que la foto puede aportar al registro. La app lo PROPONE; el usuario
 * confirma. Una estación escrita en la cámara no puede cambiar en silencio la
 * que él eligió en pantalla.
 */
export interface PhotoSuggestion {
  stationCode: string | null;
  time: string | null;
  date: string | null;
  fix: GeoFix | null;
  headingDegrees: number | null;
}

export function suggestionFrom(prepared: PreparedPhoto, knownStationCodes: string[] = []): PhotoSuggestion {
  const { metadata: m } = prepared;
  const description = (m.description ?? '').trim();
  // Se acepta como estación sólo si coincide con una del catálogo: la
  // descripción puede traer cualquier cosa.
  const stationCode = knownStationCodes.find((c) => c.toLowerCase() === description.toLowerCase()) ?? null;
  return {
    stationCode,
    date: m.takenAt ? m.takenAt.slice(0, 10) : null,
    time: m.takenAt ? m.takenAt.slice(11, 16) : null,
    fix: prepared.fix,
    headingDegrees: m.headingDegrees,
  };
}
