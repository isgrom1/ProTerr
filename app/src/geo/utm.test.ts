import { describe, expect, it } from 'vitest';
import stationsSeed from '../data/seed/stations.json';
import { distanceMeters, fromUtm, toUtm, zoneForLongitude } from './utm';

describe('conversión UTM', () => {
  it('ida y vuelta conserva la posición dentro de 0,5 m', () => {
    const points = [
      { latitude: -31.2465, longitude: -71.5312 }, // Coquimbo, huso 19S
      { latitude: -41.4693, longitude: -72.9424 },
      { latitude: -53.1626, longitude: -70.9081 },
    ];
    for (const p of points) {
      const back = fromUtm(toUtm(p.latitude, p.longitude));
      expect(distanceMeters(p, back)).toBeLessThan(0.5);
    }
  });

  it('las estaciones sembradas caen en el huso 19S sobre Chile', () => {
    const first = (stationsSeed as Array<{ utmEast: number; utmNorth: number }>)[0];
    const ll = fromUtm({ east: first.utmEast, north: first.utmNorth, zone: 19, hemisphere: 'S' });
    expect(ll.latitude).toBeGreaterThan(-56);
    expect(ll.latitude).toBeLessThan(-17);
    expect(ll.longitude).toBeGreaterThan(-76);
    expect(ll.longitude).toBeLessThan(-66);
    expect(zoneForLongitude(ll.longitude)).toBe(19);
  });
});
