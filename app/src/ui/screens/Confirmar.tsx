/**
 * Tarjeta de confirmación (brief §11).
 *
 * Muestra lo que el sistema entendió, en una tarjeta por observación, con las
 * preguntas necesarias resueltas en un toque. Guardar es siempre posible salvo
 * que no haya especie: lo que falte se guarda como pendiente (§7).
 */
import { useState } from 'react';
import { flagFor } from '../../conservation/status';
import { toUtm } from '../../geo/utm';
import { preparePhoto, suggestionFrom, type PhotoSuggestion } from '../../media/photo';
import { attachMedia } from '../../db/repository';
import type { ObservationDraft } from '../../domain/draft';
import { useStore } from '../../state/store';
import { requirementFor } from '../../validation/profiles';
import { METHOD_LABELS } from './Terreno';

/** Patrón de vuelo, tal como se anota en el monitoreo nocturno. */
const TIPO_VUELO = ['Directo', 'En círculos', 'Ascendente', 'Descendente', 'Migratorio', 'Percha a percha'];

/** Vocabulario por defecto; una plantilla puede traer el suyo. */
const REPRODUCTIVA = [
  'No registrada', 'Hembra con crías', 'Macho con crías', 'Hembra en celo',
  'Hembra preñada', 'Empollando', 'En cortejo', 'Nido activo',
];

export function Confirmar() {
  const s = useStore();
  if (!s.drafts.length) {
    return <section className="card"><p className="muted">No hay observaciones por confirmar.</p></section>;
  }
  const total = s.drafts.length;
  // Lo que falta del muestreo (clima, observador, estación) se pregunta una
  // sola vez arriba, no repetido en cada tarjeta.
  const eventIssues = new Map<string, string>();
  for (const d of s.drafts) {
    for (const i of s.validations[d.draftId]?.issues ?? []) {
      if (i.level === 'event') eventIssues.set(i.field, i.message);
    }
  }

  return (
    <>
      <section className="card">
        <h2>{total === 1 ? 'Nueva observación' : `Nuevas observaciones (${total})`}</h2>
        {s.lastUtterance && <p className="muted">Dictado: “{s.lastUtterance}”</p>}
        {[...eventIssues.entries()].map(([field, message]) => (
          <div className="issue" data-severity="info" key={field}><p>{message}</p></div>
        ))}
      </section>
      {s.drafts.map((d, i) => <DraftCard key={d.draftId} draft={d} index={i} />)}
      <div className="row">
        <button className="btn primary" onClick={() => void s.saveAll()}>
          {total === 1 ? 'Guardar' : 'Guardar todo'}
        </button>
        <button className="btn ghost" onClick={() => { useStore.setState({ drafts: [], validations: {} }); s.setScreen('terreno'); }}>
          Cancelar
        </button>
      </div>
    </>
  );
}

function DraftCard({ draft, index }: { draft: ObservationDraft; index: number }) {
  const s = useStore();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const validation = s.validations[draft.draftId];
  const taxon = draft.taxonId ? s.taxonIndex?.get(draft.taxonId) ?? null : null;
  const station = s.stations.find((st) => st.id === draft.stationId) ?? null;
  const vocab = s.vocabularies;
  const patch = (p: Partial<ObservationDraft>) => s.patchDraft(draft.draftId, p);
  const isNightAerial = draft.method === 'transito_aereo_nocturno';
  const isAerial = draft.method === 'transito_aereo' || isNightAerial;
  // Cada metodología pide lo suyo: la trampa y la línea sólo existen en
  // trampeo, igual que el origen del vuelo sólo existe en tránsito aéreo.
  const isTrapping = draft.method === 'trampa_sherman' || draft.method === 'camara_trampa';
  const sites = (station?.sites ?? []).filter((site) => site.kind === draft.method);
  // Con crías, en celo, empollando: sólo tiene sentido si se vio al animal.
  const pideReproductiva = requirementFor(s.profile, 'reproductiveCondition', {
    method: draft.method, recordType: draft.recordType ?? undefined,
  }) !== 'hidden';

  return (
    <section className="card">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <div style={{ flex: '1 1 auto' }}>
          <strong style={{ fontSize: 20 }}>
            {index + 1}. {taxon?.commonName ?? draft.verbatimTaxonText ?? 'Especie sin identificar'}
          </strong>
          {taxon?.scientificName && <div className="sci">{taxon.scientificName}</div>}
        </div>
        <button className="btn ghost" style={{ flex: '0 0 auto' }} onClick={() => s.removeDraft(draft.draftId)}>Quitar</button>
      </div>

      {/* La categoría de conservación se ve AQUÍ, no en gabinete: si hay que
          tomar una foto o afinar la coordenada, es ahora o nunca. */}
      {(() => {
        const flag = flagFor(taxon);
        if (flag.level !== 'amenazada' && !flag.traits.length) return null;
        return (
          <div className="issue" data-severity={flag.level === 'amenazada' ? 'blocker' : 'info'}>
            <p>
              {flag.level === 'amenazada' && <strong>⚠️ {flag.badge}</strong>}
              {flag.level !== 'amenazada' && flag.badge && <span>{flag.badge}</span>}
              {flag.traits.length > 0 && <> · {flag.traits.join(' · ')}</>}
            </p>
            {flag.detail && <p className="muted" style={{ fontSize: 12 }}>{flag.detail}</p>}
          </div>
        );
      })()}

      <p style={{ margin: '10px 0' }}>
        <span className="chip">📍 {station?.stationCode ?? 'sin estación'}</span>{' '}
        <span className="chip">🕐 {draft.eventTime}</span>{' '}
        <span className="chip">{recordGlyph(draft.recordType)} {draft.recordType}</span>{' '}
        <span className="chip">🔢 {draft.individualCount ?? 'sin abundancia'}</span>
        {draft.sex && draft.sex !== 'Indeterminado' && <> <span className="chip">{draft.sex}</span></>}
        {draft.behaviour && <> <span className="chip">{draft.behaviour}</span></>}
        {draft.identificationConfidence !== 'seguro' && (
          <> <span className="chip warn">ID {draft.identificationConfidence}</span></>
        )}
        {draft.detectionDistanceMeters != null && (
          <> <span className="chip">↔ {draft.detectionDistanceMeters} m</span></>
        )}
        {isAerial && draft.aerial?.flightDirection && <> <span className="chip">↗ {draft.aerial.flightDirection}</span></>}
      </p>

      {/* Preguntas y pendientes: sólo lo accionable, nunca campos derivables. */}
      {/* 'conservation' ya se muestra arriba como distintivo: repetirlo aquí
          sería ruido, que es justo lo que el brief §9 pide evitar. */}
      {validation?.issues.filter((i) => i.level === 'occurrence' && i.field !== 'conservation').map((issue, i) => (
        <div className="issue" data-severity={issue.severity} key={`${issue.field}-${i}`}>
          <p>{issue.message}</p>
          {issue.options && (
            <div className="row">
              {issue.options.map((o) => (
                <button key={o.label} className="btn" onClick={() => patch(o.patch)}>{o.label}</button>
              ))}
            </div>
          )}
          {!issue.options && issue.severity === 'pending' && (
            <button className="btn ghost" onClick={() => patch({ acknowledgedPending: [...draft.acknowledgedPending, issue.field] })}>
              Dejar pendiente
            </button>
          )}
        </div>
      ))}

      <button className="btn ghost" onClick={() => setExpanded(!expanded)} style={{ width: '100%', marginTop: 6 }}>
        {expanded ? 'Ocultar detalle' : 'Editar detalle'}
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`sp-${draft.draftId}`}>Especie</label>
            <input
              id={`sp-${draft.draftId}`} type="text" value={query}
              placeholder={taxon?.commonName ?? 'Buscar nombre común o científico'}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.length >= 2 && (
              <ul className="list">
                {(s.taxonIndex?.search(query, 6) ?? []).map((t) => (
                  <li key={t.id}>
                    <button className="btn ghost" style={{ width: '100%', textAlign: 'left' }}
                      onClick={() => { patch({ taxonId: t.id, taxonCandidates: [], verbatimTaxonText: t.commonName }); setQuery(''); }}>
                      {t.commonName} <span className="sci">{t.scientificName ?? ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid2">
            <Field label="Fecha"><input type="date" value={draft.eventDate ?? ''} onChange={(e) => patch({ eventDate: e.target.value })} /></Field>
            <Field label="Hora"><input type="time" value={draft.eventTime ?? ''} onChange={(e) => patch({ eventTime: e.target.value })} /></Field>
            <Field label="Tipo de registro">
              <Select value={draft.recordType ?? ''} options={vocab.recordType ?? []}
                onChange={(v) => patch({ recordType: v as never, recordTypeInferred: false })} />
            </Field>
            <Field label="Abundancia">
              <input type="number" min={0} value={draft.individualCount ?? ''}
                onChange={(e) => patch({ individualCount: e.target.value === '' ? null : Number(e.target.value), countInferred: false })} />
            </Field>
            <Field label="Sexo">
              <Select value={draft.sex ?? ''} options={vocab.sex ?? []} onChange={(v) => patch({ sex: v as never, sexScope: 'todos' })} />
            </Field>
            <Field label="Estado de desarrollo">
              <Select value={draft.lifeStage ?? ''} options={vocab.lifeStage ?? []} onChange={(v) => patch({ lifeStage: v as never, lifeStageScope: 'todos' })} />
            </Field>
            <Field label="Estado del organismo">
              <Select value={draft.organismCondition ?? ''} options={vocab.organismCondition ?? []} onChange={(v) => patch({ organismCondition: v as never })} />
            </Field>
            <Field label="Comportamiento">
              <Select value={draft.behaviour ?? ''} options={vocab.behaviour ?? []} onChange={(v) => patch({ behaviour: v })} />
            </Field>
            <Field label="Confianza de la identificación">
              <select value={draft.identificationConfidence}
                onChange={(e) => patch({ identificationConfidence: e.target.value as never })}>
                <option value="seguro">Seguro</option>
                <option value="probable">Probable (cf.)</option>
                <option value="posible">Posible (?)</option>
              </select>
            </Field>
            <Field label="Distancia de detección (m)">
              <input type="number" min={0} value={draft.detectionDistanceMeters ?? ''}
                onChange={(e) => patch({ detectionDistanceMeters: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            {pideReproductiva && (
              <Field label="Condición reproductiva">
                <Select value={draft.reproductiveCondition ?? ''}
                  options={vocab.reproductiveCondition ?? REPRODUCTIVA}
                  onChange={(v) => patch({ reproductiveCondition: v || null })} />
              </Field>
            )}
            <Field label="Código del individuo">
              <input type="text" value={draft.organismId ?? ''} placeholder="marca, anillo, chip"
                onChange={(e) => patch({ organismId: e.target.value || null })} />
            </Field>
          </div>

          {/* Trampeo: dónde cayó el animal. La línea es el sitio dentro de la
              estación; la trampa, el número dentro de la línea. */}
          {isTrapping && (
            <div className="grid2">
              <Field label="N° de trampa">
                <input type="text" value={draft.trapNumber ?? ''} placeholder="11"
                  onChange={(e) => patch({ trapNumber: e.target.value || null })} />
              </Field>
              <Field label="Línea o sitio">
                <select value={draft.siteId ?? ''} onChange={(e) => patch({ siteId: e.target.value || null })}>
                  <option value="">Sin especificar</option>
                  {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
                </select>
              </Field>
              <Field label="Recaptura">
                <select value={draft.recapture === null ? '' : String(draft.recapture)}
                  onChange={(e) => patch({ recapture: e.target.value === '' ? null : e.target.value === 'true' })}>
                  <option value="">Sin dato</option>
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </Field>
            </div>
          )}

          {/* Los campos de tránsito aéreo sólo existen en su metodología (§27). */}
          {isAerial && (
            <div className="grid2">
              <Field label="Origen"><Select value={draft.aerial?.origin ?? ''} options={vocab.flightDirection ?? []} onChange={(v) => patch({ aerial: { ...draft.aerial, origin: v } })} /></Field>
              <Field label="Destino"><Select value={draft.aerial?.destination ?? ''} options={vocab.flightDirection ?? []} onChange={(v) => patch({ aerial: { ...draft.aerial, destination: v, flightDirection: v } })} /></Field>
              <Field label="Categoría de altura"><Select value={draft.aerial?.flightHeightCategory ?? ''} options={vocab.flightHeightCategory ?? []} onChange={(v) => patch({ aerial: { ...draft.aerial, flightHeightCategory: v } })} /></Field>
              <Field label="Altura (m)">
                <input type="number" min={0} value={draft.aerial?.flightHeightMeters ?? ''}
                  onChange={(e) => patch({ aerial: { ...draft.aerial, flightHeightMeters: e.target.value === '' ? null : Number(e.target.value) } })} />
              </Field>
              {/* De noche la altura no se mide: se compara con algo que se ve.
                  Sin decir contra qué, el número no significa nada. */}
              {isNightAerial && (
                <>
                  <Field label="Referencia de altura">
                    <input type="text" value={draft.aerial?.heightReference ?? ''}
                      placeholder="sobre el cerro, bajo la torre"
                      onChange={(e) => patch({ aerial: { ...draft.aerial, heightReference: e.target.value || null } })} />
                  </Field>
                  <Field label="Tipo de vuelo">
                    <Select value={draft.aerial?.flightType ?? ''}
                      options={vocab.flightType ?? TIPO_VUELO}
                      onChange={(v) => patch({ aerial: { ...draft.aerial, flightType: v || null } })} />
                  </Field>
                  <Field label="Bloque horario">
                    <input type="text" value={draft.timeBlock ?? ''} placeholder="21:00 - 03:00"
                      onChange={(e) => patch({ timeBlock: e.target.value || null })} />
                  </Field>
                </>
              )}
            </div>
          )}

          <Field label="Observaciones">
            <textarea value={draft.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} />
          </Field>

          <label className="chip" style={{ marginBottom: 10 }}>
            <input type="checkbox" checked={draft.occurrenceFixRequested}
              onChange={(e) => patch({ occurrenceFixRequested: e.target.checked })} />
            Usar el GPS del avistamiento (distinto de la estación)
          </label>

          <PhotoButton draftId={draft.draftId} />
          <p className="muted" style={{ fontSize: 12 }}>
            Metodología: {METHOD_LABELS[draft.method ?? ''] ?? '—'} ·{' '}
            {taxon ? `${taxon.class ?? '—'} / ${taxon.order ?? '—'} / ${taxon.family ?? '—'} (completado automáticamente)` : 'taxonomía pendiente de identificar'}
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}

function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

/**
 * Fotografía asociada al registro.
 *
 * La foto no es sólo evidencia: trae en su EXIF la coordenada, la hora real y,
 * si la cámara lo permite, el código de estación. Todo eso se PROPONE al
 * usuario; nada se aplica solo.
 */
function PhotoButton({ draftId }: { draftId: string }) {
  const s = useStore();
  const draft = s.drafts.find((d) => d.draftId === draftId)!;
  const [suggestions, setSuggestions] = useState<PhotoSuggestion[]>([]);
  const [saved, setSaved] = useState<{ from: number; to: number } | null>(null);

  const stationCodes = s.stations.filter((st) => st.projectId === s.projectId).map((st) => st.stationCode);

  return (
    <div className="field">
      <label htmlFor={`ph-${draftId}`}>Fotografías ({draft.mediaIds.length})</label>
      <input
        id={`ph-${draftId}`} type="file" accept="image/*" capture="environment" multiple
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          const ids: string[] = [];
          const found: PhotoSuggestion[] = [];
          let from = 0;
          let to = 0;

          for (const file of files) {
            const prepared = await preparePhoto(file);
            from += prepared.originalBytes;
            to += prepared.bytes;
            const media = await attachMedia({
              occurrenceId: null, eventId: null, kind: 'foto',
              mimeType: prepared.blob.type || 'image/jpeg', blob: prepared.blob,
              capturedAt: prepared.metadata.takenAt ?? new Date().toISOString(),
              // La posición de la foto manda sobre la del dispositivo: es la
              // del momento exacto del avistamiento.
              fix: prepared.fix ?? s.fix,
              headingDegrees: prepared.metadata.headingDegrees,
              exif: prepared.metadata as unknown as Record<string, unknown>,
              fileName: file.name,
            }, s.session);
            ids.push(media.id);
            found.push(suggestionFrom(prepared, stationCodes));
          }

          s.patchDraft(draftId, { mediaIds: [...draft.mediaIds, ...ids] });
          setSaved({ from, to });
          setSuggestions(found.filter((f) => f.fix || f.stationCode || f.time));
        }}
      />

      {saved && saved.from > saved.to && (
        <span className="muted" style={{ fontSize: 12 }}>
          Comprimida de {mb(saved.from)} a {mb(saved.to)} para que quepa en el respaldo.
        </span>
      )}

      {suggestions.map((sug, i) => (
        <div className="issue" data-severity="question" key={i}>
          <p>La foto trae datos propios. ¿Los usamos?</p>
          <ul className="list" style={{ marginBottom: 8 }}>
            {sug.stationCode && <li><span className="meta">Estación</span><span className="name">{sug.stationCode}</span></li>}
            {sug.time && <li><span className="meta">Hora</span><span className="name">{sug.date} {sug.time}</span></li>}
            {sug.fix && (
              <li>
                <span className="meta">Coordenada</span>
                <span className="name">
                  {utmLabel(sug.fix, s.projects.find((p) => p.id === s.projectId)?.utmZone)}
                  {sug.fix.accuracyMeters != null ? ` ±${Math.round(sug.fix.accuracyMeters)} m` : ''}
                </span>
              </li>
            )}
          </ul>
          <div className="row">
            <button className="btn primary" onClick={() => {
              const station = s.stations.find((st) => st.stationCode === sug.stationCode);
              s.patchDraft(draftId, {
                ...(station ? { stationId: station.id } : {}),
                ...(sug.date ? { eventDate: sug.date } : {}),
                ...(sug.time ? { eventTime: sug.time } : {}),
                ...(sug.fix ? { occurrenceFixRequested: true } : {}),
              });
              setSuggestions((prev) => prev.filter((_, k) => k !== i));
            }}>Usar los datos de la foto</button>
            <button className="btn ghost" onClick={() => setSuggestions((prev) => prev.filter((_, k) => k !== i))}>
              Dejar como está
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const mb = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;

function utmLabel(fix: { latitude: number; longitude: number }, zone?: number): string {
  const utm = toUtm(fix.latitude, fix.longitude, zone);
  return `UTM ${utm.zone}${utm.hemisphere} ${Math.round(utm.east)} / ${Math.round(utm.north)}`;
}

function recordGlyph(recordType: string | null): string {
  switch (recordType) {
    case 'Vocalización': case 'Registro de audio': return '🔊';
    case 'Fecas': case 'Huella': case 'Plumas': case 'Muda': case 'Huesos': case 'Egagrópila': return '🐾';
    case 'Madriguera': case 'Cururera': case 'Nido': return '🕳️';
    default: return '👁️';
  }
}
