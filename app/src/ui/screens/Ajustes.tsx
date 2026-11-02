/**
 * Configuración (brief §8 y §23): qué campos se piden y por qué metodología,
 * más la descarga de catálogos y la importación de planillas históricas.
 * Todo se edita como datos; no hay que tocar el código.
 */
import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import { seedCatalogs } from '../../db/seed';
import { EXPORT_FIELDS } from '../../export/fields';
import {
  borrarNomina, estadoCache, getEndpoint, guardarNomina, limpiarCache,
  nominaCargada, setEndpoint,
} from '../../conservation/lookup';
import { leerNomina, resumirNomina } from '../../conservation/nomina';
import { Icono, ICONO_METODO } from '../Icono';
import { MODOS, readModo, setModo, type Modo } from '../modo';
import {
  fieldsWithoutColumn, toTemplate, detectTemplate,
  type SheetOverride, type TemplateDetection,
} from '../../import/template';
import { analyzeWorkbook, type ImportPreview } from '../../import/planilla';
import {
  construirCatalogo, detectarCatalogo, ETIQUETA_CAMPO, type DeteccionCatalogo,
} from '../../import/catalogo';
import { readKmlFile, toStationCandidates, type StationCandidate } from '../../geo/kml';
import { useStore } from '../../state/store';
import { proveedorSimulado, setProveedorAds, SIN_ADS } from '../../licence/ads';
import { activarPago, registrarApertura, reiniciarLicencia } from '../../licence/licencia';
import type { MethodCode, Project } from '../../domain/types';
import { requirementFor, type RequirableField, type Requirement } from '../../validation/profiles';
import { METHOD_LABELS } from './Terreno';
import { METHOD_LABEL } from '../../export/fields';

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
  const [nomina, setNomina] = useState<{ archivo: string; cargadaEl: string; especies: number } | null>(null);
  useEffect(() => {
    void getEndpoint().then((v) => setRceUrl(v ?? ''));
    void estadoCache().then(setCache);
    void nominaCargada().then(setNomina);
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
      <ProyectoCard />

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

      <CatalogoEspecies />

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
        {nomina ? (
          <p style={{ margin: '0 0 10px' }}>
            <span className="chip ok">{nomina.especies} especies</span>{' '}
            <span className="chip">{nomina.archivo.slice(0, 34)}</span>{' '}
            <span className="chip muted">cargada el {nomina.cargadaEl.slice(0, 10)}</span>
          </p>
        ) : (
          <p className="chip warn" style={{ display: 'block', marginBottom: 10 }}>
            Sin nómina cargada: los registros van a salir sin categoría.
          </p>
        )}

        <div className="row" style={{ marginBottom: 10 }}>
          <a className="btn" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}
            href="https://clasificacionespecies.mma.gob.cl" target="_blank" rel="noreferrer">
            1 · Bajar del MMA
          </a>
          <label className="btn primary" style={{ display: 'grid', placeItems: 'center' }}>
            2 · Cargar el archivo
            <input type="file" accept=".xlsx,.xls" hidden onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const leida = leerNomina(await file.arrayBuffer(), file.name);
                await guardarNomina(leida);
                setNomina(await nominaCargada());
                const r = resumirNomina(leida);
                s.notify(
                  `${r.total} especies · ${r.amenazadas} amenazadas · ${r.compuestas} con categoría regional`
                  + (leida.duplicadosResueltos.length
                    ? ` · ${leida.duplicadosResueltos.length} duplicado(s) resueltos al proceso más reciente`
                    : ''),
                );
              } catch (err) {
                s.notify(err instanceof Error ? err.message : 'No se pudo leer el archivo.', 'error');
              }
            }} />
          </label>
          {nomina && (
            <button className="btn ghost" onClick={async () => {
              await borrarNomina();
              setNomina(null);
              s.notify('Nómina borrada.');
            }}>Quitar</button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          El sitio del MMA no permite que la app descargue el archivo sola, así que se baja a
          mano y se carga aquí. Cuando una especie aparece dos veces —una por proceso de
          clasificación— <b>se toma la del proceso más reciente</b>, que es lo que deja
          <i> Aegla papudo</i> y <i>Sophora masafuerana</i> en la categoría vigente.
        </p>

        <div className="field">
          <label htmlFor="rce">Servicio de consulta (opcional)</label>
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

      <LicenciaPruebas />
    </>
  );
}

/**
 * Banco de pruebas de la licencia. Sólo existe en desarrollo: en la app
 * publicada este bloque no se compila, porque un botón que abre la jornada
 * gratis sería exactamente el agujero que el ciclo intenta cerrar.
 */
function LicenciaPruebas() {
  const s = useStore();
  const [ads, setAds] = useState(false);
  if (!import.meta.env.DEV) return null;

  async function refrescar(mensaje: string) {
    await s.refreshAcceso();
    s.notify(mensaje);
  }

  return (
    <section className="card">
      <h2>Licencia (sólo en desarrollo)</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Estado: <strong>{s.acceso?.motivo ?? 'sin consultar'}</strong>
        {s.acceso ? ` · jornada ${s.acceso.jornada} · día ${s.acceso.ciclo.posicion + 1} de 7` : ''}
        {s.acceso && s.acceso.diasAcreditados > 0 ? ` · ${s.acceso.diasAcreditados} liberados` : ''}
      </p>
      <div className="row">
        <button className="btn" onClick={() => {
          setProveedorAds(ads ? SIN_ADS : proveedorSimulado({ segundos: 600 }));
          setAds(!ads);
          s.notify(ads ? 'Videos apagados.' : 'Videos simulados encendidos: 10 min cada uno.');
        }}>{ads ? 'Apagar videos' : 'Encender videos simulados'}</button>
        <button className="btn" onClick={() => void (async () => {
          await activarPago(30);
          await refrescar('Suscripción simulada por 30 días.');
        })()}>Simular pago</button>
        <button className="btn danger" onClick={() => void (async () => {
          await reiniciarLicencia();
          await registrarApertura();
          await refrescar('Licencia reiniciada: el ciclo arranca hoy.');
        })()}>Reiniciar ciclo</button>
      </div>
      <p className="muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
        Para ver la puerta: reinicia el ciclo y después adelanta la fecha del
        computador dos días. El ciclo se cuenta por fecha, no por sesiones.
      </p>
    </section>
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
  // Qué hojas se abrieron columna por columna. Cerradas por omisión: una
  // planilla real trae 133 columnas y revisarlas en un teléfono, antes de
  // salir a terreno, es tiempo que nadie tiene.
  const [abiertas, setAbiertas] = useState<string[]>([]);
  const abrir = (n: string) => setAbiertas((a) => (a.includes(n) ? a.filter((x) => x !== n) : [...a, n]));

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

      {/* Guardar va ARRIBA. Estaba al final de las 133 columnas, así que para
          aceptar lo que la app ya había reconocido bien había que recorrerlas
          todas. En terreno eso no se hace: se abandona. */}
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn primary" onClick={onSave}>Guardar plantilla</button>
        <button className="btn ghost" onClick={onCancel}>Cancelar</button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        Puedes guardar así y revisar después: cambiar la plantilla no toca los registros ya
        guardados. {unmapped > 0 && <>Las {unmapped} sin asignar saldrán vacías, que es preferible
        a una columna con el dato equivocado.</>}
      </p>

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
                  onChange={(e) => onSheet(sheet.name, {
                    headerRow: e.target.value === 'auto' ? undefined : Number(e.target.value),
                  })}>
                  {/* Sin esta opción, elegir mal la fila no tenía vuelta atrás. */}
                  <option value="auto">Volver a detectarla sola</option>
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
            : (() => {
              // Lo que de verdad hay que mirar: lo que no reconoció y lo que
              // reconoció con poca confianza. El umbral es bajo a propósito:
              // un calce por contener el alias ("UTM E inicio línea" → UTM E
              // inicio) ronda 0,75 y casi siempre es correcto. Marcarlo
              // llenaba la revisión de columnas que estaban bien, que es otra
              // forma de la misma lista inabarcable.
              const atencion = sheet.columns.filter((c) => !c.fieldId || c.confidence < 0.7);
              const todo = abiertas.includes(sheet.name);
              const mostradas = todo ? sheet.columns : atencion;
              return (
                <>
                  <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
                    {sheet.columns.length - sheet.columns.filter((c) => !c.fieldId).length} de{' '}
                    {sheet.columns.length} reconocidas
                    {atencion.length > 0 && <> · {atencion.length} por revisar</>}
                  </p>
                  {mostradas.length > 0 && (
                    <div className="matrix" style={{ marginTop: 6 }}>
                      {mostradas.map((c) => (
                        <FragmentRow key={c.index} column={c}
                          onChange={(fieldId) => onColumn(sheet.name, c.index, fieldId)} />
                      ))}
                    </div>
                  )}
                  {!todo && atencion.length === 0 && (
                    <p className="muted" style={{ fontSize: 12, margin: '4px 0' }}>
                      Todas reconocidas sin dudas.
                    </p>
                  )}
                  <button className="btn ghost" style={{ marginTop: 6 }}
                    onClick={() => abrir(sheet.name)}>
                    {todo ? 'Mostrar sólo lo que falta' : `Ver las ${sheet.columns.length} columnas`}
                  </button>
                </>
              );
            })()}
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


/**
 * Proyecto y campañas.
 *
 * Es lo primero que hay que poner y hasta ahora no se podía: la app venía con
 * un proyecto de demostración y no había forma de cambiarlo, lo que la dejaba
 * inservible para un trabajo real.
 *
 * El huso UTM no es un detalle de formulario: con él se convierten TODAS las
 * coordenadas, las del GPS, las del KMZ importado y las que salen en el rótulo
 * de las fotos. Chile cruza los husos 18 y 19; ponerlo mal desplaza cada punto
 * cientos de kilómetros.
 */
function ProyectoCard() {
  const s = useStore();
  const proyecto = s.projects.find((p) => p.id === s.projectId) ?? null;
  const [editando, setEditando] = useState<Project | null>(null);
  const campanas = s.campaigns.filter((c) => c.projectId === s.projectId);
  const [nuevaCampana, setNuevaCampana] = useState('');
  const [temporada, setTemporada] = useState('Primavera');

  function nuevo(): Project {
    return {
      id: `proj_${Date.now().toString(36)}`,
      code: '', name: '', client: null, region: null,
      utmZone: 19, utmHemisphere: 'S', geodeticDatum: 'WGS84',
      requirementProfileId: proyecto?.requirementProfileId ?? 'linea-base-fauna',
      methods: proyecto?.methods ?? ['transecto', 'playback_aves', 'camara_trampa', 'trampa_sherman'],
    };
  }

  return (
    <section className="card">
      <h2>Proyecto</h2>

      {!editando && (
        <>
          <div className="field">
            <label htmlFor="proj">En cuál estás trabajando</label>
            <select id="proj" value={s.projectId ?? ''} onChange={(e) => s.select({ projectId: e.target.value })}>
              {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {proyecto && (
            <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
              Código <b>{proyecto.code}</b> · UTM {proyecto.utmZone}{proyecto.utmHemisphere} · {proyecto.geodeticDatum}
              {proyecto.client ? <> · {proyecto.client}</> : null}
            </p>
          )}

          <div className="row">
            <button className="btn" onClick={() => setEditando(proyecto ? { ...proyecto } : nuevo())}>
              {proyecto ? 'Editar este proyecto' : 'Crear proyecto'}
            </button>
            <button className="btn" onClick={() => setEditando(nuevo())}>Proyecto nuevo</button>
          </div>

          {proyecto && (
            <>
              <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>Campañas</h3>
              {campanas.length === 0 && (
                <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  Todavía no hay ninguna. Una campaña es la salida a terreno: «Primavera 2026».
                </p>
              )}
              {campanas.map((c) => (
                <div className="row" key={c.id} style={{ alignItems: 'center', marginBottom: 6 }}>
                  <span>{c.name} <span className="muted">· {c.season}</span></span>
                  <button className="btn ghost" style={{ flex: '0 0 auto' }}
                    onClick={() => void s.deleteCampaign(c.id)}>Quitar</button>
                </div>
              ))}

              <div className="row" style={{ marginTop: 8 }}>
                <input type="text" placeholder="Primavera 2026" value={nuevaCampana}
                  onChange={(e) => setNuevaCampana(e.target.value)} />
                <select value={temporada} onChange={(e) => setTemporada(e.target.value)} style={{ flex: '0 0 130px' }}>
                  {['Primavera', 'Verano', 'Otoño', 'Invierno'].map((t) => <option key={t}>{t}</option>)}
                </select>
                <button className="btn" style={{ flex: '0 0 auto' }} disabled={!nuevaCampana.trim()}
                  onClick={() => {
                    void s.saveCampaign({
                      id: `camp_${Date.now().toString(36)}`, projectId: proyecto.id,
                      name: nuevaCampana.trim(), season: temporada,
                    });
                    setNuevaCampana('');
                  }}>Agregar</button>
              </div>

              <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
                Las estaciones de este proyecto se cargan más abajo, desde el KML o KMZ.
              </p>
              <button className="btn danger" style={{ marginTop: 6 }}
                onClick={() => void s.deleteProject(proyecto.id)}>
                Borrar este proyecto
              </button>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Se lleva sus campañas y estaciones. Si ya tiene registros de terreno, no se borra.
              </p>
            </>
          )}
        </>
      )}

      {editando && (
        <EditorProyecto
          valor={editando}
          onCambio={setEditando}
          onCancelar={() => setEditando(null)}
          onGuardar={async () => {
            await s.saveProject({
              ...editando,
              name: editando.name.trim(),
              code: (editando.code.trim() || editando.name.trim()).toUpperCase().replace(/\s+/g, '-'),
              client: editando.client?.trim() || null,
              region: editando.region?.trim() || null,
            });
            setEditando(null);
          }}
        />
      )}
    </section>
  );
}

const DATUMS = ['WGS84', 'SIRGAS-Chile', 'PSAD56', 'SAD69'];

function EditorProyecto({ valor, onCambio, onGuardar, onCancelar }: {
  valor: Project;
  onCambio: (p: Project) => void;
  onGuardar: () => Promise<void>;
  onCancelar: () => void;
}) {
  const set = (patch: Partial<Project>) => onCambio({ ...valor, ...patch });

  return (
    <>
      <div className="field">
        <label htmlFor="pnom">Nombre del proyecto</label>
        <input id="pnom" type="text" value={valor.name} placeholder="Línea base de fauna Quilapilún"
          onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="pcod">Código</label>
        <input id="pcod" type="text" value={valor.code} placeholder="QUILAPILUN-2026"
          onChange={(e) => set({ code: e.target.value })} />
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Va en el identificador de cada registro. Déjalo corto y no lo cambies después:
        los registros ya guardados conservan el que tenían.
      </p>

      <div className="row">
        <div className="field">
          <label htmlFor="pcli">Mandante</label>
          <input id="pcli" type="text" value={valor.client ?? ''} placeholder="Opcional"
            onChange={(e) => set({ client: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="preg">Región</label>
          <input id="preg" type="text" value={valor.region ?? ''} placeholder="Metropolitana"
            onChange={(e) => set({ region: e.target.value })} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="phus">Huso UTM</label>
          <select id="phus" value={valor.utmZone} onChange={(e) => set({ utmZone: Number(e.target.value) })}>
            <option value={18}>18 — oeste</option>
            <option value={19}>19 — la mayor parte de Chile</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pdat">Datum</label>
          <select id="pdat" value={valor.geodeticDatum} onChange={(e) => set({ geodeticDatum: e.target.value })}>
            {DATUMS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Con el huso se convierten todas las coordenadas: el GPS, el KMZ que importes y las que
        salen en el rótulo de las fotos. Equivocarlo mueve cada punto cientos de kilómetros.
      </p>

      <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Metodologías de este proyecto</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Sólo las que marques aparecen en la pantalla de terreno.
      </p>
      <div className="methods" style={{ flexWrap: 'wrap' }}>
        {(Object.keys(METHOD_LABEL) as MethodCode[]).map((m) => {
          const activa = valor.methods.includes(m);
          return (
            <button key={m} type="button" className="method" aria-pressed={activa}
              style={{ flex: '0 0 auto' }}
              onClick={() => set({
                methods: activa ? valor.methods.filter((x) => x !== m) : [...valor.methods, m],
              })}>
              <span className="glyph" aria-hidden><Icono name={ICONO_METODO[m] ?? 'otro'} /></span>
              {METHOD_LABEL[m]}
            </button>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={!valor.name.trim()} onClick={() => void onGuardar()}>
          Guardar proyecto
        </button>
        <button className="btn ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </>
  );
}


/**
 * El catálogo de especies de la consultora.
 *
 * El de arranque trae 257 especies escritas para este proyecto; es un punto de
 * partida, no la fauna de Chile. En terreno se nota al primer bicho que no
 * está. Y parchar especie por especie es la pregunta equivocada: cada
 * consultora trabaja contra SU lista autorizada, porque son esos nombres los
 * que su planilla espera.
 *
 * Suele venir en el mismo archivo que el formulario, en otra hoja.
 */
function CatalogoEspecies() {
  const s = useStore();
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [deteccion, setDeteccion] = useState<DeteccionCatalogo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const total = s.taxonIndex?.size ?? 0;

  return (
    <section className="card">
      <h2>Catálogo de especies</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Ahora hay <b>{total}</b> especies. Las de arranque son un punto de partida escrito
        para ProTerr, no la fauna de Chile: si tu consultora tiene su lista autorizada,
        cárgala y manda esa. <b>El archivo no se guarda</b>, sólo las especies.
      </p>

      <div className="field">
        <label htmlFor="catfile">Lista de especies (Excel)</label>
        <input id="catfile" type="file" accept=".xlsx,.xlsm,.xlsb,.xls"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setError(null);
            const ab = await file.arrayBuffer();
            const det = detectarCatalogo(ab);
            if (!det) {
              setError('No encontré una hoja con nombres de especies. Debe tener al menos nombre común o científico, y alguna columna de taxonomía.');
              setBuffer(null); setDeteccion(null);
              return;
            }
            setBuffer(ab);
            setDeteccion(det);
          }} />
      </div>

      {error && <p className="issue" data-severity="blocker" style={{ fontSize: 13 }}>{error}</p>}

      {deteccion && buffer && (
        <>
          <p style={{ margin: '10px 0 6px' }}>
            Hoja <b>{deteccion.hoja}</b> · <b>{deteccion.filas}</b> especies.
          </p>
          <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
            {deteccion.ejemplos.join(' · ')}
          </p>

          {deteccion.hojasPosibles.length > 1 && (
            <div className="field">
              <label htmlFor="cathoja">¿Es ésta la hoja?</label>
              <select id="cathoja" value={deteccion.hoja}
                onChange={(e) => setDeteccion(detectarCatalogo(buffer, e.target.value) ?? deteccion)}>
                {deteccion.hojasPosibles.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          )}

          <ul className="list" style={{ marginBottom: 10 }}>
            {deteccion.columnas.filter((c) => c.header).map((c) => (
              <li key={c.index}>
                <span className="meta">{c.header}</span>
                <span className="name">{c.campo ? ETIQUETA_CAMPO[c.campo] : '— no se usa —'}</span>
              </li>
            ))}
          </ul>

          <div className="row">
            <button className="btn primary" disabled={cargando} onClick={async () => {
              setCargando(true);
              try {
                const existentes = await db.taxa.toArray();
                const { taxones } = construirCatalogo(buffer, deteccion, existentes);
                await s.importarCatalogo(taxones);
                setDeteccion(null); setBuffer(null);
              } finally {
                setCargando(false);
              }
            }}>{cargando ? 'Cargando…' : `Cargar ${deteccion.filas} especies`}</button>
            <button className="btn ghost" onClick={() => { setDeteccion(null); setBuffer(null); }}>Cancelar</button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Se fusiona con lo que ya hay: una especie que ya tenía registros conserva su
            identificador, así que no se queda ningún registro huérfano.
          </p>
        </>
      )}
    </section>
  );
}
