import { describe, expect, it } from 'vitest';
import taxaSeed from '../data/seed/taxa.json';
import { emptyDraft, type ObservationDraft } from '../domain/draft';
import type { Taxon } from '../domain/types';
import { validateDraft, whatIsMissing } from './engine';
import { DEFAULT_PROFILE, requirementFor } from './profiles';

const taxa = taxaSeed as unknown as Taxon[];
const byName = (n: string) => taxa.find((t) => t.commonName === n)!;
const resolveTaxon = (id: string) => taxa.find((t) => t.id === id);

function draftOf(patch: Partial<ObservationDraft>): ObservationDraft {
  return {
    ...emptyDraft('d1', 'voz'),
    projectId: 'p', campaignId: 'c', stationId: 's',
    eventDate: '2026-09-04', eventTime: '10:34', method: 'transecto', recordedBy: 'I. Rojas',
    ...patch,
  };
}

describe('perfil de requisitos', () => {
  it('tránsito aéreo pide altura y dirección; transecto no las muestra', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'flightHeight', { method: 'transito_aereo' })).toBe('required');
    expect(requirementFor(DEFAULT_PROFILE, 'flightHeight', { method: 'transecto' })).toBe('hidden');
  });

  it('la evidencia indirecta no exige abundancia ni sexo', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'individualCount', { method: 'transecto', recordType: 'Fecas' })).toBe('optional');
    expect(requirementFor(DEFAULT_PROFILE, 'sex', { method: 'transecto', recordType: 'Fecas' })).toBe('hidden');
  });
});

describe('no bloquear al usuario (brief §7)', () => {
  it('"Chucao cantando" se puede guardar y no pide sexo', () => {
    const d = draftOf({
      taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1, behaviour: 'Vocalizando',
    });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon });
    expect(r.canSave).toBe(true);
    expect(r.issues.some((i) => i.field === 'sex')).toBe(false);
  });

  it('nunca pide taxonomía derivable', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Individuo' });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon });
    const text = whatIsMissing(r).join(' ').toLowerCase();
    for (const w of ['reino', 'orden', 'familia', 'género', 'filo', 'distribución']) {
      expect(text).not.toContain(w);
    }
  });

  it('sin especie sí bloquea', () => {
    const r = validateDraft(draftOf({}), { profile: DEFAULT_PROFILE, resolveTaxon });
    expect(r.canSave).toBe(false);
  });
});

describe('recordatorios sin ruido', () => {
  it('separa lo que pertenece al muestreo de lo que pertenece a la observación', () => {
    // Individuo, no vocalización: la conducta sólo se pide cuando se vio al animal.
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Individuo', individualCount: 1, weather: null, behaviour: null });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon });
    // El clima es del evento: se pregunta una vez, no por cada especie dictada.
    expect(r.issues.find((i) => i.field === 'weather')?.level).toBe('event');
    expect(r.issues.find((i) => i.field === 'behaviour')?.level).toBe('occurrence');
  });
});

describe('recordatorios y preguntas', () => {
  it('caso 6: pide sólo el tipo de registro cuando fue inferido', () => {
    const d = draftOf({
      taxonId: byName('Chucao').id, recordType: 'Individuo', recordTypeInferred: true, individualCount: 1,
    });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon }));
    expect(missing).toEqual(['Falta tipo de registro.']);
  });

  it('"Picaflor chico macho" avisa abundancia inferida y tipo de registro', () => {
    const d = draftOf({
      taxonId: byName('Picaflor chico').id, sex: 'Macho', sexScope: 'todos',
      recordType: 'Individuo', recordTypeInferred: true, individualCount: 1, countInferred: true,
    });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Picaflor chico'), resolveTaxon }));
    expect(missing.join(' ')).toContain('tipo de registro');
  });

  it('pregunta el alcance del sexo en un grupo (brief §10)', () => {
    const d = draftOf({ taxonId: byName('Zorro culpeo').id, individualCount: 5, sex: 'Macho', recordType: 'Individuo' });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Zorro culpeo'), resolveTaxon });
    const q = r.issues.find((i) => i.field === 'sexScope');
    expect(q?.message).toBe('¿Los 5 individuos son macho?');
    expect(q?.options?.map((o) => o.label)).toEqual(['Sí, todos', 'Sólo uno', 'Indeterminado']);
  });

  it('pregunta si los 3 individuos son juveniles', () => {
    const d = draftOf({ taxonId: byName('Zorro culpeo').id, individualCount: 3, lifeStage: 'Juvenil', recordType: 'Individuo' });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Zorro culpeo'), resolveTaxon });
    expect(r.issues.find((i) => i.field === 'lifeStageScope')?.message).toBe('¿Los 3 individuos son juvenil?');
  });

  it('tránsito aéreo: pide sólo altura cuando ya hay dirección', () => {
    // Tiuque, no cóndor: el cóndor está amenazado y por eso exige además foto
    // y coordenada exacta (ver "aristas nuevas").
    const d = draftOf({
      method: 'transito_aereo', taxonId: byName('Tiuque').id, individualCount: 1,
      behaviour: 'Volando', aerial: { flightDirection: 'N', destination: 'N' },
    });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Tiuque'), resolveTaxon }));
    expect(missing).toEqual(['Falta altura de vuelo.']);
  });

  it('"Fecas de puma" no pide abundancia, pero sí el punto donde estaban', () => {
    const d = draftOf({ taxonId: byName('Puma').id, recordType: 'Fecas', individualCount: null });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Puma'), resolveTaxon });
    expect(whatIsMissing(r).some((m) => m.includes('abundancia'))).toBe(false);
    expect(whatIsMissing(r)).toEqual(['Falta coordenadas del avistamiento (fecas: la evidencia queda en un punto fijo).']);
    expect(r.canSave).toBe(true);
  });

  it('avisa si se cuenta individuos sobre evidencia indirecta', () => {
    const d = draftOf({ taxonId: byName('Puma').id, recordType: 'Fecas', individualCount: 2 });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Puma'), resolveTaxon });
    expect(r.issues.some((i) => i.field === 'consistency' && i.severity === 'question')).toBe(true);
  });

  it('desambigua un nombre común repetido en el catálogo', () => {
    // El catálogo de una consultora puede traer el mismo nombre común para
    // varias especies; la app pregunta en vez de tomar el primero.
    const dup = [taxa[0].id, taxa[1].id];
    const d = draftOf({ taxonId: null, taxonCandidates: dup, verbatimTaxonText: 'sapo de monte' });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, resolveTaxon });
    const q = r.issues.find((i) => i.field === 'taxonAmbiguity');
    expect(q?.severity).toBe('question');
    expect(q?.options?.length).toBeGreaterThan(1);
    expect(r.canSave).toBe(true);
  });
});

describe('aristas nuevas', () => {
  it('una especie amenazada exige fotografía y coordenada', () => {
    const condor = byName('Cóndor');
    expect(requirementFor(DEFAULT_PROFILE, 'photos', { method: 'transecto' })).toBe('optional');
    expect(requirementFor(DEFAULT_PROFILE, 'photos', { method: 'transecto', threatened: true })).toBe('required');
    const d = draftOf({ taxonId: condor.id, recordType: 'Individuo', individualCount: 1 });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: condor, resolveTaxon }));
    expect(missing.join(' ')).toContain('fotografía');
  });

  it('avisa la categoría de conservación con su fuente en el momento del registro', () => {
    const condor = byName('Cóndor');
    const d = draftOf({ taxonId: condor.id, recordType: 'Individuo', individualCount: 1, mediaIds: ['m1'] });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: condor, resolveTaxon });
    const aviso = r.issues.find((i) => i.field === 'conservation')!;
    expect(aviso.message).toContain('VU');
    expect(aviso.message).toContain('fuente:'); // nunca una categoría sin procedencia
  });

  it('marca las exóticas, aunque no estén amenazadas', () => {
    const paloma = byName('Paloma');
    const d = draftOf({ taxonId: paloma.id, recordType: 'Individuo', individualCount: 1 });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: paloma, resolveTaxon });
    expect(r.issues.some((i) => i.message.includes('exótica'))).toBe(true);
  });

  it('una especie sin clasificar no se presenta como sin riesgo', () => {
    const sinClasificar = taxa.find((t) => !t.conservation && t.scientificName)!;
    const d = draftOf({ taxonId: sinClasificar.id, recordType: 'Individuo', individualCount: 1 });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: sinClasificar, resolveTaxon });
    expect(r.issues.some((i) => i.message.includes('categoría de conservación'))).toBe(false);
    expect(r.issues.some((i) => i.message.includes('sin riesgo'))).toBe(false);
  });

  it('el recordatorio de esfuerzo es de evento y sólo aparece si se activó la medición', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1 });
    const r = validateDraft(d, {
      profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon,
      effort: { durationMinutes: 20, distanceMeters: null, trapNights: null, unit: 'distancia', measured: true, label: '20 min', incomplete: true },
    });
    const issue = r.issues.find((i) => i.field === 'effort')!;
    expect(issue.level).toBe('event');
    expect(issue.message).toContain('distancia recorrida');
  });

  it('con el esfuerzo completo no insiste', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1 });
    const r = validateDraft(d, {
      profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon,
      effort: { durationMinutes: 20, distanceMeters: 900, trapNights: null, unit: 'distancia', measured: true, label: '20 min · 900 m', incomplete: false },
    });
    expect(r.issues.some((i) => i.field === 'effort')).toBe(false);
  });

  it('un punto de conteo recomienda la distancia de detección; un transecto no la muestra', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'detectionDistance', { method: 'punto_conteo' })).toBe('recommended');
    expect(requirementFor(DEFAULT_PROFILE, 'detectionDistance', { method: 'transecto' })).toBe('hidden');
  });

  it('el registro oportunista no exige estación pero sí coordenadas', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'station', { method: 'registro_oportunista' })).toBe('optional');
    expect(requirementFor(DEFAULT_PROFILE, 'occurrenceCoordinates', { method: 'registro_oportunista' })).toBe('required');
  });
});

describe('flujo simple: no exigir lo que el terreno no necesita', () => {
  it('un ave común en su estación no pide coordenada propia', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1 });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon });
    expect(r.issues.some((i) => i.field === 'occurrenceCoordinates')).toBe(false);
  });

  it('una lagartija sí, y dice por qué', () => {
    const lagarto = byName('Lagarto de Zapallar');
    const d = draftOf({ taxonId: lagarto.id, recordType: 'Individuo', individualCount: 1 });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: lagarto, resolveTaxon }));
    expect(missing.join(' ')).toContain('baja movilidad');
  });

  it('las fecas llevan punto porque son un punto fijo', () => {
    const d = draftOf({ taxonId: byName('Puma').id, recordType: 'Fecas', individualCount: null });
    const missing = whatIsMissing(validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Puma'), resolveTaxon }));
    expect(missing.join(' ')).toContain('punto fijo');
  });

  it('sin medición de esfuerzo activada, no se reclama esfuerzo', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1 });
    const r = validateDraft(d, {
      profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon,
      effort: { durationMinutes: null, distanceMeters: null, trapNights: null, unit: 'distancia', measured: false, label: 'sin medición de esfuerzo', incomplete: false },
    });
    expect(r.issues.some((i) => i.field === 'effort')).toBe(false);
    expect(r.pendingFields).not.toContain('effort');
  });

  it('con el track activado y a medias, sí avisa (pero sin bloquear)', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1 });
    const r = validateDraft(d, {
      profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon,
      effort: { durationMinutes: 20, distanceMeters: null, trapNights: null, unit: 'distancia', measured: true, label: '20 min', incomplete: true },
    });
    const issue = r.issues.find((i) => i.field === 'effort');
    expect(issue?.severity).toBe('info'); // recordatorio, no exigencia
    expect(r.canSave).toBe(true);
  });
});

describe('desambiguación de nombre genérico', () => {
  it('pregunta cuál especie y no repite "falta especie"', () => {
    const candidatos = taxa.filter((t) => t.commonName.startsWith('Golondrina')).map((t) => t.id);
    expect(candidatos.length).toBeGreaterThan(1);
    const d = draftOf({
      taxonId: null, taxonCandidates: candidatos, verbatimTaxonText: 'golondrina',
      recordType: 'Individuo', individualCount: 3,
    });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, resolveTaxon });

    expect(r.issues.filter((i) => i.field === 'taxonAmbiguity')).toHaveLength(1);
    expect(whatIsMissing(r).some((m) => m.includes('Falta especie'))).toBe(false);
    expect(r.canSave).toBe(true);              // se puede guardar y resolver después
    expect(r.pendingFields).toContain('taxon'); // pero queda pendiente
  });
});

describe('coherencia con el GPS: ¿seguimos en esta estación?', () => {
  const station = (id: string, code: string, lat: number, lon: number) => ({
    id, projectId: 'p', stationCode: code, finalStationCode: code,
    darwinCoreLocationId: `urn:x:${code}`, latitude: lat, longitude: lon,
    methods: ['transecto'], sites: [],
  } as never);
  const a = station('sa', 'EMF01', -32.9600, -71.3500);
  const b = station('sb', 'EMF02', -32.9640, -71.3500); // ~445 m al sur
  const fix = (lat: number, lon: number, acc = 8) =>
    ({ latitude: lat, longitude: lon, accuracyMeters: acc, fixedAt: '2026-09-04T14:00:00Z' } as never);

  const base = { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon, nearbyStations: [a, b] };
  const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1, stationId: 'sa' });

  it('no dice nada si estás donde dice la pantalla', () => {
    const r = validateDraft(d, { ...base, station: a, fix: fix(-32.9601, -71.3500) });
    expect(r.issues.some((i) => i.field === 'stationDistance')).toBe(false);
  });

  it('avisa y ofrece la más cercana si te alejaste', () => {
    const r = validateDraft(d, { ...base, station: a, fix: fix(-32.9639, -71.3500) });
    const issue = r.issues.find((i) => i.field === 'stationDistance')!;
    expect(issue.severity).toBe('question');
    expect(issue.level).toBe('event');
    expect(issue.message).toContain('EMF01');
    expect(issue.message).toContain('La más cercana es EMF02');
    expect(issue.options?.map((o) => o.label)).toEqual([
      expect.stringContaining('Cambiar a EMF02'),
      'Sigo en EMF01',
    ]);
  });

  it('nunca cambia la estación por su cuenta: sólo ofrece', () => {
    const r = validateDraft(d, { ...base, station: a, fix: fix(-32.9639, -71.3500) });
    const cambiar = r.issues.find((i) => i.field === 'stationDistance')!.options![0];
    expect(cambiar.patch).toEqual({ stationId: 'sb' });
    expect(r.canSave).toBe(true); // avisar no bloquea
  });

  it('calla si el GPS es peor que la distancia: sería ruido, no un error del usuario', () => {
    const r = validateDraft(d, { ...base, station: a, fix: fix(-32.9639, -71.3500, 900) });
    expect(r.issues.some((i) => i.field === 'stationDistance')).toBe(false);
  });

  it('sin GPS no inventa un aviso', () => {
    const r = validateDraft(d, { ...base, station: a, fix: null });
    expect(r.issues.some((i) => i.field === 'stationDistance')).toBe(false);
  });
});

describe('campos según el canal de detección', () => {
  it('un avistamiento pide conducta y edad', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'behaviour', { recordType: 'Individuo' })).toBe('recommended');
    expect(requirementFor(DEFAULT_PROFILE, 'lifeStage', { recordType: 'Individuo' })).toBe('recommended');
  });

  it('una vocalización no: no se ve al animal', () => {
    for (const field of ['behaviour', 'lifeStage', 'sex'] as const) {
      expect(requirementFor(DEFAULT_PROFILE, field, { recordType: 'Vocalización' })).toBe('hidden');
    }
  });

  it('una cámara trampa sí, porque hay foto', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'behaviour', { method: 'camara_trampa', recordType: 'Individuo' })).toBe('recommended');
    expect(requirementFor(DEFAULT_PROFILE, 'lifeStage', { method: 'camara_trampa', recordType: 'Individuo' })).toBe('recommended');
  });

  it('"chucao, vocalización" ya no reclama comportamiento', () => {
    const d = draftOf({ taxonId: byName('Chucao').id, recordType: 'Vocalización', individualCount: 1, behaviour: null });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Chucao'), resolveTaxon });
    expect(r.issues.some((i) => i.field === 'behaviour')).toBe(false);
    expect(r.issues.some((i) => i.field === 'lifeStage')).toBe(false);
  });
});

describe('MTAN: el nocturno no es el diurno con otro horario', () => {
  it('exige la referencia contra la que se estimó la altura', () => {
    // De noche la altura no se mide: se compara con algo que se ve.
    expect(requirementFor(DEFAULT_PROFILE, 'flightHeightReference', { method: 'transito_aereo_nocturno' })).toBe('required');
    expect(requirementFor(DEFAULT_PROFILE, 'flightHeightReference', { method: 'transito_aereo' })).toBe('hidden');
    expect(requirementFor(DEFAULT_PROFILE, 'flightHeightReference', { method: 'transecto' })).toBe('hidden');
  });

  it('no pide sexo, edad ni conducta: de noche eso se inventaría', () => {
    for (const campo of ['sex', 'lifeStage', 'behaviour'] as const) {
      expect(requirementFor(DEFAULT_PROFILE, campo, { method: 'transito_aereo_nocturno' })).toBe('hidden');
    }
  });

  it('trabaja por bloque horario, no por punto de observación', () => {
    expect(requirementFor(DEFAULT_PROFILE, 'timeBlock', { method: 'transito_aereo_nocturno' })).toBe('required');
    expect(requirementFor(DEFAULT_PROFILE, 'timeBlock', { method: 'transito_aereo' })).toBe('hidden');
  });

  it('reclama la referencia de altura pero deja guardar igual', () => {
    const d = draftOf({
      method: 'transito_aereo_nocturno', taxonId: byName('Cóndor').id,
      recordType: 'Individuo', individualCount: 2,
      aerial: { flightDirection: 'N', flightHeightMeters: 40 },
    });
    const r = validateDraft(d, { profile: DEFAULT_PROFILE, taxon: byName('Cóndor'), resolveTaxon });
    expect(r.canSave).toBe(true);
    expect(whatIsMissing(r).join(' ')).toContain('referencia de altura');
  });
});
