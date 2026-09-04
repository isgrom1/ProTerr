/**
 * Calidad del dato: duplicados, vacíos y coherencia de la campaña.
 *
 * Dos cosas que la planilla no podía detectar y que en terreno pasan siempre:
 * el doble guardado accidental (mismo bicho, misma estación, mismo minuto) y
 * la estación que se muestreó sin registrar el esfuerzo.
 */
import { locationFixNeed } from '../conservation/mobility';
import { flagFor, isExotic } from '../conservation/status';
import { summarizeEffort } from '../effort/session';
import type { Occurrence, SamplingEvent, Station, Taxon } from '../domain/types';

export interface QualityIssue {
  kind: 'duplicado' | 'sin-esfuerzo' | 'sin-evidencia' | 'sin-abundancia'
    | 'sin-revisar' | 'identificacion-dudosa' | 'sin-coordenada';
  severity: 'alta' | 'media' | 'baja';
  message: string;
  occurrenceIds: string[];
  eventId?: string;
}

export interface QualitySummary {
  events: number;
  occurrences: number;
  species: number;
  /** Eventos muestreados sin ninguna detección: es un dato, no un vacío. */
  emptyEvents: number;
  threatenedRecords: number;
  exoticRecords: number;
  issues: QualityIssue[];
}

export interface QualityInput {
  events: SamplingEvent[];
  occurrences: Occurrence[];
  taxa: Map<string, Taxon>;
  stations?: Map<string, Station>;
}

/**
 * Ventana para considerar dos registros el mismo. Un minuto es suficiente:
 * el doble toque ocurre en segundos, y dos individuos distintos de la misma
 * especie en la misma estación dentro del mismo minuto son indistinguibles
 * de un duplicado, así que se pregunta en vez de decidir.
 */
const DUPLICATE_WINDOW_MS = 60_000;

export function analyzeQuality(input: QualityInput): QualitySummary {
  const { events, occurrences, taxa } = input;
  const byId = new Map(events.map((e) => [e.id, e]));
  const live = occurrences.filter((o) => !o.deletedAt);
  const issues: QualityIssue[] = [];

  issues.push(...findDuplicates(live, byId, taxa));
  issues.push(...findEffortGaps(events, live));
  issues.push(...findWeakRecords(live, taxa));

  return {
    events: events.length,
    occurrences: live.length,
    species: new Set(live.map((o) => o.taxonId).filter(Boolean)).size,
    emptyEvents: events.filter((e) => e.noDetections || !live.some((o) => o.eventId === e.id)).length,
    threatenedRecords: live.filter((o) => flagFor(o.taxonId ? taxa.get(o.taxonId) : null).level === 'amenazada').length,
    exoticRecords: live.filter((o) => isExotic(o.taxonId ? taxa.get(o.taxonId) : null)).length,
    issues: issues.sort((a, b) => weight(b.severity) - weight(a.severity)),
  };
}

const weight = (s: QualityIssue['severity']): number => (s === 'alta' ? 3 : s === 'media' ? 2 : 1);

/** Mismo evento, misma especie, mismo tipo de registro, dentro de un minuto. */
function findDuplicates(
  occurrences: Occurrence[], events: Map<string, SamplingEvent>, taxa: Map<string, Taxon>,
): QualityIssue[] {
  const groups = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const key = `${o.eventId}|${o.taxonId ?? o.verbatimTaxonText ?? '?'}|${o.recordType}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }

  const issues: QualityIssue[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    let cluster: Occurrence[] = [sorted[0]];

    const flush = () => {
      if (cluster.length < 2) return;
      const first = cluster[0];
      const name = first.taxonId ? taxa.get(first.taxonId)?.commonName ?? '—' : first.verbatimTaxonText ?? '—';
      const event = events.get(first.eventId);
      issues.push({
        kind: 'duplicado',
        severity: 'alta',
        message: `${cluster.length} registros de ${name} (${first.recordType}) en ${event?.eventTime ?? 'la misma hora'} con menos de un minuto entre sí. ¿Es un doble guardado?`,
        occurrenceIds: cluster.map((c) => c.id),
        eventId: first.eventId,
      });
    };

    for (let i = 1; i < sorted.length; i++) {
      const gap = Date.parse(sorted[i].createdAt) - Date.parse(sorted[i - 1].createdAt);
      if (gap <= DUPLICATE_WINDOW_MS) cluster.push(sorted[i]);
      else { flush(); cluster = [sorted[i]]; }
    }
    flush();
  }
  return issues;
}

function findEffortGaps(events: SamplingEvent[], occurrences: Occurrence[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const event of events) {
    if (event.deletedAt) continue;
    const effort = summarizeEffort(event);
    // Sólo se revisa el esfuerzo que alguien decidió medir. Un registro
    // rápido sin track no es un descuido: es el modo normal de trabajo.
    if (!effort.measured || !effort.incomplete) continue;
    const own = occurrences.filter((o) => o.eventId === event.id);
    issues.push({
      kind: 'sin-esfuerzo',
      severity: own.length ? 'media' : 'baja',
      message: `Muestreo del ${event.eventDate} ${event.eventTime}: se activó la medición de esfuerzo pero quedó a medias (${effort.unit}).`,
      occurrenceIds: own.map((o) => o.id),
      eventId: event.id,
    });
  }
  return issues;
}

function findWeakRecords(occurrences: Occurrence[], taxa: Map<string, Taxon>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const o of occurrences) {
    const taxon = o.taxonId ? taxa.get(o.taxonId) ?? null : null;
    const name = taxon?.commonName ?? o.verbatimTaxonText ?? 'registro';

    // Una especie amenazada sin foto es un dato que nadie podrá verificar.
    if (flagFor(taxon).level === 'amenazada' && o.mediaIds.length === 0) {
      issues.push({
        kind: 'sin-evidencia', severity: 'alta',
        message: `${name} está en categoría de amenaza y no tiene fotografía. Es el registro que más se va a cuestionar en la revisión.`,
        occurrenceIds: [o.id],
      });
    }
    if (o.identificationConfidence && o.identificationConfidence !== 'seguro' && o.mediaIds.length === 0) {
      issues.push({
        kind: 'identificacion-dudosa', severity: 'media',
        message: `${name} quedó como identificación "${o.identificationConfidence}" y sin evidencia que permita confirmarla.`,
        occurrenceIds: [o.id],
      });
    }
    // Un punto GPS sólo se echa de menos donde la ubicación significa algo:
    // baja movilidad, evidencia fija o especie en categoría.
    const fixNeed = locationFixNeed(taxon, o.recordType);
    if (fixNeed.required && !o.occurrenceFix) {
      issues.push({
        kind: 'sin-coordenada', severity: 'media',
        message: `${name} sin coordenada propia (${fixNeed.reason}).`,
        occurrenceIds: [o.id],
      });
    }
    if (o.evidenceKind === 'Directo' && o.individualCount === null) {
      issues.push({
        kind: 'sin-abundancia', severity: 'media',
        message: `${name}: registro directo sin abundancia.`,
        occurrenceIds: [o.id],
      });
    }
    if (o.reviewState === 'validado' && o.pendingFields.length > 0) {
      issues.push({
        kind: 'sin-revisar', severity: 'alta',
        message: `${name} está marcado como validado pero conserva campos pendientes: ${o.pendingFields.join(', ')}.`,
        occurrenceIds: [o.id],
      });
    }
  }
  return issues;
}

/** Riqueza y abundancia por especie, la tabla que abre cualquier informe. */
export interface SpeciesTally {
  taxonId: string | null;
  name: string;
  scientificName: string | null;
  records: number;
  individuals: number;
  threatened: boolean;
  exotic: boolean;
}

export function tallyBySpecies(occurrences: Occurrence[], taxa: Map<string, Taxon>): SpeciesTally[] {
  const rows = new Map<string, SpeciesTally>();
  for (const o of occurrences) {
    if (o.deletedAt) continue;
    const taxon = o.taxonId ? taxa.get(o.taxonId) ?? null : null;
    const key = o.taxonId ?? `verbatim:${o.verbatimTaxonText ?? '?'}`;
    const row = rows.get(key) ?? {
      taxonId: o.taxonId,
      name: taxon?.commonName ?? o.verbatimTaxonText ?? 'Sin identificar',
      scientificName: taxon?.scientificName ?? null,
      records: 0, individuals: 0,
      threatened: flagFor(taxon).level === 'amenazada',
      exotic: isExotic(taxon),
    };
    row.records++;
    row.individuals += o.individualCount ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.individuals - a.individuals || a.name.localeCompare(b.name));
}
