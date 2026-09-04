/**
 * Lectura de EXIF de una fotografía JPEG.
 *
 * Las fotos de terreno tomadas con una app de marca de agua traen mucho más de
 * lo que se ve encima: coordenada, altitud, precisión, rumbo de la cámara,
 * fecha real y, con frecuencia, el código de estación escrito por el usuario en
 * el campo de descripción. Todo eso puede llenar el registro solo.
 *
 * Se lee con un parser propio de ~150 líneas en vez de una librería: en terreno
 * cada kilobyte del paquete cuenta, y sólo hacen falta doce etiquetas.
 */

export interface PhotoMetadata {
  /** 1-8 según EXIF; 3 = rotada 180°, 6 y 8 = de lado. */
  orientation: number;
  width: number | null;
  height: number | null;
  /** Momento en que se tomó la foto, según la cámara. */
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
  altitudeMeters: number | null;
  /** Error horizontal declarado por el dispositivo, en metros. */
  accuracyMeters: number | null;
  /** Rumbo de la cámara en grados; útil para saber hacia dónde se miraba. */
  headingDegrees: number | null;
  /**
   * Descripción escrita en la cámara. Muchas apps de terreno la usan para
   * anotar el código de estación antes de disparar.
   */
  description: string | null;
  make: string | null;
  model: string | null;
  software: string | null;
}

const EMPTY: PhotoMetadata = {
  orientation: 1, width: null, height: null, takenAt: null,
  latitude: null, longitude: null, altitudeMeters: null, accuracyMeters: null,
  headingDegrees: null, description: null, make: null, model: null, software: null,
};

// Etiquetas EXIF que interesan. El resto se ignora.
const TAG = {
  IMAGE_DESCRIPTION: 0x010e, MAKE: 0x010f, MODEL: 0x0110, ORIENTATION: 0x0112,
  SOFTWARE: 0x0131, DATE_TIME: 0x0132, EXIF_IFD: 0x8769, GPS_IFD: 0x8825,
  DATE_TIME_ORIGINAL: 0x9003, PIXEL_X: 0xa002, PIXEL_Y: 0xa003,
} as const;

const GPS = {
  LAT_REF: 1, LAT: 2, LON_REF: 3, LON: 4, ALT_REF: 5, ALT: 6,
  IMG_DIRECTION: 17, H_POSITIONING_ERROR: 31,
} as const;

interface Reader {
  view: DataView;
  little: boolean;
  /** Offset del inicio del TIFF, al que se refieren todos los punteros. */
  tiff: number;
}

/** Lee el EXIF de un JPEG. Devuelve valores vacíos si no lo trae o está roto. */
export function readExif(buffer: ArrayBuffer): PhotoMetadata {
  try {
    return parse(buffer);
  } catch {
    // Una foto sin EXIF legible sigue siendo una foto válida: no se pierde.
    return { ...EMPTY };
  }
}

function parse(buffer: ArrayBuffer): PhotoMetadata {
  const view = new DataView(buffer);
  if (view.getUint16(0) !== 0xffd8) return { ...EMPTY }; // no es JPEG

  // Recorre los segmentos hasta encontrar APP1 con la firma "Exif\0\0".
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && view.getUint32(offset + 4) === 0x45786966) {
      return readTiff(view, offset + 10);
    }
    if (marker === 0xda) break; // empezaron los datos de imagen
    offset += 2 + size;
  }
  return { ...EMPTY };
}

function readTiff(view: DataView, tiff: number): PhotoMetadata {
  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return { ...EMPTY };
  const r: Reader = { view, little, tiff };

  const out: PhotoMetadata = { ...EMPTY };
  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  const entries = readIfd(r, ifd0);

  out.orientation = (entries.get(TAG.ORIENTATION)?.[0] as number) ?? 1;
  out.description = asString(entries.get(TAG.IMAGE_DESCRIPTION));
  out.make = asString(entries.get(TAG.MAKE));
  out.model = asString(entries.get(TAG.MODEL));
  out.software = asString(entries.get(TAG.SOFTWARE));
  const dateTime = asString(entries.get(TAG.DATE_TIME));

  const exifPtr = entries.get(TAG.EXIF_IFD)?.[0] as number | undefined;
  if (exifPtr) {
    const exif = readIfd(r, tiff + exifPtr);
    out.width = (exif.get(TAG.PIXEL_X)?.[0] as number) ?? null;
    out.height = (exif.get(TAG.PIXEL_Y)?.[0] as number) ?? null;
    out.takenAt = toIso(asString(exif.get(TAG.DATE_TIME_ORIGINAL)) ?? dateTime);
  } else {
    out.takenAt = toIso(dateTime);
  }

  const gpsPtr = entries.get(TAG.GPS_IFD)?.[0] as number | undefined;
  if (gpsPtr) readGps(readIfd(r, tiff + gpsPtr), out);
  return out;
}

/** Devuelve las entradas de un IFD como mapa etiqueta -> valores. */
function readIfd(r: Reader, offset: number): Map<number, Array<number | string>> {
  const out = new Map<number, Array<number | string>>();
  const count = r.view.getUint16(offset, r.little);
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > r.view.byteLength) break;
    const tag = r.view.getUint16(entry, r.little);
    const type = r.view.getUint16(entry + 2, r.little);
    const n = r.view.getUint32(entry + 4, r.little);
    const size = TYPE_SIZE[type] ?? 0;
    if (!size || n > 10000) continue;

    const total = size * n;
    const at = total <= 4 ? entry + 8 : r.tiff + r.view.getUint32(entry + 8, r.little);
    if (at + total > r.view.byteLength) continue;
    out.set(tag, readValues(r, type, n, at));
  }
  return out;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readValues(r: Reader, type: number, n: number, at: number): Array<number | string> {
  const { view, little } = r;
  if (type === 2) {
    // ASCII terminado en NUL.
    let text = '';
    for (let i = 0; i < n; i++) {
      const code = view.getUint8(at + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return [text];
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = at + i * (TYPE_SIZE[type] ?? 1);
    switch (type) {
      case 1: case 7: out.push(view.getUint8(p)); break;
      case 3: out.push(view.getUint16(p, little)); break;
      case 4: out.push(view.getUint32(p, little)); break;
      case 9: out.push(view.getInt32(p, little)); break;
      case 5: out.push(ratio(view.getUint32(p, little), view.getUint32(p + 4, little))); break;
      case 10: out.push(ratio(view.getInt32(p, little), view.getInt32(p + 4, little))); break;
      default: break;
    }
  }
  return out;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

function asString(values: Array<number | string> | undefined): string | null {
  const v = values?.[0];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function readGps(gps: Map<number, Array<number | string>>, out: PhotoMetadata): void {
  const dms = (values: Array<number | string> | undefined, ref: string | null): number | null => {
    if (!values || values.length < 3) return null;
    const [d, m, sec] = values as number[];
    const value = d + m / 60 + sec / 3600;
    // S y W son negativos: sin esto, una foto de Chile aparece en Mongolia.
    return ref === 'S' || ref === 'W' ? -value : value;
  };

  out.latitude = dms(gps.get(GPS.LAT), asString(gps.get(GPS.LAT_REF)));
  out.longitude = dms(gps.get(GPS.LON), asString(gps.get(GPS.LON_REF)));

  const alt = gps.get(GPS.ALT)?.[0] as number | undefined;
  if (alt !== undefined) {
    const belowSea = (gps.get(GPS.ALT_REF)?.[0] as number) === 1;
    out.altitudeMeters = Math.round((belowSea ? -alt : alt) * 10) / 10;
  }
  const error = gps.get(GPS.H_POSITIONING_ERROR)?.[0] as number | undefined;
  if (error !== undefined) out.accuracyMeters = Math.round(error * 10) / 10;
  const heading = gps.get(GPS.IMG_DIRECTION)?.[0] as number | undefined;
  if (heading !== undefined) out.headingDegrees = Math.round(heading * 10) / 10;
}

/** "2026:08:29 17:08:31" -> ISO local. El formato EXIF usa dos puntos en la fecha. */
function toIso(value: string | null): string | null {
  if (!value) return null;
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${sec}`;
}
