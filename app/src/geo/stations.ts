/**
 * Sugerencia de estación por GPS.
 *
 * Regla del brief §4: se SUGIERE, nunca se cambia en silencio una estación que
 * el usuario ya confirmó.
 */
import type { GeoFix, Station } from '../domain/types';
import { distanceMeters, fromUtm } from './utm';

export interface StationSuggestion {
  station: Station;
  distanceMeters: number;
  /** La precisión del GPS es mayor que la distancia: la sugerencia es débil. */
  withinAccuracy: boolean;
}

/** Completa lat/lon de las estaciones que sólo traen UTM (como la planilla). */
export function ensureLatLon(station: Station, zone: number, hemisphere: 'N' | 'S'): Station {
  if (station.latitude != null && station.longitude != null) return station;
  if (station.utmEast == null || station.utmNorth == null) return station;
  const { latitude, longitude } = fromUtm({ east: station.utmEast, north: station.utmNorth, zone, hemisphere });
  return { ...station, latitude, longitude };
}

export function suggestStations(
  fix: GeoFix, stations: Station[], maxDistanceMeters = 500, limit = 3,
): StationSuggestion[] {
  return stations
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => {
      const d = distanceMeters(fix, { latitude: s.latitude!, longitude: s.longitude! });
      return { station: s, distanceMeters: Math.round(d), withinAccuracy: d <= (fix.accuracyMeters ?? 0) };
    })
    .filter((s) => s.distanceMeters <= maxDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}
