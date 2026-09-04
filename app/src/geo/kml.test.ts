/**
 * KML sintético con la forma que tienen los archivos de proyecto: una carpeta
 * con los puntos de muestreo y, a veces, los transectos dibujados como línea.
 * No se usa ningún KMZ real: lleva las coordenadas exactas de un proyecto.
 */
import { describe, expect, it } from 'vitest';
import { parseKml, toStationCandidates } from './kml';

const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>Proyecto demo</name>
  <Style id="s"><IconStyle><scale>1.2</scale></IconStyle></Style>
  <Folder>
    <name>PM Fauna</name>
    <Placemark>
      <name>PM01</name>
      <LookAt><longitude>-71.6</longitude><latitude>-31.2</latitude></LookAt>
      <Point><coordinates>-71.627032,-31.230489,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>PM02</name>
      <description><![CDATA[Quebrada con <b>agua</b>]]></description>
      <Point><coordinates>-71.624607,-31.232676,145</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>PM02</name>
      <Point><coordinates>-71.624000,-31.232000,0</coordinates></Point>
    </Placemark>
  </Folder>
  <Folder>
    <name>Transectos</name>
    <Placemark>
      <name>TR PM01</name>
      <LineString><coordinates>
        -71.627032,-31.230489,0 -71.626000,-31.230489,0 -71.625000,-31.230489,0
      </coordinates></LineString>
    </Placemark>
  </Folder>
</Document></kml>`;

describe('lectura de KML', () => {
  const placemarks = parseKml(kml);

  it('lee los placemark y descarta estilos y cabeceras', () => {
    expect(placemarks).toHaveLength(4);
    expect(placemarks.map((p) => p.name)).toEqual(['PM01', 'PM02', 'PM02', 'TR PM01']);
  });

  it('no confunde el LookAt con la coordenada real del punto', () => {
    // El LookAt es la cámara de Google Earth, no la ubicación del punto.
    expect(placemarks[0].points[0]).toEqual({ latitude: -31.230489, longitude: -71.627032, altitude: 0 });
  });

  it('respeta el orden lon,lat del KML', () => {
    // Invertirlo pondría un punto de Chile en el océano Índico.
    expect(placemarks[1].points[0].latitude).toBeCloseTo(-31.232676, 6);
    expect(placemarks[1].points[0].longitude).toBeCloseTo(-71.624607, 6);
    expect(placemarks[1].points[0].altitude).toBe(145);
  });

  it('sabe en qué carpeta va cada placemark', () => {
    expect(placemarks.map((p) => p.folder)).toEqual(['PM Fauna', 'PM Fauna', 'PM Fauna', 'Transectos']);
  });

  it('distingue un punto de una línea', () => {
    expect(placemarks.map((p) => p.kind)).toEqual(['punto', 'punto', 'punto', 'linea']);
    expect(placemarks[3].points).toHaveLength(3);
  });

  it('limpia el CDATA y las entidades de la descripción', () => {
    expect(placemarks[1].description).toBe('Quebrada con <b>agua</b>');
  });
});

describe('candidatos a estación', () => {
  const candidates = toStationCandidates(parseKml(kml));

  it('marca los nombres repetidos en vez de perder uno', () => {
    // Un KML de proyecto real suele traer algún punto duplicado.
    const pm02 = candidates.filter((c) => c.name === 'PM02');
    expect(pm02).toHaveLength(2);
    expect(pm02.every((c) => c.duplicateName)).toBe(true);
    expect(candidates.find((c) => c.name === 'PM01')?.duplicateName).toBe(false);
  });

  it('de una línea saca inicio, fin y longitud del transecto', () => {
    const tr = candidates.find((c) => c.name === 'TR PM01')!;
    expect(tr.end).not.toBeNull();
    expect(tr.end!.longitude).toBeCloseTo(-71.625, 5);
    expect(tr.lengthMeters).toBeGreaterThan(150);
    expect(tr.lengthMeters).toBeLessThan(250);
  });

  it('un punto no tiene fin ni longitud', () => {
    const pm01 = candidates.find((c) => c.name === 'PM01')!;
    expect(pm01.end).toBeNull();
    expect(pm01.lengthMeters).toBeNull();
  });
});
