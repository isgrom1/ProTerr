/**
 * Conversión WGS84 <-> UTM (Transverse Mercator).
 *
 * La planilla trabaja sólo en UTM y sin declarar el huso; la app guarda
 * siempre lat/lon (Darwin Core lo exige) y deriva UTM para la exportación,
 * dejando huso y datum explícitos en el registro.
 */

const A = 6378137.0; // semieje mayor WGS84
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

export interface UtmCoordinate {
  east: number;
  north: number;
  zone: number;
  hemisphere: 'N' | 'S';
}

export function zoneForLongitude(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1;
}

export function toUtm(latitude: number, longitude: number, forceZone?: number): UtmCoordinate {
  const zone = forceZone ?? zoneForLongitude(longitude);
  const lat = (latitude * Math.PI) / 180;
  const lon = (longitude * Math.PI) / 180;
  const lonOrigin = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;

  const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  const T = Math.tan(lat) ** 2;
  const C = EP2 * Math.cos(lat) ** 2;
  const Adist = Math.cos(lat) * (lon - lonOrigin);

  const M = A * (
    (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256) * lat
    - ((3 * E2) / 8 + (3 * E2 ** 2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat)
    + ((15 * E2 ** 2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * lat)
  );

  const east = K0 * N * (
    Adist + ((1 - T + C) * Adist ** 3) / 6
    + ((5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * Adist ** 5) / 120
  ) + 500000;

  let north = K0 * (M + N * Math.tan(lat) * (
    Adist ** 2 / 2 + ((5 - T + 9 * C + 4 * C ** 2) * Adist ** 4) / 24
    + ((61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * Adist ** 6) / 720
  ));
  const hemisphere: 'N' | 'S' = latitude < 0 ? 'S' : 'N';
  if (hemisphere === 'S') north += 10000000; // falso norte

  return { east: round(east), north: round(north), zone, hemisphere };
}

export function fromUtm(utm: UtmCoordinate): { latitude: number; longitude: number } {
  const x = utm.east - 500000;
  const y = utm.hemisphere === 'S' ? utm.north - 10000000 : utm.north;
  const lonOrigin = ((utm.zone - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const M = y / K0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));

  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = A / Math.sqrt(1 - E2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = EP2 * Math.cos(phi1) ** 2;
  const R1 = (A * (1 - E2)) / (1 - E2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * K0);

  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * (
    D ** 2 / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * EP2 - 3 * C1 ** 2) * D ** 6) / 720
  );
  const lon = lonOrigin + (
    D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * EP2 + 24 * T1 ** 2) * D ** 5) / 120
  ) / Math.cos(phi1);

  return { latitude: (lat * 180) / Math.PI, longitude: (lon * 180) / Math.PI };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Distancia entre dos puntos por la fórmula de haversine, en metros. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
