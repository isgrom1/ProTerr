/**
 * Estado de la aplicación. Deliberadamente delgado: la verdad vive en
 * IndexedDB y el store sólo cachea lo que la pantalla necesita.
 */
import { create } from 'zustand';
import { db } from '../db/db';
import { getOrCreateEvent } from '../db/repository';
import { locationIdFor } from '../db/ids';
import { uuid } from '../db/ids';
import { catalogsReady, seedCatalogs } from '../db/seed';
import {
  appendTrack, applyEventPatch, commitDraft, deleteOccurrence, duplicateOccurrence,
  endEffort, endTrack, markWaypoint, setReviewState, startTrack, updateOccurrence,
  type Session,
} from '../db/repository';
import { summarizeEffort, type EffortSummary } from '../effort/session';
import { analyzeQuality, type QualitySummary } from '../quality/report';
import { emptyDraft, type ObservationDraft } from '../domain/draft';
import type {
  Campaign, EnvironmentalConditions, GeoFix, MethodCode, Occurrence, Project,
  ReviewState, SamplingEvent, Station, Taxon,
} from '../domain/types';
import { NATIVE_TEMPLATE, type ExportTemplate } from '../export/template';
import { suggestStations, type StationSuggestion } from '../geo/stations';
import { toUtm } from '../geo/utm';
import { parseCommand, type VoiceCommand } from '../nlp/commands';
import { parseUtterance, type ParsedObservation } from '../nlp/parser';
import { TaxonIndex } from '../nlp/taxonIndex';
import { syncOutbox, syncStatus, type SyncStatus, type SyncTransport } from '../sync/engine';
import { validateDraft, whatIsMissing, type ValidationResult } from '../validation/engine';
import { DEFAULT_PROFILE, type RequirementProfile } from '../validation/profiles';

export type Screen = 'terreno' | 'confirmar' | 'registros' | 'jornada' | 'resumen' | 'ajustes';

export interface RecordRow {
  occurrence: Occurrence;
  event: SamplingEvent;
  taxon: Taxon | null;
  station: Station | null;
}

interface State {
  ready: boolean;
  screen: Screen;
  session: Session;
  banner: { text: string; tone: 'ok' | 'warn' | 'error' } | null;

  projects: Project[];
  campaigns: Campaign[];
  stations: Station[];
  taxonIndex: TaxonIndex | null;
  vocabularies: Record<string, string[]>;
  profile: RequirementProfile;
  /** Plantillas de exportación disponibles y la elegida para exportar. */
  templates: ExportTemplate[];
  templateId: string;

  projectId: string | null;
  campaignId: string | null;
  stationId: string | null;
  method: MethodCode | null;
  /** La estación la confirmó el usuario: el GPS ya no la cambia solo (§4). */
  stationConfirmed: boolean;

  fix: GeoFix | null;
  gpsError: string | null;
  suggestions: StationSuggestion[];

  drafts: ObservationDraft[];
  validations: Record<string, ValidationResult>;
  lastUtterance: string | null;

  records: RecordRow[];
  sync: SyncStatus;
  /** Último lote guardado: lo que "deshacer" y "otro igual" toman como referencia. */
  lastSaved: { batchId: string; occurrenceIds: string[]; at: number } | null;
  /** Muestreo abierto: el que acumula esfuerzo mientras se camina. */
  activeEvent: SamplingEvent | null;
  effort: EffortSummary | null;
  /** Vigilancia del recorrido GPS; null cuando no hay muestreo abierto. */
  trackWatchId: number | null;
  quality: QualitySummary | null;

  init(): Promise<void>;
  setScreen(s: Screen): void;
  notify(text: string, tone?: 'ok' | 'warn' | 'error'): void;
  select(patch: { projectId?: string; campaignId?: string; stationId?: string; method?: MethodCode }): void;
  requestGps(): Promise<void>;
  confirmSuggestedStation(stationId: string): void;

  /** Punto de entrada del dictado: comando o registro. */
  handleUtterance(text: string): Promise<VoiceCommand | null>;
  startManualDraft(): void;
  patchDraft(draftId: string, patch: Partial<ObservationDraft>): void;
  removeDraft(draftId: string): void;
  saveAll(): Promise<void>;
  missingFor(draftId: string): string[];

  refreshRecords(): Promise<void>;
  editRecord(id: string, patch: Partial<Occurrence>): Promise<void>;
  removeRecord(id: string): Promise<void>;
  duplicateRecord(id: string): Promise<void>;
  reviewRecord(id: string, state: ReviewState): Promise<void>;
  /** Deshace el último guardado completo, mientras siga siendo reciente. */
  undoLastSave(): Promise<void>;
  /** Repite el último registro con la hora de ahora ("otro igual"). */
  repeatLast(times?: number): Promise<void>;
  /** Aplica una corrección hablada al último registro ("no, eran dos"). */
  correctLast(text: string): Promise<void>;
  runSync(transport: SyncTransport): Promise<void>;

  /** Cierra el muestreo abierto y congela su esfuerzo. */
  closeEffort(extra?: { distanceMeters?: number; trapCount?: number; trapNights?: number; noDetections?: boolean }): Promise<void>;
  /** Recorrido explícito: nada se graba sin que el usuario lo pida. */
  beginTrack(): Promise<void>;
  finishTrack(): Promise<void>;
  addWaypoint(label: string): Promise<void>;
  setConditions(conditions: EnvironmentalConditions): Promise<void>;
  /** Deja constancia de que se muestreó la estación sin detectar fauna. */
  recordNoDetections(): Promise<void>;
  refreshQuality(): Promise<void>;

  /** Plantillas de exportación por consultora. */
  /** Carga estaciones desde el KML/KMZ del proyecto. */
  importStations(candidates: Array<{ name: string; latitude: number; longitude: number;
    end?: { latitude: number; longitude: number } | null }>, prefix?: string): Promise<number>;

  selectTemplate(id: string): void;
  saveTemplate(template: ExportTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
}

const DEVICE_KEY = 'proterr.deviceId';

/** Etiquetas legibles para confirmar en voz alta qué se corrigió. */
const LABEL: Record<string, string> = {
  individualCount: 'abundancia', sex: 'sexo', lifeStage: 'edad',
  behaviour: 'conducta', recordType: 'tipo de registro', organismCondition: 'estado',
};

function deviceId(): string {
  const stored = globalThis.localStorage?.getItem(DEVICE_KEY);
  if (stored) return stored;
  const id = uuid();
  globalThis.localStorage?.setItem(DEVICE_KEY, id);
  return id;
}

/** Convierte una observación interpretada en un borrador editable. */
function draftFrom(
  obs: ParsedObservation,
  base: { projectId: string | null; campaignId: string | null; stationId: string | null; method: MethodCode | null; recordedBy: string | null },
  utterance: string,
): ObservationDraft {
  const now = new Date();
  return {
    ...emptyDraft(uuid(), 'voz'),
    ...base,
    eventDate: now.toISOString().slice(0, 10),
    eventTime: now.toTimeString().slice(0, 5),
    taxonId: obs.taxonIds.length === 1 ? obs.taxonIds[0] : null,
    taxonCandidates: obs.taxonIds.length > 1 ? obs.taxonIds : [],
    verbatimTaxonText: obs.verbatimTaxonText,
    taxonCorrectedFrom: obs.taxonCorrectedFrom,
    recordType: obs.recordType,
    recordTypeInferred: obs.recordTypeInferred,
    individualCount: obs.individualCount,
    countInferred: obs.countInferred,
    sex: obs.sex, sexScope: obs.sexScope,
    lifeStage: obs.lifeStage, lifeStageScope: obs.lifeStageScope,
    organismCondition: obs.organismCondition,
    behaviour: obs.behaviour,
    notes: obs.notes,
    aerial: obs.aerial,
    identificationConfidence: obs.identificationConfidence,
    detectionDistanceMeters: obs.detectionDistanceMeters,
    verbatimUtterance: utterance,
  };
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  screen: 'terreno',
  session: { userId: 'local', userName: 'Usuario de terreno', deviceId: deviceId() },
  banner: null,
  projects: [], campaigns: [], stations: [], taxonIndex: null, vocabularies: {},
  profile: DEFAULT_PROFILE,
  templates: [NATIVE_TEMPLATE],
  templateId: NATIVE_TEMPLATE.id,
  projectId: null, campaignId: null, stationId: null, method: null, stationConfirmed: false,
  fix: null, gpsError: null, suggestions: [],
  drafts: [], validations: {}, lastUtterance: null,
  records: [], sync: { pending: 0, errored: 0, conflicts: 0 },
  activeEvent: null, effort: null, trackWatchId: null, quality: null,
  lastSaved: null,

  async init() {
    if (!(await catalogsReady())) await seedCatalogs();
    const [projects, campaigns, stations, taxa, vocab, profiles, templates] = await Promise.all([
      db.projects.toArray(), db.campaigns.toArray(), db.stations.toArray(),
      db.taxa.toArray(), db.vocabularies.toArray(), db.profiles.toArray(), db.templates.toArray(),
    ]);
    const project = projects[0] ?? null;
    const profile = profiles.find((p) => p.id === project?.requirementProfileId) ?? DEFAULT_PROFILE;
    set({
      ready: true, projects, campaigns, stations,
      taxonIndex: new TaxonIndex(taxa),
      vocabularies: Object.fromEntries(vocab.map((v) => [v.name, v.values])),
      profile,
      templates: templates.length ? templates : [NATIVE_TEMPLATE],
      templateId: globalThis.localStorage?.getItem('proterr.templateId') ?? NATIVE_TEMPLATE.id,
      projectId: project?.id ?? null,
      campaignId: campaigns.find((c) => c.projectId === project?.id)?.id ?? null,
      method: 'transecto',
      sync: await syncStatus(),
    });
    await get().refreshRecords();
    await refreshActiveEvent(set, get);
  },

  setScreen(screen) { set({ screen }); },
  notify(text, tone = 'ok') {
    set({ banner: { text, tone } });
    setTimeout(() => set((s) => (s.banner?.text === text ? { banner: null } : s)), 4000);
  },

  select(patch) {
    set((s) => ({
      ...patch,
      // Elegir estación a mano es una confirmación explícita del usuario.
      stationConfirmed: patch.stationId ? true : s.stationConfirmed,
      // Cambiar de proyecto invalida campaña y estación previas.
      campaignId: patch.projectId && patch.projectId !== s.projectId ? null : (patch.campaignId ?? s.campaignId),
      stationId: patch.projectId && patch.projectId !== s.projectId ? null : (patch.stationId ?? s.stationId),
    }));
    void refreshActiveEvent(set, get);
  },

  async requestGps() {
    const geo = globalThis.navigator?.geolocation;
    if (!geo) { set({ gpsError: 'Este dispositivo no entrega ubicación.' }); return; }
    await new Promise<void>((resolve) => {
      geo.getCurrentPosition(
        (pos) => {
          const project = get().projects.find((p) => p.id === get().projectId);
          const zone = project?.utmZone;
          const utm = toUtm(pos.coords.latitude, pos.coords.longitude, zone);
          const fix: GeoFix = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyMeters: pos.coords.accuracy ?? null,
            altitudeMeters: pos.coords.altitude ?? null,
            fixedAt: new Date(pos.timestamp).toISOString(),
            utmEast: utm.east, utmNorth: utm.north, utmZone: utm.zone,
            geodeticDatum: project?.geodeticDatum ?? 'WGS84',
          };
          const stations = get().stations.filter((s) => s.projectId === get().projectId);
          set({ fix, gpsError: null, suggestions: suggestStations(fix, stations) });
          resolve();
        },
        (err) => {
          const messages: Record<number, string> = {
            1: 'Sin permiso de ubicación. Selecciona la estación a mano.',
            2: 'GPS sin señal. Selecciona la estación a mano.',
            3: 'El GPS tardó demasiado. Vuelve a intentar o elige la estación.',
          };
          set({ gpsError: messages[err.code] ?? `GPS no disponible: ${err.message}` });
          resolve();
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
      );
    });
  },

  confirmSuggestedStation(stationId) {
    set({ stationId, stationConfirmed: true, suggestions: [] });
  },

  async handleUtterance(text) {
    const command = parseCommand(text);
    if (command) return command;

    const { taxonIndex, stations, projectId, campaignId, stationId, method, session } = get();
    if (!taxonIndex) return null;
    const codes = stations.filter((s) => s.projectId === projectId).map((s) => s.stationCode);
    const parsed = parseUtterance(text, { taxonIndex, stationCodes: codes });

    // La estación dicha en la frase manda sobre la seleccionada, pero se
    // registra el cambio en pantalla en vez de aplicarlo en silencio.
    let effectiveStation = stationId;
    if (parsed.stationCode) {
      const match = stations.find((s) => s.stationCode === parsed.stationCode);
      if (match) {
        effectiveStation = match.id;
        set({ stationId: match.id, stationConfirmed: true });
      }
    }
    const effectiveMethod = parsed.method ?? method;
    if (parsed.method) set({ method: parsed.method });

    const drafts = parsed.observations.map((o) =>
      draftFrom(o, {
        projectId, campaignId, stationId: effectiveStation, method: effectiveMethod,
        recordedBy: session.userName,
      }, text));

    for (const warning of parsed.warnings) get().notify(warning, 'warn');

    if (parsed.noDetections && !drafts.length) {
      await get().recordNoDetections();
      return null;
    }
    if (!drafts.length) {
      if (!parsed.warnings.length) get().notify('No se reconoció ninguna especie.', 'warn');
      return null;
    }
    set({ drafts, lastUtterance: text, screen: 'confirmar' });
    revalidate(set, get);
    return null;
  },

  startManualDraft() {
    const { projectId, campaignId, stationId, method, session } = get();
    const now = new Date();
    set({
      drafts: [{
        ...emptyDraft(uuid(), 'manual'),
        projectId, campaignId, stationId, method,
        recordedBy: session.userName,
        eventDate: now.toISOString().slice(0, 10),
        eventTime: now.toTimeString().slice(0, 5),
      }],
      lastUtterance: null,
      screen: 'confirmar',
    });
    revalidate(set, get);
  },

  patchDraft(draftId, patch) {
    set((s) => ({
      drafts: s.drafts.map((d) => (d.draftId === draftId
        ? { ...d, ...patch, dateTimeEditedByUser: d.dateTimeEditedByUser || 'eventDate' in patch || 'eventTime' in patch }
        : d)),
    }));
    revalidate(set, get);
  },

  removeDraft(draftId) {
    set((s) => ({ drafts: s.drafts.filter((d) => d.draftId !== draftId) }));
    revalidate(set, get);
  },

  async saveAll() {
    const { drafts, validations, session, projects, projectId, fix } = get();
    const project = projects.find((p) => p.id === projectId);
    if (!project) { get().notify('Selecciona un proyecto antes de guardar.', 'error'); return; }

    // Un solo lote para todo lo dictado junto: son observaciones distintas que
    // el usuario enumeró, no un guardado repetido.
    const batchId = uuid();
    const savedIds: string[] = [];
    let saved = 0;
    for (const draft of drafts) {
      const v = validations[draft.draftId];
      if (v && !v.canSave) continue;
      const result = await commitDraft(
        draft,
        {
          projectCode: project.code,
          pendingFields: v?.pendingFields ?? [],
          batchId,
          deviceFix: fix,
          occurrenceFix: draft.occurrenceFixRequested ? fix : null,
        },
        session,
      );
      savedIds.push(result.occurrence.id);
      saved++;
    }
    set({
      drafts: [], validations: {}, screen: 'terreno',
      lastSaved: savedIds.length ? { batchId, occurrenceIds: savedIds, at: Date.now() } : get().lastSaved,
    });
    await get().refreshRecords();
    await refreshActiveEvent(set, get);
    set({ sync: await syncStatus() });
    get().notify(saved === 1 ? 'Registro guardado.' : `${saved} registros guardados.`);
  },

  missingFor(draftId) {
    const v = get().validations[draftId];
    return v ? whatIsMissing(v) : [];
  },

  async refreshRecords() {
    const occurrences = (await db.occurrences.reverse().sortBy('createdAt'))
      .filter((o) => !o.deletedAt)
      .slice(0, 200);
    const events = new Map((await db.events.toArray()).map((e) => [e.id, e]));
    const taxa = new Map((await db.taxa.toArray()).map((t) => [t.id, t]));
    const stations = new Map(get().stations.map((s) => [s.id, s]));
    set({
      records: occurrences.flatMap((o) => {
        const event = events.get(o.eventId);
        if (!event) return [];
        return [{
          occurrence: o, event,
          taxon: o.taxonId ? taxa.get(o.taxonId) ?? null : null,
          station: stations.get(event.stationId) ?? null,
        }];
      }),
    });
  },

  async editRecord(id, patch) {
    await updateOccurrence(id, patch, get().session);
    await get().refreshRecords();
    set({ sync: await syncStatus() });
  },

  async removeRecord(id) {
    await deleteOccurrence(id, get().session, 'Eliminado desde la app');
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    get().notify('Registro eliminado (queda en la auditoría).', 'warn');
  },

  async duplicateRecord(id) {
    await duplicateOccurrence(id, get().session);
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    get().notify('Registro duplicado. Ajusta hora y abundancia.');
  },

  async reviewRecord(id, state) {
    await setReviewState(id, state, get().session);
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    const label = { terreno: 'devuelto a terreno', revisado: 'marcado como revisado', validado: 'validado' }[state];
    get().notify(`Registro ${label}.`);
  },

  async beginTrack() {
    const event = await ensureEvent(set, get);
    if (!event) return;
    await get().requestGps();
    await startTrack(event.id, get().session, get().fix);
    await refreshActiveEvent(set, get);
    get().notify('Track iniciado. Di "punto 100" para marcar y "cerrar track" al terminar.');
  },

  async finishTrack() {
    const event = get().activeEvent;
    if (!event || event.trackState !== 'activo') { get().notify('No hay un track abierto.', 'warn'); return; }
    await get().requestGps();
    await endTrack(event.id, get().session, get().fix);
    await refreshActiveEvent(set, get);
    get().notify(`Track cerrado: ${get().effort?.label ?? 'sin medición'}.`);
  },

  async addWaypoint(label) {
    const event = get().activeEvent;
    if (!event) { get().notify('Selecciona la estación antes de marcar un punto.', 'warn'); return; }
    await get().requestGps();
    const fix = get().fix;
    if (!fix) { get().notify('Sin GPS: no se puede marcar el punto.', 'error'); return; }
    const waypoint = await markWaypoint(event.id, label, fix, get().session);
    await refreshActiveEvent(set, get);
    get().notify(`Punto "${waypoint?.label ?? label}" marcado.`);
  },

  async undoLastSave() {
    const last = get().lastSaved;
    if (!last) { get().notify('No hay nada reciente que deshacer.', 'warn'); return; }
    for (const id of last.occurrenceIds) {
      await deleteOccurrence(id, get().session, 'Deshecho por el usuario');
    }
    set({ lastSaved: null });
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    get().notify(
      last.occurrenceIds.length === 1
        ? 'Registro deshecho. Queda en la auditoría.'
        : `${last.occurrenceIds.length} registros deshechos. Quedan en la auditoría.`,
      'warn',
    );
  },

  async repeatLast(times = 1) {
    const source = get().records[0];
    if (!source) { get().notify('Todavía no hay ningún registro que repetir.', 'warn'); return; }
    const ids: string[] = [];
    for (let i = 0; i < Math.max(1, times); i++) {
      const copy = await duplicateOccurrence(source.occurrence.id, get().session);
      ids.push(copy.id);
    }
    set({ lastSaved: { batchId: uuid(), occurrenceIds: ids, at: Date.now() } });
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    const nombre = source.taxon?.commonName ?? 'registro';
    get().notify(times > 1 ? `${times} ${nombre} más.` : `Otro ${nombre.toLowerCase()}.`);
  },

  async correctLast(text) {
    const target = get().records[0];
    const { taxonIndex } = get();
    if (!target || !taxonIndex) { get().notify('No hay un registro que corregir.', 'warn'); return; }

    // Se reinterpreta la corrección con el mismo parser, apoyada en la especie
    // ya registrada: así "eran dos" o "era hembra" se entienden sin repetirla.
    const nombre = target.taxon?.commonName ?? '';
    const parsed = parseUtterance(`${nombre} ${text}`, { taxonIndex });
    const obs = parsed.observations[0];
    if (!obs) { get().notify(`No entendí la corrección: "${text}"`, 'warn'); return; }

    const patch: Partial<Occurrence> = {};
    if (obs.individualCount !== null && !obs.countInferred) patch.individualCount = obs.individualCount;
    if (obs.sex) patch.sex = obs.sex;
    if (obs.lifeStage) patch.lifeStage = obs.lifeStage;
    if (obs.behaviour) patch.behaviour = obs.behaviour;
    if (!obs.recordTypeInferred && obs.recordType) patch.recordType = obs.recordType;
    if (obs.organismCondition) patch.organismCondition = obs.organismCondition;

    if (!Object.keys(patch).length) { get().notify(`No entendí qué corregir en "${text}"`, 'warn'); return; }
    await updateOccurrence(target.occurrence.id, patch, get().session, `Corrección hablada: "${text}"`);
    await get().refreshRecords();
    set({ sync: await syncStatus() });
    const resumen = Object.entries(patch).map(([k, v]) => `${LABEL[k] ?? k}: ${String(v)}`).join(', ');
    get().notify(`Corregido — ${resumen}.`);
  },

  async closeEffort(extra = {}) {
    const event = get().activeEvent;
    if (!event) { get().notify('No hay un muestreo abierto.', 'warn'); return; }
    stopTrackWatch(set, get);
    await endEffort(event.id, get().session, extra);
    await refreshActiveEvent(set, get);
    const effort = get().effort;
    get().notify(`Muestreo cerrado: ${effort?.label ?? 'sin esfuerzo'}.`);
  },

  async setConditions(conditions) {
    const event = get().activeEvent;
    if (!event) { get().notify('Abre un muestreo antes de anotar las condiciones.', 'warn'); return; }
    await applyEventPatch(event.id, { conditions }, get().session, 'Condiciones ambientales');
    await refreshActiveEvent(set, get);
  },

  async recordNoDetections() {
    const { projectId, campaignId, stationId, method, session, projects, fix } = get();
    const project = projects.find((p) => p.id === projectId);
    if (!project || !campaignId || !stationId || !method) {
      get().notify('Selecciona proyecto, campaña, estación y metodología primero.', 'warn');
      return;
    }
    const now = new Date();
    const event = await getOrCreateEvent(
      {
        projectId: projectId!, campaignId, stationId, siteId: null, method,
        eventDate: now.toISOString().slice(0, 10),
      },
      {
        eventTime: now.toTimeString().slice(0, 5), recordedBy: session.userName,
        weather: null, deviceFix: fix, projectCode: project.code,
      },
      session,
    );
    await applyEventPatch(event.id, { noDetections: true }, session, 'Muestreo sin detecciones');
    await refreshActiveEvent(set, get);
    get().notify('Anotado: muestreo sin detecciones. La ausencia también es un dato.');
  },

  async importStations(candidates, prefix = '') {
    const { projectId, projects, session } = get();
    const project = projects.find((p) => p.id === projectId);
    if (!project) { get().notify('Selecciona un proyecto antes de importar.', 'warn'); return 0; }

    const existing = new Map(get().stations.map((st) => [st.stationCode.toLowerCase(), st]));
    const stations: Station[] = [];
    for (const c of candidates) {
      const code = `${prefix}${c.name}`.trim();
      if (!code) continue;
      const utm = toUtm(c.latitude, c.longitude, project.utmZone);
      const previous = existing.get(code.toLowerCase());
      const end = c.end ? toUtm(c.end.latitude, c.end.longitude, project.utmZone) : null;
      stations.push({
        // Actualizar una estación existente conserva su id, y con eso los
        // registros que ya la referencian.
        id: previous?.id ?? `st_${code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        projectId: project.id,
        stationCode: code,
        finalStationCode: previous?.finalStationCode ?? code,
        darwinCoreLocationId: locationIdFor(project.code, code),
        region: previous?.region ?? project.region ?? null,
        season: previous?.season ?? null,
        habitat: previous?.habitat ?? null,
        slopeAspect: previous?.slopeAspect ?? null,
        utmEast: utm.east, utmNorth: utm.north,
        utmStartEast: end ? utm.east : previous?.utmStartEast ?? null,
        utmStartNorth: end ? utm.north : previous?.utmStartNorth ?? null,
        utmEndEast: end?.east ?? previous?.utmEndEast ?? null,
        utmEndNorth: end?.north ?? previous?.utmEndNorth ?? null,
        latitude: c.latitude, longitude: c.longitude,
        methods: previous?.methods ?? project.methods.slice(0, 1),
        sites: previous?.sites ?? [],
        recordedBy: previous?.recordedBy ?? session.userName,
        identifiedBy: previous?.identifiedBy ?? null,
      });
    }
    await db.stations.bulkPut(stations);
    set({ stations: await db.stations.toArray() });
    get().notify(`${stations.length} estación(es) cargadas desde el archivo.`);
    return stations.length;
  },

  selectTemplate(id) {
    set({ templateId: id });
    globalThis.localStorage?.setItem('proterr.templateId', id);
  },

  async saveTemplate(template) {
    await db.templates.put(template);
    set({ templates: await db.templates.toArray(), templateId: template.id });
    globalThis.localStorage?.setItem('proterr.templateId', template.id);
    get().notify(`Plantilla "${template.name}" guardada.`);
  },

  async deleteTemplate(id) {
    const template = get().templates.find((t) => t.id === id);
    if (template?.builtin) { get().notify('La plantilla nativa no se puede borrar.', 'warn'); return; }
    await db.templates.delete(id);
    const templates = await db.templates.toArray();
    set({ templates, templateId: get().templateId === id ? NATIVE_TEMPLATE.id : get().templateId });
    get().notify('Plantilla eliminada.');
  },

  async refreshQuality() {
    const events = await db.events.toArray();
    const occurrences = await db.occurrences.toArray();
    const taxa = new Map((await db.taxa.toArray()).map((t) => [t.id, t]));
    set({ quality: analyzeQuality({ events, occurrences, taxa }) });
  },

  async runSync(transport) {
    const report = await syncOutbox(transport);
    set({ sync: await syncStatus() });
    await get().refreshRecords();
    if (!transport.isOnline()) get().notify('Sin conexión: los registros quedan en cola.', 'warn');
    else if (report.conflicts) get().notify(`${report.conflicts} conflicto(s) requieren revisión.`, 'error');
    else get().notify(`${report.synced} registro(s) sincronizados.`);
  },
}));

/**
 * Devuelve el evento de hoy para la estación y metodología seleccionadas,
 * creándolo si hace falta. Lo necesitan las acciones de track, que pueden
 * ocurrir antes del primer registro.
 */
async function ensureEvent(
  set: (partial: Partial<State>) => void, get: () => State,
): Promise<SamplingEvent | null> {
  const { projectId, campaignId, stationId, method, session, projects, fix } = get();
  const project = projects.find((p) => p.id === projectId);
  if (!project || !campaignId || !stationId || !method) {
    get().notify('Selecciona proyecto, campaña, estación y metodología primero.', 'warn');
    return null;
  }
  const now = new Date();
  const event = await getOrCreateEvent(
    { projectId: projectId!, campaignId, stationId, siteId: null, method, eventDate: now.toISOString().slice(0, 10) },
    {
      eventTime: now.toTimeString().slice(0, 5), recordedBy: session.userName,
      weather: null, deviceFix: fix, projectCode: project.code,
    },
    session,
  );
  await refreshActiveEvent(set, get);
  return event;
}

/**
 * Refresca el muestreo abierto: el evento de hoy en la estación y metodología
 * seleccionadas, con su esfuerzo recalculado.
 */
async function refreshActiveEvent(set: (partial: Partial<State>) => void, get: () => State): Promise<void> {
  const { stationId, method } = get();
  if (!stationId || !method) { set({ activeEvent: null, effort: null }); return; }
  const today = new Date().toISOString().slice(0, 10);
  const event = await db.events
    .where({ stationId, eventDate: today })
    .filter((e) => !e.deletedAt && e.method === method)
    .last();
  set({ activeEvent: event ?? null, effort: event ? summarizeEffort(event) : null });
  // El GPS sólo graba con el track explícitamente abierto: mantenerlo encendido
  // toda la jornada agota la batería y casi nunca hace falta.
  if (event?.trackState === 'activo') startTrackWatch(set, get, event.id);
  else stopTrackWatch(set, get);
}

/**
 * Acumula el recorrido mientras el track está abierto. Se detiene al cerrarlo:
 * un GPS encendido toda la jornada agota la batería, que en terreno es un
 * recurso tan escaso como la señal.
 */
function startTrackWatch(set: (partial: Partial<State>) => void, get: () => State, eventId: string): void {
  if (get().trackWatchId !== null) return;
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return;
  const id = geo.watchPosition(
    (pos) => {
      void appendTrack(eventId, {
        t: new Date(pos.timestamp).toISOString(),
        lat: pos.coords.latitude, lon: pos.coords.longitude,
        acc: pos.coords.accuracy ?? null, alt: pos.coords.altitude ?? null,
      }).then((accepted) => { if (accepted) void refreshActiveEvent(set, get); });
    },
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
  set({ trackWatchId: id });
}

function stopTrackWatch(set: (partial: Partial<State>) => void, get: () => State): void {
  const id = get().trackWatchId;
  if (id === null) return;
  globalThis.navigator?.geolocation?.clearWatch(id);
  set({ trackWatchId: null });
}

/** Revalida todos los borradores tras cualquier cambio. */
function revalidate(set: (partial: Partial<State>) => void, get: () => State): void {
  const { drafts, profile, taxonIndex, projects, projectId } = get();
  const project = projects.find((p) => p.id === projectId);
  const validations: Record<string, ValidationResult> = {};
  for (const d of drafts) {
    validations[d.draftId] = validateDraft(d, {
      profile,
      taxon: d.taxonId ? taxonIndex?.get(d.taxonId) ?? null : null,
      projectMethods: project?.methods,
      resolveTaxon: (id) => taxonIndex?.get(id),
      effort: get().effort,
      conditions: get().activeEvent?.conditions ?? null,
      fix: get().fix,
      station: get().stations.find((st) => st.id === d.stationId) ?? null,
      nearbyStations: get().stations.filter((st) => st.projectId === projectId),
    });
  }
  set({ validations });
}
