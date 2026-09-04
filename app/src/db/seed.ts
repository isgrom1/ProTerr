/**
 * Carga inicial de catálogos ("descarga antes de salir a terreno", brief §13).
 *
 * Las semillas vienen de tools/extraer_catalogos.py, que las genera desde la
 * planilla. La carga es idempotente: se puede repetir para actualizar sin
 * duplicar ni tocar los registros de terreno.
 */
import type { Campaign, MethodCode, Project, Station, StationSite, Taxon } from '../domain/types';
import { fromUtm } from '../geo/utm';
import { NATIVE_TEMPLATE } from '../export/template';
import { BUILTIN_PROFILES } from '../validation/profiles';
import { db } from './db';
import { locationIdFor, uuid } from './ids';

/** Huso y datum del proyecto de demostración. Cada proyecto define el suyo. */
const SEED_UTM_ZONE = 19;
const SEED_HEMISPHERE: 'N' | 'S' = 'S';
const SEED_DATUM = 'WGS84';

interface RawStation {
  id: string; stationCode: string; finalStationCode: string;
  project: string | null; region: string | null; season: string | null;
  habitat: string | null; slopeAspect: string | null;
  utmEast: number | null; utmNorth: number | null;
  utmStartEast: number | null; utmStartNorth: number | null;
  utmEndEast: number | null; utmEndNorth: number | null;
  methods: Record<string, boolean>;
  recordedBy: string | null; identifiedBy: string | null;
  playbackBirdPoints: RawSite[]; playbackAmphibianPoints: RawSite[];
  cameraTraps: RawSite[]; shermanLines: RawSite[];
}
interface RawSite {
  label?: string | null; name?: string | null; installedOn?: string | null;
  utmEast?: string | number | null; utmNorth?: string | number | null;
  utmStartEast?: string | number | null; utmStartNorth?: string | number | null;
  utmEndEast?: string | number | null; utmEndNorth?: string | number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function toSites(raw: RawStation): StationSite[] {
  const build = (items: RawSite[], kind: StationSite['kind']): StationSite[] =>
    items.map((s) => ({
      id: uuid(),
      kind,
      name: s.name ?? s.label ?? kind,
      label: s.label ?? null,
      installedOn: s.installedOn ?? null,
      utmEast: num(s.utmEast ?? s.utmStartEast),
      utmNorth: num(s.utmNorth ?? s.utmStartNorth),
      utmEndEast: num(s.utmEndEast),
      utmEndNorth: num(s.utmEndNorth),
    }));
  return [
    ...build(raw.playbackBirdPoints, 'playback_aves'),
    ...build(raw.playbackAmphibianPoints, 'playback_anfibios'),
    ...build(raw.cameraTraps, 'camara_trampa'),
    ...build(raw.shermanLines, 'trampa_sherman'),
  ];
}

export interface SeedSummary {
  projects: number; campaigns: number; stations: number; taxa: number; vocabularies: number;
}

export async function seedCatalogs(): Promise<SeedSummary> {
  // Las semillas se cargan sólo la primera vez (o al actualizar catálogos):
  // después la app lee de IndexedDB, así el arranque en terreno no paga el
  // costo de interpretar ~1 MB de JSON en cada apertura.
  const [{ default: stationsSeed }, { default: taxaSeed }, { default: vocabulariesSeed }] = await Promise.all([
    import('../data/seed/stations.json'),
    import('../data/seed/taxa.json'),
    import('../data/seed/vocabularies.json'),
  ]);
  const raws = stationsSeed as unknown as RawStation[];

  // Los datos de arranque traen un proyecto de demostración; el modelo admite
  // varios desde el inicio.
  const projectNames = [...new Set(raws.map((s) => s.project).filter(Boolean))] as string[];
  const projects: Project[] = projectNames.map((name) => ({
    id: `proj_${name.toLowerCase().replace(/\s+/g, '-')}`,
    code: name,
    name,
    client: null,
    region: raws.find((s) => s.project === name)?.region ?? null,
    utmZone: SEED_UTM_ZONE,
    utmHemisphere: SEED_HEMISPHERE,
    geodeticDatum: SEED_DATUM,
    requirementProfileId: 'linea-base-fauna',
    methods: ['transecto', 'playback_aves', 'playback_anfibios', 'camara_trampa', 'trampa_sherman', 'songmeter', 'transito_aereo', 'otro'],
  }));

  const campaigns: Campaign[] = [];
  for (const p of projects) {
    const seasons = [...new Set(raws.filter((s) => s.project === p.code).map((s) => s.season).filter(Boolean))] as string[];
    for (const season of seasons) {
      campaigns.push({ id: `camp_${p.id}_${season.toLowerCase()}`, projectId: p.id, name: `${season} ${p.code}`, season });
    }
  }

  const stations: Station[] = raws.map((raw) => {
    const project = projects.find((p) => p.code === raw.project);
    const projectId = project?.id ?? projects[0]?.id ?? 'proj_desconocido';
    const ll = raw.utmEast != null && raw.utmNorth != null
      ? fromUtm({ east: raw.utmEast, north: raw.utmNorth, zone: SEED_UTM_ZONE, hemisphere: SEED_HEMISPHERE })
      : null;
    const methods = (Object.entries(raw.methods).filter(([, on]) => on).map(([m]) => m) as MethodCode[]);
    return {
      id: raw.id,
      projectId,
      stationCode: raw.stationCode,
      finalStationCode: raw.finalStationCode,
      darwinCoreLocationId: locationIdFor(raw.project ?? 'proterr', raw.stationCode),
      region: raw.region,
      season: raw.season,
      habitat: raw.habitat,
      slopeAspect: raw.slopeAspect,
      utmEast: raw.utmEast, utmNorth: raw.utmNorth,
      utmStartEast: raw.utmStartEast, utmStartNorth: raw.utmStartNorth,
      utmEndEast: raw.utmEndEast, utmEndNorth: raw.utmEndNorth,
      latitude: ll?.latitude ?? null,
      longitude: ll?.longitude ?? null,
      methods: methods.length ? methods : ['transecto'],
      sites: toSites(raw),
      recordedBy: raw.recordedBy,
      identifiedBy: raw.identifiedBy,
    };
  });

  const taxa = taxaSeed as unknown as Taxon[];
  const vocabularies = Object.entries(vocabulariesSeed as Record<string, string[]>)
    .map(([name, values]) => ({ name, values }));

  await db.transaction('rw', [db.projects, db.campaigns, db.stations, db.taxa, db.vocabularies, db.profiles, db.templates], async () => {
    await db.projects.bulkPut(projects);
    await db.campaigns.bulkPut(campaigns);
    await db.stations.bulkPut(stations);
    await db.taxa.bulkPut(taxa);
    await db.vocabularies.bulkPut(vocabularies);
    await db.profiles.bulkPut(BUILTIN_PROFILES);
    // La plantilla nativa se repone siempre; las cargadas por el usuario no se tocan.
    await db.templates.put(NATIVE_TEMPLATE);
  });

  return {
    projects: projects.length, campaigns: campaigns.length,
    stations: stations.length, taxa: taxa.length, vocabularies: vocabularies.length,
  };
}

/** ¿Ya hay catálogos descargados? Determina si la app puede operar offline. */
export async function catalogsReady(): Promise<boolean> {
  return (await db.taxa.count()) > 0 && (await db.stations.count()) > 0;
}
