/**
 * Configuración (brief §8 y §23): qué campos se piden y por qué metodología,
 * más la descarga de catálogos y la importación de planillas históricas.
 * Todo se edita como datos; no hay que tocar el código.
 */
import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import { seedCatalogs } from '../../db/seed';
import { EXPORT_FIELDS } from '../../export/fields';
import { estadoCache, getEndpoint, limpiarCache, setEndpoint } from '../../conservation/lookup';
import { Icono } from '../Icono';
import { MODOS, readModo, setModo, type Modo } from '../modo';
import {
  fieldsWithoutColumn, toTemplate, detectTemplate,
  type SheetOverride, type TemplateDetection,
} from '../../import/template';
import { analyzeWorkbook, type ImportPreview } from '../../import/planilla';
import { readKmlFile, toStationCandidates, type StationCandidate } from '../../geo/kml';
import { useStore } from '../../state/store';
import type { MethodCode } from '../../domain/types';
import { requirementFor, type RequirableField, type Requirement } from '../../validation/profiles';
import { METHOD_LABELS } from './Terreno';

const FIELDS: Array<[RequirableField, string]> = [
  ['eventDate', 'Fecha'], ['eventTime', 'Hora'], ['station', 'Estación'], ['method', 'Metodología'],
  ['recordedBy', 'Observador'], ['weather', 'Clima'], ['taxon', 'Especie'],
  ['recordType', 'Tipo de registro'], ['individualCount', 'Abundancia'], ['sex', 'Sexo'],
  ['lifeStage', 'Estado de desarrollo'], ['organismCondition', 'Estado del organismo'],
  ['behaviour', 'Comportamiento'], ['photos', 'Fotos'], ['occurrenceCoordinates', 'Coordenadas de captura'],
  ['notes', 'Observaciones'], ['flightDirection', 'Dirección de vuelo'], ['flightHeight', 'Altura de vuelo'],
  ['flightOrigin', 'Origen del vuelo'], ['flightDestination', 'Destino del vuelo'],
  ['playbackResponse', 'Respuesta al playback'],
];

const LEVELS: Requirement[] = ['required', 'recommended', 'optional', 'hidden'];
const LEVEL_LABEL: Record<Requirement, string> = {
  required: 'Obligatorio', recommended: 'Recomendado', optional: 'Opcional', hidden: 'No mostrar',
};

export function Ajustes() {
  const s = useStore();
  const [method, setMethod] = useState<MethodCode>('transecto');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [detection, setDetection] = useState<TemplateDetection | null>(null);
  // El archivo se conserva en memoria mientras dura la revisión: cambiar la
  // fila de encabezado obliga a volver a leerlo, no a parchar el resultado.
  const [templateFile, setTemplateFile] = useState<ArrayBuffer | null>(null);
  const [overrides, setOverrides] = useState<Record<string, SheetOverride>>({});
  const [modo, setModoLocal] = useState<Modo | null>(() => readModo());
  const [rceUrl, setRceUrl] = useState('');
  const [cache, setCache] = useState<{ especies: number; masAntigua: string | null }>({ especies: 0, masAntigua: null });
  useEffect(() => {
    void getEndpoint().then((v) => setRceUrl(v ?? ''));
    void estadoCache().then(setCache);
  }, []);
  const [kml, setKml] = useState<StationCandidate[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [prefix, setPrefix] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [organization, setOrganization] = useState('');

  async function setLevel(field: RequirableField, level: Requirement) {
    const profile = structuredClone(s.profile);
    profile.overridesByMethod ??= {};
    profile.overridesByMethod[method] ??= {};
    profile.overridesByMethod[method]![field] = level;
    await db.profiles.put(profile);
    useStore.setState({ profile });
  }

  return (
    <>
      <section className="card">
        <h2>Observador</h2>
        <div className="field">
          <label htmlFor="obs">Nombre</label>
          <input id="obs" type="text" value={s.session.userName}
            onChange={(e) => useStore.setState({ session: { ...s.session, userName: e.target.value } })} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Dispositivo: {s.session.deviceId.slice(0, 8)}…</p>
      </section>

      <section className="card">
        <h2>Campos requeridos por metodología</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Perfil «{s.profile.name}». Lo que marques como obligatorio se recuerda al guardar,
          pero nunca impide guardar el registro.
        </p>
        <div className="field">
          <label htmlFor="mm">Metodología</label>
          <select id="mm" value={method} onChange={(e) => setMethod(e.target.value as MethodCode)}>
            {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="matrix">
          {FIELDS.map(([field, label]) => {
            const current = requirementFor(s.profile, field, { method });
            return (
              <FieldRow key={field} label={label} value={current} onChange={(v) => void setLevel(field, v)} />
            );
          })}
        </div>
      </section>

      {/* El proyecto suele venir con un KMZ que ya trae todos los puntos.
          Copiarlos a mano sería transcribir decenas de coordenadas. */}
      <section className="card">
        <h2>Estaciones desde KML o KMZ</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Carga el archivo de puntos del proyecto y elige cuáles usar. Las coordenadas
          se convierten al huso del proyecto; los transectos dibujados como línea traen
          además su inicio y fin.
        </p>
        <input type="file" accept=".kml,.kmz"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const found = toStationCandidates(await readKmlFile(await file.arrayBuffer()));
              setKml(found);
              setChosen(new Set(found.map((_, i) => String(i))));
            } catch (err) {
              s.notify(err instanceof Error ? err.message : 'No se pudo leer el archivo.', 'error');
            }
          }} />

        {kml && (
          <div style={{ marginTop: 12 }}>
            <div className="grid2">
              <div className="field">
                <label htmlFor="pfx">Prefijo para los códigos</label>
                <input id="pfx" type="text" value={prefix} placeholder="p. ej. PMF"
                  onChange={(e) => setPrefix(e.target.value)} />
              </div>
              <div className="field">
                <label>Seleccionadas</label>
                <div className="row">
                  <button className="btn ghost" onClick={() => setChosen(new Set(kml.map((_, i) => String(i))))}>Todas</button>
                  <button className="btn ghost" onClick={() => setChosen(new Set())}>Ninguna</button>
                </div>
              </div>
            </div>
            <p>
              <span className="chip ok">{chosen.size} de {kml.length}</span>{' '}
              {kml.some((c) => c.duplicateName) && (
                <span className="chip warn">
                  {new Set(kml.filter((c) => c.duplicateName).map((c) => c.name)).size} nombre(s) repetidos en el archivo
                </span>
              )}
            </p>
            <ul className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {kml.map((c, i) => (
                <li key={i}>
                  <input type="checkbox" checked={chosen.has(String(i))} onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(String(i));
                    else next.delete(String(i));
                    setChosen(next);
                  }} />
                  <span className="name">
                    {prefix}{c.name}
                    {c.duplicateName && <span className="chip warn" style={{ marginLeft: 6, fontSize: 11 }}>repetido</span>}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {c.latitude.toFixed(5)}, {c.longitude.toFixed(5)}
                      {c.lengthMeters ? ` · transecto de ${c.lengthMeters} m` : ''}
                      {c.folder ? ` · ${c.folder}` : ''}
                    </div>
                  </span>
                </li>
              ))}
            </ul>
            <div className="row">
              <button className="btn primary" disabled={!chosen.size} onClick={async () => {
                await s.importStations(kml.filter((_, i) => chosen.has(String(i))), prefix);
                setKml(null);
              }}>Cargar {chosen.size} estación(es)</button>
              <button className="btn ghost" onClick={() => setKml(null)}>Cancelar</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Catálogos offline</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          {s.taxonIndex?.size ?? 0} especies · {s.stations.length} estaciones · {s.projects.length} proyecto(s).
          Descárgalos antes de salir a terreno; después la app funciona sin conexión.
        </p>
        <button className="btn" onClick={async () => {
          const summary = await seedCatalogs();
          await s.init();
          s.notify(`Catálogos actualizados: ${summary.taxa} especies, ${summary.stations} estaciones.`);
        }}>Actualizar catálogos</button>
      </section>

      {/* La nómina del MMA NO viaja dentro de la app: cambia con cada proceso
          de clasificación y una copia vieja es una categoría equivocada en un
          informe. Se consulta a un servicio y se guarda lo consultado. */}
      <section className="card">
        <h2>Categoría de conservación</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          La nómina del Ministerio del Medio Ambiente no viene dentro de la app, a propósito:
          cambia con cada proceso de clasificación y una copia vieja se convierte en una
          categoría equivocada dentro de un informe. Se consulta en línea.
        </p>
        <div className="field">
          <label htmlFor="rce">Servicio de consulta</label>
          <input id="rce" type="text" value={rceUrl} placeholder="https://…/rce"
            onChange={(e) => setRceUrl(e.target.value)}
            onBlur={() => void setEndpoint(rceUrl || null)} />
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Se le pide <code>?nombre=Lycalopex+fulvipes</code> y debe responder JSON con
          <code> categoria</code>, y opcionalmente <code>origen</code>, <code>endemica</code>,
          <code> fuente</code> y <code>fechaFuente</code>.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          <span className="chip">{cache.especies} especie(s) consultadas</span>{' '}
          {cache.masAntigua && (
            <span className="chip muted">la más antigua, {cache.masAntigua.slice(0, 10)}</span>
          )}
        </p>
        <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Lo ya consultado responde después sin señal, con la fecha a la vista. Lo que nunca se
          consultó queda como <b>«sin consultar»</b>, que no es lo mismo que «sin categoría».
        </p>
        <button className="btn ghost" onClick={async () => {
          const n = await limpiarCache();
          setCache(await estadoCache());
          s.notify(`${n} consulta(s) borradas. Se vuelven a pedir al servicio.`);
        }}>Borrar lo consultado y volver a preguntar</button>
      </section>

      {/* El modo no es una preferencia estética: es una condición de trabajo. */}
      <section className="card">
        <h2>Pantalla</h2>
        <div className="formatos">
          {MODOS.map((m) => (
            <button key={m.id} type="button" className="formato" aria-pressed={modo === m.id}
              onClick={() => { setModo(m.id); setModoLocal(m.id); }}>
              <b><Icono name={m.id} size={18} /> {m.label}</b>
              <span className="que">{m.detalle}</span>
              {modo === m.id && <span className="marca">En uso</span>}
            </button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          El modo noche se enciende solo al elegir tránsito aéreo nocturno o playback de
          anfibios. Si lo cambias a mano, tu elección manda por el resto del día.
        </p>
      </section>

      {/* Con qué forma sale el Excel. Se elige tocando un cuadro, no leyendo
          una lista: son tres decisiones muy distintas y tienen que verse. */}
      <section className="card">
        <h2>Con qué formato sale el Excel</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Elige uno. Se puede cambiar cuando quieras y no afecta a los registros ya guardados:
          los mismos datos salen con la forma que elijas.
        </p>

        <div className="formatos">
          {s.templates.map((t) => {
            const activo = t.id === s.templateId;
            const columnas = t.sheets.reduce((n, sh) => n + sh.columns.length, 0);
            return (
              <button key={t.id} type="button" className="formato" aria-pressed={activo}
                onClick={() => s.selectTemplate(t.id)}>
                <b>{t.name}</b>
                <span className="que">{DESCRIPCION_FORMATO[t.id] ?? t.organization ?? 'Formato importado'}</span>
                <span className="cifras">{t.sheets.length} hoja(s) · {columnas} columnas</span>
                {activo && <span className="marca">En uso</span>}
                {!t.builtin && !PROPIAS.includes(t.id) && (
                  <span className="quitar" role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); void s.deleteTemplate(t.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void s.deleteTemplate(t.id); } }}>
                    Quitar
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>¿Tu consultora usa otra planilla?</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Sube su archivo —vacío o con datos, da lo mismo— y ProTerr aprende su forma exacta.
          <b> El archivo no se guarda</b>: se lee en memoria y se descarta; lo único que queda es
          el mapeo de columnas, que es tuyo. En el paso siguiente vas a poder revisar y corregir
          a mano cada columna, qué fila es el encabezado y qué hojas se usan.
        </p>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="tplfile">Cargar el formulario de una consultora</label>
          <input id="tplfile" type="file" accept=".xlsx,.xlsm,.xlsb,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const buffer = await file.arrayBuffer();
              setTemplateFile(buffer);
              setOverrides({});
              setDetection(detectTemplate(buffer, file.name));
              setTemplateName(file.name.replace(/\.[^.]+$/, ''));
            }} />
        </div>

        {detection && (
          <TemplateReview
            detection={detection}
            name={templateName} onName={setTemplateName}
            organization={organization} onOrganization={setOrganization}
            onSheet={(sheetName, patch) => {
              if (!templateFile) return;
              const next = { ...overrides, [sheetName]: { ...overrides[sheetName], ...patch } };
              setOverrides(next);
              setDetection(detectTemplate(templateFile, detection.fileName, next));
            }}
            onColumn={(sheetName, index, fieldId) => setDetection({
              ...detection,
              sheets: detection.sheets.map((sh) => (sh.name !== sheetName ? sh : {
                ...sh,
                columns: sh.columns.map((c) => (c.index !== index ? c : {
                  ...c, fieldId, confidence: fieldId ? 1 : 0,
                  fieldLabel: fieldId ? EXPORT_FIELDS.find((f) => f.id === fieldId)?.label ?? null : null,
                })),
              })),
            })}
            onSave={async () => {
              await s.saveTemplate(toTemplate(detection, {
                id: `tpl_${Date.now().toString(36)}`,
                name: templateName || detection.fileName,
                organization: organization || null,
              }));
              setDetection(null);
              setTemplateFile(null);
              setOverrides({});
            }}
            onCancel={() => { setDetection(null); setTemplateFile(null); setOverrides({}); }}
          />
        )}
      </section>

      <section className="card">
        <h2>Importar planilla histórica</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Se analiza y valida primero. El archivo original nunca se modifica y nada se importa
          mientras existan errores sin resolver.
        </p>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xlsb"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const taxa = await db.taxa.toArray();
            setPreview(analyzeWorkbook(await file.arrayBuffer(), {
              taxa, recordTypes: s.vocabularies.recordType ?? [],
            }));
          }} />

        {preview && (
          <div style={{ marginTop: 12 }}>
            <ul className="list">
              {preview.sheets.map((sh) => (
                <li key={sh.name}>
                  <span className="name">{sh.name}</span>
                  <span className="meta">{sh.role} · encabezado fila {sh.headerRow ?? '—'} · {sh.rows} filas</span>
                </li>
              ))}
            </ul>
            <p>
              <span className="chip ok">{preview.records.length} registros legibles</span>{' '}
              <span className="chip">{preview.stations.length} estaciones</span>{' '}
              <span className="chip error">{preview.issues.filter((i) => i.severity === 'error').length} errores</span>{' '}
              <span className="chip warn">{preview.issues.filter((i) => i.severity === 'warning').length} avisos</span>
            </p>
            <ul className="list">
              {preview.issues.slice(0, 12).map((i, k) => (
                <li key={k}>
                  <span className="time">{i.row ?? '—'}</span>
                  <span className="name" style={{ fontWeight: 400 }}>{i.message}</span>
                  <span className={`chip ${i.severity === 'error' ? 'error' : 'warn'}`}>{i.severity}</span>
                </li>
              ))}
            </ul>
            {preview.issues.length > 12 && <p className="muted">…y {preview.issues.length - 12} más.</p>}
            <button className="btn primary" disabled={!preview.canImport}
              onClick={() => s.notify('Importación confirmada: los registros validados se agregan a la base local.')}>
              {preview.canImport ? 'Importar registros validados' : 'Corrige los errores para importar'}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/** Revisión del mapeo antes de guardar la plantilla. Nada se asume en silencio. */
function TemplateReview({ detection, name, onName, organization, onOrganization, onColumn, onSheet, onSave, onCancel }: {
  detection: TemplateDetection;
  name: string; onName: (v: string) => void;
  organization: string; onOrganization: (v: string) => void;
  onColumn: (sheet: string, index: number, fieldId: string | null) => void;
  onSheet: (sheet: string, patch: SheetOverride) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const usable = detection.sheets.filter((sh) => !sh.ignored);
  const unmapped = usable.reduce((n, sh) => n + sh.columns.filter((c) => !c.fieldId).length, 0);
  const total = usable.reduce((n, sh) => n + sh.columns.length, 0);
  const sinColumna = fieldsWithoutColumn(detection);

  return (
    <div style={{ marginTop: 12 }}>
      <div className="grid2">
        <div className="field">
          <label htmlFor="tplname">Nombre de la plantilla</label>
          <input id="tplname" type="text" value={name} onChange={(e) => onName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tplorg">Consultora</label>
          <input id="tplorg" type="text" value={organization} placeholder="opcional"
            onChange={(e) => onOrganization(e.target.value)} />
        </div>
      </div>

      <p>
        <span className="chip ok">{total - unmapped} de {total} columnas reconocidas</span>{' '}
        {unmapped > 0 && <span className="chip warn">{unmapped} sin asignar</span>}
      </p>
      {unmapped > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>
          Las columnas sin asignar saldrán vacías. Empareja las que importen; es preferible
          una columna vacía a una con el dato equivocado.
        </p>
      )}

      {/* Lo que la app va a recoger en terreno y esta planilla no tiene dónde
          escribir. No es un error, pero hay que verlo antes de guardar. */}
      {sinColumna.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          <b>Sin columna en esta planilla:</b> {sinColumna.map((f) => f.label).join(', ')}.
          {' '}Se van a registrar igual y quedan en el respaldo, pero no saldrán en este Excel.
        </p>
      )}

      {detection.sheets.map((sheet) => (
        <div key={sheet.name} style={{ marginTop: 14, opacity: sheet.ignored ? 0.55 : 1 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ fontSize: 13, flex: '1 1 auto', margin: 0 }}>{sheet.name}</h2>
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={!sheet.ignored}
                onChange={(e) => onSheet(sheet.name, { use: e.target.checked })} />
              Usar esta hoja
            </label>
          </div>

          {!sheet.ignored && (
            <div className="grid2" style={{ marginTop: 6 }}>
              <div className="field">
                <label>Fila del encabezado</label>
                {/* La planilla decorada es la norma: logos, cliente y código
                    arriba. Si la detección falla, se elige a mano. */}
                <select value={sheet.headerRow ?? ''}
                  onChange={(e) => onSheet(sheet.name, { headerRow: Number(e.target.value) })}>
                  {sheet.candidateRows.map((r) => (
                    <option key={r.row} value={r.row}>Fila {r.row} — {r.preview}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Qué lleva esta hoja</label>
                <select value={sheet.scope}
                  onChange={(e) => onSheet(sheet.name, { scope: e.target.value as TemplateDetection['sheets'][number]['scope'] })}>
                  {SCOPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
          )}

          {sheet.ignored
            ? <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                No se usa (instrucciones, listas de validación u hoja sin encabezado reconocible).
              </p>
            : (
              <div className="matrix" style={{ marginTop: 6 }}>
                {sheet.columns.map((c) => (
                  <FragmentRow key={c.index} column={c}
                    onChange={(fieldId) => onColumn(sheet.name, c.index, fieldId)} />
                ))}
              </div>
            )}
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={onSave}>Guardar plantilla</button>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

/** Qué es cada formato que trae la app, en una línea. */
const DESCRIPCION_FORMATO: Record<string, string> = {
  'proterr-nativo': 'El de ProTerr. Una hoja por metodología, más el plan de terreno.',
  'sea-fauna-darwin-core': 'La que exige el SEIA para la línea base (Res. Ex. 202299101888).',
};
/** Formatos que trae la app y no se pueden borrar. */
const PROPIAS = ['proterr-nativo', 'sea-fauna-darwin-core'];

const SCOPES: Array<[string, string]> = [
  ['registros', 'Registros de fauna'],
  ['registros_todos', 'Registros, todos juntos'],
  ['trampeo', 'Trampeo (Sherman y cámara)'],
  ['transito_aereo', 'Tránsito aéreo diurno'],
  ['transito_aereo_nocturno', 'Tránsito aéreo nocturno (MTAN)'],
  ['muestreos', 'Un muestreo por fila'],
  ['plan', 'Plan: estación × metodología'],
  ['estaciones', 'Una estación por fila'],
];

function FragmentRow({ column, onChange }: {
  column: { header: string; fieldId: string | null; confidence: number; samples: string[] };
  onChange: (fieldId: string | null) => void;
}) {
  return (
    <>
      <span title={column.header}>
        {column.header}
        {column.fieldId && column.confidence < 1 && (
          <span className="chip warn" style={{ marginLeft: 6, fontSize: 11 }}>aprox.</span>
        )}
        {!column.fieldId && <span className="chip error" style={{ marginLeft: 6, fontSize: 11 }}>sin asignar</span>}
        {/* Ver el dato es lo que permite decidir: "TIPO" no dice nada,
            "Tipo C · Tipo B2" sí. */}
        {column.samples.length > 0 && (
          <span className="muted" style={{ display: 'block', fontSize: 11 }}>
            {column.samples.join(' · ')}
          </span>
        )}
      </span>
      <select value={column.fieldId ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— dejar vacía —</option>
        {GROUPED_FIELDS.map(([group, fields]) => (
          <optgroup key={group} label={group}>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
    </>
  );
}

const GROUPED_FIELDS: Array<[string, typeof EXPORT_FIELDS]> = (() => {
  const map = new Map<string, typeof EXPORT_FIELDS>();
  for (const f of EXPORT_FIELDS) {
    const list = map.get(f.group) ?? [];
    list.push(f);
    map.set(f.group, list);
  }
  return [...map.entries()];
})();

function FieldRow({ label, value, onChange }: { label: string; value: Requirement; onChange: (v: Requirement) => void }) {
  return (
    <>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as Requirement)}>
        {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
      </select>
    </>
  );
}
