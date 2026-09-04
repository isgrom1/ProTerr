/**
 * Lectura de KML y KMZ.
 *
 * El proyecto suele venir con un KMZ del cliente que ya trae todos los puntos
 * de muestreo, y cada estación con su track del transecto. Cargarlos a mano en
 * la app sería copiar 58 coordenadas: se leen del archivo y se eligen.
 *
 * Se hace con un descompresor propio (~60 líneas sobre DecompressionStream) en
 * vez de una librería: el KMZ es un zip con un solo archivo dentro y no vale la
 * pena engordar el paquete que se descarga antes de salir a terreno.
 */

export interface KmlPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
}

export interface KmlPlacemark {
  name: string;
  description: string | null;
  /** Carpeta del KML, que suele agrupar por tipo de punto. */
  folder: string | null;
  kind: 'punto' | 'linea' | 'area';
  points: KmlPoint[];
  timestamp: string | null;
}

/** Lee un KML o un KMZ indistintamente, mirando la firma del archivo. */
export async function readKmlFile(buffer: ArrayBuffer): Promise<KmlPlacemark[]> {
  const bytes = new Uint8Array(buffer);
  // 'PK' = zip, o sea KMZ.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const text = isZip ? await extractDocKml(buffer) : new TextDecoder().decode(buffer);
  return parseKml(text);
}

export function parseKml(xml: string): KmlPlacemark[] {
  const out: KmlPlacemark[] = [];
  // Se recorre a mano en vez de con DOMParser para que el módulo también
  // funcione fuera del navegador (pruebas, herramientas).
  for (const { body, folder } of eachPlacemark(xml)) {
    const name = tag(body, 'name') ?? '(sin nombre)';
    const line = tag(body, 'coordinates', /<LineString[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    const point = /<Point[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(body)?.[1];
    // El polígono del área de estudio no es una estación: se lee para poder
    // mostrarlo, pero no se ofrece como punto de muestreo.
    const area = tag(body, 'coordinates', /<Polygon[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
    const raw = point ?? line ?? area ?? tag(body, 'coordinates');
    if (!raw) continue;

    const points = parseCoordinates(raw);
    if (!points.length) continue;
    out.push({
      name: decode(name),
      description: tag(body, 'description') ? decode(tag(body, 'description')!) : null,
      folder,
      kind: point ? 'punto' : line ? 'linea' : area ? 'area' : 'linea',
      points,
      timestamp: tag(body, 'when') ?? null,
    });
  }
  return out;
}

/** Recorre los Placemark llevando la cuenta de en qué carpeta va cada uno. */
function* eachPlacemark(xml: string): Generator<{ body: string; folder: string | null }> {
  // Google Earth Pro escribe <Placemark id="ID_00000"> y <Folder id="...">:
  // exigir la etiqueta pelada dejaba el archivo entero en cero placemarks.
  const token = /<Folder[^>]*>|<\/Folder>|<Placemark[^>]*>[\s\S]*?<\/Placemark>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml)) !== null) {
    const text = m[0];
    if (text.startsWith('<Folder')) {
      // El nombre de la carpeta viene justo después de abrirla.
      const after = xml.slice(m.index, m.index + 400);
      stack.push(decode(tag(after, 'name') ?? ''));
    } else if (text === '</Folder>') {
      stack.pop();
    } else {
      yield { body: text, folder: stack[stack.length - 1] || null };
    }
  }
}

function tag(xml: string, name: string, custom?: RegExp): string | null {
  const re = custom ?? new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : null;
}

/** "lon,lat,alt lon,lat,alt ..." — el KML pone la longitud primero. */
function parseCoordinates(raw: string): KmlPoint[] {
  const out: KmlPoint[] = [];
  for (const chunk of raw.trim().split(/\s+/)) {
    const [lon, lat, alt] = chunk.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push({ latitude: lat, longitude: lon, altitude: Number.isFinite(alt) ? alt : null });
  }
  return out;
}

function decode(v: string): string {
  return v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

// ---------------------------------------------------------------------------
// Descompresión del KMZ
// ---------------------------------------------------------------------------

/** Saca el primer .kml del zip. Un KMZ siempre trae uno, normalmente doc.kml. */
async function extractDocKml(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break; // fin de las entradas locales
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const uncompressed = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const dataAt = offset + 30 + nameLen + extraLen;

    if (name.toLowerCase().endsWith('.kml')) {
      const data = bytes.subarray(dataAt, dataAt + compressed);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(await inflateRaw(data));
      throw new Error(`El KMZ usa una compresión no soportada (método ${method}).`);
    }
    // Con tamaños a cero hay un descriptor al final del dato y no se puede saltar.
    if (compressed === 0 && uncompressed === 0) break;
    offset = dataAt + compressed;
  }
  throw new Error('El archivo KMZ no contiene ningún .kml.');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!Ctor) throw new Error('Este navegador no puede descomprimir KMZ; exporta el KML sin comprimir.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new Ctor('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// De KML a estaciones
// ---------------------------------------------------------------------------

export interface StationCandidate {
  name: string;
  folder: string | null;
  latitude: number;
  longitude: number;
  altitude: number | null;
  /** Para una línea: el punto de término del transecto. */
  end: KmlPoint | null;
  /** Metros de la línea, si el placemark era un transecto dibujado. */
  lengthMeters: number | null;
  /** El KML trae dos puntos con el mismo nombre. */
  duplicateName: boolean;
}

/**
 * Convierte los placemark en candidatos a estación. Un punto da la estación;
 * una línea da además el inicio y el fin del transecto.
 */
export function toStationCandidates(placemarks: KmlPlacemark[]): StationCandidate[] {
  // Las áreas de estudio son polígonos de contexto, no estaciones.
  const puntos = placemarks.filter((p) => p.kind !== 'area');
  const seen = new Map<string, number>();
  for (const p of puntos) seen.set(p.name, (seen.get(p.name) ?? 0) + 1);

  return puntos.map((p) => {
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    return {
      name: p.name,
      folder: p.folder,
      latitude: first.latitude,
      longitude: first.longitude,
      altitude: first.altitude,
      end: p.kind === 'linea' && p.points.length > 1 ? last : null,
      lengthMeters: p.kind === 'linea' ? lineLength(p.points) : null,
      duplicateName: (seen.get(p.name) ?? 0) > 1,
    };
  });
}

function lineLength(points: KmlPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return Math.round(total);
}

function haversine(a: KmlPoint, b: KmlPoint): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
