/**
 * Resumen de terreno y salida de datos (brief §21 y §22).
 * Cierra la jornada: qué se registró, qué quedó pendiente, y exportación.
 */
import { useEffect, useMemo, useState } from 'react';
import { coverage } from '../../conservation/status';
import { backupFileName, createBackup, restoreBackup } from '../../db/backup';
import { db } from '../../db/db';
import type { Taxon } from '../../domain/types';
import { buildDwcArchive, toCsv } from '../../export/dwca';
import { buildWorkbook, workbookToBlob } from '../../export/workbook';
import { countSensitive, type SensitivityPolicy } from '../../export/sensitive';
import { METHOD_LABEL } from '../../export/fields';
import { flatten, type Catalogs } from '../../export/shape';
import { pending as pendingPlan } from '../../plan/coverage';
import { tallyBySpecies } from '../../quality/report';
import { retryFailed } from '../../sync/engine';
import { useStore } from '../../state/store';
import { downloadBlob, zip } from '../download';

/** Sin backend configurado la app queda offline a propósito: nada se pierde. */
function transportFor(endpoint: string | null) {
  return {
    isOnline: () => Boolean(endpoint) && globalThis.navigator?.onLine !== false,
    async push(item: { entity: string; entityId: string }, payload: unknown) {
      const res = await fetch(`${endpoint}/${item.entity}/${item.entityId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const remote = await res.json();
        return { status: 'conflict' as const, remoteRevision: Number(remote.revision ?? 0), remote };
      }
      if (res.ok) return { status: 'ok' as const, revision: 0 };
      if (res.status >= 500) return { status: 'retry' as const, message: `HTTP ${res.status}` };
      return { status: 'error' as const, message: `HTTP ${res.status}` };
    },
  };
}

export function Resumen() {
  const s = useStore();
  const [endpoint, setEndpoint] = useState<string>(() => globalThis.localStorage?.getItem('proterr.endpoint') ?? '');
  const [policy, setPolicy] = useState<SensitivityPolicy>('exacta');
  const [includeMedia, setIncludeMedia] = useState(true);
  useEffect(() => { void s.refreshQuality(); }, [s.records.length]);
  const today = new Date().toISOString().slice(0, 10);
  const todays = s.records.filter((r) => r.event.eventDate === today);

  const pendingRows = useMemo(() => (s.plan ? pendingPlan(s.plan) : []), [s.plan]);
  const stats = useMemo(() => ({
    stations: new Set(todays.map((r) => r.event.stationId)).size,
    records: todays.length,
    species: new Set(todays.map((r) => r.taxon?.id ?? r.occurrence.verbatimTaxonText).filter(Boolean)).size,
    needReview: todays.filter((r) => r.occurrence.pendingFields.length > 0).length,
    noPhoto: todays.filter((r) => r.occurrence.mediaIds.length === 0).length,
    noCount: todays.filter((r) => r.occurrence.individualCount === null && r.occurrence.evidenceKind === 'Directo').length,
  }), [todays]);

  const speciesTable = useMemo(() => {
    const taxa = new Map<string, Taxon>();
    for (const r of s.records) if (r.taxon) taxa.set(r.taxon.id, r.taxon);
    return tallyBySpecies(s.records.map((r) => r.occurrence), taxa);
  }, [s.records]);

  async function collect() {
    const occurrences = (await db.occurrences.toArray()).filter((o) => !o.deletedAt);
    const events = new Map((await db.events.toArray()).map((e) => [e.id, e]));
    const catalogs: Catalogs = {
      projects: new Map((await db.projects.toArray()).map((p) => [p.id, p])),
      campaigns: new Map((await db.campaigns.toArray()).map((c) => [c.id, c])),
      stations: new Map(s.stations.map((st) => [st.id, st])),
      taxa: new Map((await db.taxa.toArray()).map((t) => [t.id, t])),
    };
    return {
      records: flatten(occurrences, events, catalogs, await db.measurements.toArray()),
      events: [...events.values()],
    };
  }

  return (
    <>
      <section className="card">
        <h2>Resumen · {today}</h2>
        <div className="stat">
          <div><b>{stats.stations}</b><span>Estaciones</span></div>
          <div><b>{stats.records}</b><span>Registros</span></div>
          <div><b>{stats.species}</b><span>Especies</span></div>
        </div>
      </section>

      {/* La campaña no es lo que se encontró: es una grilla de estaciones por
          metodología. Lo que falta y lo que no se pudo hacer son datos. */}
      {s.plan && s.plan.planned > 0 && (
        <section className="card">
          <h2>Cobertura del plan</h2>
          <div className="stat">
            <div><b>{s.plan.done}</b><span>Realizadas</span></div>
            <div><b>{s.plan.notPerformed}</b><span>No realizadas</span></div>
            <div><b>{s.plan.pending}</b><span>Pendientes</span></div>
          </div>
          <p style={{ margin: '8px 0 0' }}>
            <span className="chip ok">{Math.round(s.plan.coverage * 100)}% del plan</span>{' '}
            <span className="chip">{s.plan.planned} celdas planificadas</span>
            {s.plan.offPlan.length > 0 && (
              <> <span className="chip warn">{s.plan.offPlan.length} muestreo(s) fuera del plan</span></>
            )}
          </p>
          {s.plan.notPerformed > 0 && (
            <ul className="issues" style={{ marginTop: 8 }}>
              {s.plan.rows.filter((r) => r.state === 'no realizado').slice(0, 8).map((r) => (
                <li key={`${r.station.id}-${r.method}`}>
                  <b>{r.station.stationCode}</b> · {METHOD_LABEL[r.method]} — no se realizó
                  {r.reason ? `: ${r.reason}` : ' (sin motivo declarado)'}
                </li>
              ))}
            </ul>
          )}
          {pendingRows.length > 0 && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              Falta: {pendingRows.slice(0, 10).map((r) => `${r.station.stationCode} (${METHOD_LABEL[r.method]})`).join(', ')}
              {pendingRows.length > 10 ? `… y ${pendingRows.length - 10} más` : ''}
            </p>
          )}
        </section>
      )}

      <section className="card">
        <h2>Pendientes</h2>
        {stats.needReview === 0 && stats.noPhoto === 0 && stats.noCount === 0 && <p className="muted">Nada pendiente.</p>}
        {stats.needReview > 0 && <p className="chip warn">⚠️ {stats.needReview} registro(s) requieren revisión</p>}
        {stats.noPhoto > 0 && <p className="chip">📷 {stats.noPhoto} registro(s) sin fotografía</p>}
        {stats.noCount > 0 && <p className="chip warn">🔢 {stats.noCount} registro(s) sin abundancia</p>}
        <button className="btn" style={{ marginTop: 8 }} onClick={() => s.setScreen('registros')}>Revisar pendientes</button>
      </section>

      <section className="card">
        <h2>Sincronización</h2>
        <p>
          <span className="chip ok"><span className="dot synced" /> {s.records.filter((r) => r.occurrence.syncState === 'synced').length} sincronizados</span>{' '}
          <span className="chip warn"><span className="dot pending" /> {s.sync.pending} pendientes</span>{' '}
          <span className="chip error"><span className="dot error" /> {s.sync.errored + s.sync.conflicts} con error</span>
        </p>
        <div className="field">
          <label htmlFor="ep">Servidor de sincronización (vacío = sólo local)</label>
          <input id="ep" type="text" value={endpoint} placeholder="https://api.ejemplo.cl/proterr"
            onChange={(e) => { setEndpoint(e.target.value); globalThis.localStorage?.setItem('proterr.endpoint', e.target.value); }} />
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => void s.runSync(transportFor(endpoint || null))}>Sincronizar</button>
          <button className="btn ghost" onClick={async () => { const n = await retryFailed(); s.notify(`${n} reintento(s) reencolados.`); }}>
            Reintentar fallidos
          </button>
        </div>
      </section>

      {s.quality && s.quality.issues.length > 0 && (
        <section className="card">
          <h2>Calidad del dato ({s.quality.issues.length})</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            Lo que conviene resolver antes de entregar. La planilla no podía detectar nada de esto.
          </p>
          <ul className="list">
            {s.quality.issues.slice(0, 10).map((i, k) => (
              <li key={k}>
                <span className={`chip ${i.severity === 'alta' ? 'error' : i.severity === 'media' ? 'warn' : ''}`}>{i.kind}</span>
                <span className="name" style={{ fontWeight: 400 }}>{i.message}</span>
              </li>
            ))}
          </ul>
          {s.quality.issues.length > 10 && <p className="muted">…y {s.quality.issues.length - 10} más.</p>}
        </section>
      )}

      {speciesTable.length > 0 && (
        <section className="card">
          <h2>Especies registradas ({speciesTable.length})</h2>
          <ul className="list">
            {speciesTable.slice(0, 12).map((row) => (
              <li key={row.name}>
                <span className="name">
                  {row.name}
                  {row.scientificName && <div className="sci" style={{ fontSize: 12 }}>{row.scientificName}</div>}
                </span>
                {row.threatened && <span className="chip error">amenazada</span>}
                {row.exotic && <span className="chip warn">exótica</span>}
                <span className="meta">{row.individuals} ind · {row.records} reg</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Respaldo local</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Un archivo con todo: registros, esfuerzo, auditoría y cola de sincronización.
          La exportación a Excel no sirve de respaldo, porque pierde todo eso.
        </p>
        <label className="chip" style={{ marginBottom: 10 }}>
          <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
          Incluir fotografías (archivo más pesado)
        </label>
        <div className="row">
          <button className="btn primary" onClick={async () => {
            const project = s.projects.find((p) => p.id === s.projectId);
            const backup = await createBackup(s.session.deviceId, { includeMedia });
            downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), backupFileName(project?.code ?? 'proyecto'));
            s.notify(`Respaldo con ${backup.counts.occurrences ?? 0} registro(s).`);
          }}>Crear respaldo</button>
          <label className="btn ghost" style={{ display: 'grid', placeItems: 'center' }}>
            Restaurar
            <input type="file" accept=".json" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const report = await restoreBackup(JSON.parse(await file.text()), 'fusionar');
                await s.refreshRecords();
                const added = Object.values(report.inserted).reduce((a, b) => a + b, 0);
                s.notify(
                  report.conflicts.length
                    ? `${added} restaurados; ${report.conflicts.length} conflicto(s) conservaron la versión local.`
                    : `${added} registro(s) restaurados.`,
                  report.conflicts.length ? 'warn' : 'ok',
                );
              } catch (err) {
                s.notify(err instanceof Error ? err.message : 'No se pudo leer el respaldo.', 'error');
              }
            }} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Exportar</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          La base interna no depende de Excel; Excel es una salida más, junto a CSV y Darwin Core.
        </p>
        <div className="field">
          <label htmlFor="tpl">Formato del Excel</label>
          <select id="tpl" value={s.templateId} onChange={(e) => s.selectTemplate(e.target.value)}>
            {s.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.organization ? ` · ${t.organization}` : ''}</option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            Puedes cargar el formulario de tu consultora en Ajustes y exportar con ese formato.
          </span>
        </div>
        <div className="field">
          <label htmlFor="pol">Coordenadas de especies sensibles</label>
          <select id="pol" value={policy} onChange={(e) => setPolicy(e.target.value as SensitivityPolicy)}>
            <option value="exacta">Exactas — uso interno del proyecto</option>
            <option value="generalizada">Generalizadas a ~1 km — entrega a terceros</option>
            <option value="omitida">Omitidas — publicación abierta</option>
          </select>
          <SensitiveCount policy={policy} collect={collect} />
        </div>
        <div className="row">
          <button className="btn" onClick={async () => {
            const { records, events } = await collect();
            const project = s.projects.find((p) => p.id === s.projectId);
            const template = s.templates.find((t) => t.id === s.templateId) ?? s.templates[0];
            const wb = buildWorkbook(records, template, {
              events,
              // Sin las estaciones no hay plan: la hoja saldría sólo con lo hecho.
              stations: s.stations.filter((st) => st.projectId === s.projectId),
              placeholders: {
                cliente: project?.client ?? '', proyecto: project?.name ?? '',
                codigo: project?.code ?? '', evaluador: s.session.userName,
                fecha: today, huso: String(project?.utmZone ?? ''),
              },
            });
            downloadBlob(workbookToBlob(wb), `${slug(template.name)}_${project?.code ?? 'proyecto'}_${today}.xlsx`);
          }}>Excel · {(s.templates.find((t) => t.id === s.templateId) ?? s.templates[0]).name}</button>

          <button className="btn" onClick={async () => {
            const { records } = await collect();
            downloadBlob(new Blob([toCsv(records, policy)], { type: 'text/csv' }), `ProTerr_${today}.csv`);
          }}>CSV</button>

          <button className="btn" onClick={async () => {
            const { records, events } = await collect();
            const project = s.projects.find((p) => p.id === s.projectId);
            const archive = buildDwcArchive(records, {
              title: `Línea base de fauna — ${project?.name ?? 'ProTerr'}`,
              contact: s.session.userName, policy, events,
            });
            downloadBlob(await zip(archive), `ProTerr_DwC-A_${today}.zip`);
          }}>Darwin Core Archive</button>
        </div>
        <ConservationCoverage />
      </section>
    </>
  );
}

const slug = (v: string): string =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Cuántos registros cambiarían con la política elegida, antes de exportar. */
function SensitiveCount({ policy, collect }: { policy: SensitivityPolicy; collect: () => Promise<{ records: Parameters<typeof countSensitive>[0] }> }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { void collect().then(({ records }) => setCount(countSensitive(records))); }, [policy]);
  if (count === null || count === 0) return null;
  return (
    <span className="muted" style={{ fontSize: 12 }}>
      {policy === 'exacta'
        ? `${count} registro(s) de especies sensibles saldrán con coordenada exacta.`
        : `${count} registro(s) de especies sensibles se ${policy === 'omitida' ? 'exportarán sin coordenada' : 'generalizarán'}.`}
    </span>
  );
}

/** Cuánto del catálogo tiene clasificación de conservación cargada. */
function ConservationCoverage() {
  const s = useStore();
  const stats = useMemo(() => (s.taxonIndex ? coverage(s.taxonIndex.all()) : null), [s.taxonIndex]);
  if (!stats) return null;
  return (
    <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
      Capa de conservación: {stats.classified} de {stats.total} taxones clasificados
      ({stats.threatened} en categoría de amenaza).
      {stats.sources.length > 0 && ` Fuente: ${stats.sources.join(', ')}.`}
      {stats.classified < stats.total && ' El resto figura como "sin clasificar", que no es lo mismo que sin riesgo.'}
    </p>
  );
}
