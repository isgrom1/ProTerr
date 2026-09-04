/**
 * Configuración (brief §8 y §23): qué campos se piden y por qué metodología,
 * más la descarga de catálogos y la importación de planillas históricas.
 * Todo se edita como datos; no hay que tocar el código.
 */
import { useRef, useState } from 'react';
import { db } from '../../db/db';
import { seedCatalogs } from '../../db/seed';
import { EXPORT_FIELDS } from '../../export/fields';
import { toTemplate, detectTemplate, type TemplateDetection } from '../../import/template';
import { analyzeWorkbook, type ImportPreview } from '../../import/planilla';
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

      {/* Cada consultora trae su propio formulario. ProTerr no lleva ninguno
          incorporado: se sube el archivo, se revisa el mapeo y se exporta con
          ese formato. */}
      <section className="card">
        <h2>Formatos de exportación</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Sube el formulario de tu consultora y ProTerr aprenderá a exportar con esa forma exacta.
          El archivo no se guarda: sólo se conserva el mapeo de columnas.
        </p>
        <ul className="list">
          {s.templates.map((t) => (
            <li key={t.id}>
              <span className="name">
                {t.name}
                <div className="muted" style={{ fontSize: 12 }}>
                  {t.organization ? `${t.organization} · ` : ''}
                  {t.sheets.length} hoja(s) · {t.sheets.reduce((n, sh) => n + sh.columns.length, 0)} columnas
                </div>
              </span>
              {t.id === s.templateId && <span className="chip ok">en uso</span>}
              {t.id !== s.templateId && (
                <button className="btn ghost" style={{ flex: '0 0 auto', minHeight: 40, padding: '6px 12px' }}
                  onClick={() => s.selectTemplate(t.id)}>Usar</button>
              )}
              {!t.builtin && (
                <button className="btn ghost" style={{ flex: '0 0 auto', minHeight: 40, padding: '6px 10px', color: 'var(--error)' }}
                  onClick={() => void s.deleteTemplate(t.id)}>✕</button>
              )}
            </li>
          ))}
        </ul>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="tplfile">Cargar el formulario de una consultora</label>
          <input id="tplfile" type="file" accept=".xlsx,.xlsm,.xlsb,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const found = detectTemplate(await file.arrayBuffer(), file.name);
              setDetection(found);
              setTemplateName(file.name.replace(/\.[^.]+$/, ''));
            }} />
        </div>

        {detection && (
          <TemplateReview
            detection={detection}
            name={templateName} onName={setTemplateName}
            organization={organization} onOrganization={setOrganization}
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
            }}
            onCancel={() => setDetection(null)}
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
function TemplateReview({ detection, name, onName, organization, onOrganization, onColumn, onSave, onCancel }: {
  detection: TemplateDetection;
  name: string; onName: (v: string) => void;
  organization: string; onOrganization: (v: string) => void;
  onColumn: (sheet: string, index: number, fieldId: string | null) => void;
  onSave: () => void; onCancel: () => void;
}) {
  const usable = detection.sheets.filter((sh) => !sh.ignored);
  const unmapped = usable.reduce((n, sh) => n + sh.columns.filter((c) => !c.fieldId).length, 0);
  const total = usable.reduce((n, sh) => n + sh.columns.length, 0);

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

      {usable.map((sheet) => (
        <div key={sheet.name} style={{ marginTop: 12 }}>
          <h2 style={{ fontSize: 13 }}>{sheet.name} · {sheet.scope} · encabezado en fila {sheet.headerRow}</h2>
          <div className="matrix">
            {sheet.columns.map((c) => (
              <FragmentRow key={c.index} column={c}
                onChange={(fieldId) => onColumn(sheet.name, c.index, fieldId)} />
            ))}
          </div>
        </div>
      ))}
      {detection.sheets.some((sh) => sh.ignored) && (
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Se ignoraron: {detection.sheets.filter((sh) => sh.ignored).map((sh) => sh.name).join(', ')}
          {' '}(instrucciones, listas de validación u hojas sin encabezado reconocible).
        </p>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={onSave}>Guardar plantilla</button>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

function FragmentRow({ column, onChange }: {
  column: { header: string; fieldId: string | null; confidence: number };
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
