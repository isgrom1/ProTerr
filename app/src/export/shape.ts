/**
 * Aplanado: del modelo normalizado a una fila con todo resuelto.
 *
 * Aquí es donde se rehacen los INDEX/MATCH de la planilla, pero en el momento
 * de exportar y contra el catálogo vigente. Por eso corregir una especie en el
 * catálogo corrige todas las filas históricas, en vez de dejar #N/A congelado.
 */
import type {
  Campaign, MeasurementOrFact, Occurrence, Project, SamplingEvent, Station, StationSite, Taxon,
} from '../domain/types';
import { toUtm } from '../geo/utm';

export interface FlatRecord {
  occurrence: Occurrence;
  event: SamplingEvent;
  station: Station | null;
  /** Punto de playback, cámara o línea de trampeo dentro de la estación. */
  site: StationSite | null;
  project: Project | null;
  campaign: Campaign | null;
  taxon: Taxon | null;
  facts: MeasurementOrFact[];
}

export interface Catalogs {
  projects: Map<string, Project>;
  campaigns: Map<string, Campaign>;
  stations: Map<string, Station>;
  taxa: Map<string, Taxon>;
}

export function flatten(
  occurrences: Occurrence[],
  events: Map<string, SamplingEvent>,
  catalogs: Catalogs,
  facts: MeasurementOrFact[] = [],
): FlatRecord[] {
  const factsByOcc = new Map<string, MeasurementOrFact[]>();
  for (const f of facts) {
    const list = factsByOcc.get(f.occurrenceId) ?? [];
    list.push(f);
    factsByOcc.set(f.occurrenceId, list);
  }
  const out: FlatRecord[] = [];
  for (const occ of occurrences) {
    if (occ.deletedAt) continue;
    const event = events.get(occ.eventId);
    if (!event) continue;
    const station = catalogs.stations.get(event.stationId) ?? null;
    out.push({
      occurrence: occ,
      event,
      station,
      site: station?.sites.find((s) => s.id === event.siteId) ?? null,
      project: catalogs.projects.get(event.projectId) ?? null,
      campaign: catalogs.campaigns.get(event.campaignId) ?? null,
      taxon: occ.taxonId ? catalogs.taxa.get(occ.taxonId) ?? null : null,
      facts: factsByOcc.get(occ.id) ?? [],
    });
  }
  return out.sort((a, b) =>
    a.event.eventDate.localeCompare(b.event.eventDate)
    || a.occurrence.occurrenceTime.localeCompare(b.occurrence.occurrenceTime)
    || a.occurrence.createdAt.localeCompare(b.occurrence.createdAt));
}

/** Coordenadas del avistamiento si existen; si no, las de la estación. */
export function coordinatesOf(r: FlatRecord): {
  latitude: number | null; longitude: number | null;
  utmEast: number | null; utmNorth: number | null;
  zone: number | null; datum: string; source: 'avistamiento' | 'estacion' | 'ninguna';
} {
  const zone = r.project?.utmZone ?? null;
  const datum = r.project?.geodeticDatum ?? 'WGS84';
  const fix = r.occurrence.occurrenceFix;
  if (fix) {
    const utm = zone ? toUtm(fix.latitude, fix.longitude, zone) : null;
    return {
      latitude: fix.latitude, longitude: fix.longitude,
      utmEast: fix.utmEast ?? utm?.east ?? null, utmNorth: fix.utmNorth ?? utm?.north ?? null,
      zone, datum, source: 'avistamiento',
    };
  }
  if (r.station) {
    return {
      latitude: r.station.latitude ?? null, longitude: r.station.longitude ?? null,
      utmEast: r.station.utmEast ?? null, utmNorth: r.station.utmNorth ?? null,
      zone, datum, source: 'estacion',
    };
  }
  return { latitude: null, longitude: null, utmEast: null, utmNorth: null, zone, datum, source: 'ninguna' };
}
