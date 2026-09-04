/**
 * Revisión y corrección de registros (brief §17 y §18).
 * Editar, duplicar y eliminar; el borrado es lógico y queda en la auditoría.
 */
import { useState } from 'react';
import { flagFor } from '../../conservation/status';
import { useStore } from '../../state/store';

export function Registros() {
  const s = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const rows = onlyPending ? s.records.filter((r) => r.occurrence.pendingFields.length > 0) : s.records;
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDate.get(r.event.eventDate) ?? [];
    list.push(r);
    byDate.set(r.event.eventDate, list);
  }

  return (
    <>
      <section className="card">
        <h2>Registros ({rows.length})</h2>
        <label className="chip">
          <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
          Sólo con información pendiente
        </label>
      </section>

      {[...byDate.entries()].map(([date, list]) => (
        <section className="card" key={date}>
          <h2>{date}</h2>
          <ul className="list">
            {list.map((r) => (
              <li key={r.occurrence.id} style={{ flexWrap: 'wrap' }}>
                <span className="time">{r.occurrence.occurrenceTime}</span>
                <span className="name">
                  {r.taxon?.commonName ?? r.occurrence.verbatimTaxonText ?? '—'}
                  {r.taxon?.scientificName && <div className="sci" style={{ fontSize: 12 }}>{r.taxon.scientificName}</div>}
                </span>
                <span className="meta">
                  {r.station?.stationCode ?? '—'} · {r.occurrence.recordType}
                  {r.occurrence.individualCount != null ? ` ×${r.occurrence.individualCount}` : ''}
                </span>
                {flagFor(r.taxon).level === 'amenazada' && <span className="chip error" title={flagFor(r.taxon).detail ?? ''}>⚠️</span>}
                {r.occurrence.reviewState === 'validado' && <span className="chip ok" title="Validado">✔</span>}
                <span className={`dot ${r.occurrence.syncState}`} />
                <button className="btn ghost" style={{ flex: '0 0 auto', minHeight: 40, padding: '6px 12px' }}
                  onClick={() => setOpenId(openId === r.occurrence.id ? null : r.occurrence.id)}>
                  {openId === r.occurrence.id ? 'Cerrar' : 'Abrir'}
                </button>

                {openId === r.occurrence.id && (
                  <div style={{ flexBasis: '100%', paddingTop: 10 }}>
                    {r.occurrence.pendingFields.length > 0 && (
                      <p className="chip warn">Pendiente: {r.occurrence.pendingFields.join(', ')}</p>
                    )}
                    {r.occurrence.verbatimUtterance && (
                      <p className="muted" style={{ fontSize: 13 }}>Dictado: “{r.occurrence.verbatimUtterance}”</p>
                    )}
                    <div className="grid2">
                      <div className="field">
                        <label>Abundancia</label>
                        <input type="number" min={0} defaultValue={r.occurrence.individualCount ?? ''}
                          onBlur={(e) => void s.editRecord(r.occurrence.id, {
                            individualCount: e.target.value === '' ? null : Number(e.target.value),
                            pendingFields: r.occurrence.pendingFields.filter((f) => f !== 'individualCount'),
                          })} />
                      </div>
                      <div className="field">
                        <label>Comportamiento</label>
                        <select defaultValue={r.occurrence.behaviour ?? ''}
                          onChange={(e) => void s.editRecord(r.occurrence.id, { behaviour: e.target.value || null })}>
                          <option value="">—</option>
                          {(s.vocabularies.behaviour ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>Observaciones</label>
                      <textarea defaultValue={r.occurrence.notes ?? ''}
                        onBlur={(e) => void s.editRecord(r.occurrence.id, { notes: e.target.value || null })} />
                    </div>
                    {/* Flujo de gabinete: terreno → revisado → validado.
                        Un registro validado es el que ya puede ir al informe. */}
                    <div className="field">
                      <label>Estado de revisión</label>
                      <select value={r.occurrence.reviewState ?? 'terreno'}
                        onChange={(e) => void s.reviewRecord(r.occurrence.id, e.target.value as never)}>
                        <option value="terreno">Terreno (sin revisar)</option>
                        <option value="revisado">Revisado</option>
                        <option value="validado">Validado para el informe</option>
                      </select>
                      {r.occurrence.reviewedBy && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          por {r.occurrence.reviewedBy} el {r.occurrence.reviewedAt?.slice(0, 16).replace('T', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="row">
                      <button className="btn" onClick={() => void s.duplicateRecord(r.occurrence.id)}>Duplicar</button>
                      <button className="btn danger" onClick={() => void s.removeRecord(r.occurrence.id)}>Eliminar</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.length === 0 && <section className="card"><p className="muted">Sin registros.</p></section>}
    </>
  );
}
