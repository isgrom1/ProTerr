/**
 * Modo terreno (brief §12 y §30).
 *
 * Una sola pantalla: contexto arriba (proyecto/campaña/estación/metodología),
 * el micrófono ocupando el centro y los últimos registros abajo. El camino
 * corto es hablar -> confirmar -> guardar; todo lo demás es secundario.
 */
import { useEffect, useRef, useState } from 'react';
import { formatDistance, formatDuration } from '../../effort/session';
import { createRecognizer, beep } from '../../speech/stt';
import { useStore } from '../../state/store';
import { useWakeLock } from '../wakeLock';

export function Terreno() {
  const s = useStore();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [waypointLabel, setWaypointLabel] = useState('');
  const recognizer = useRef(createRecognizer());

  useEffect(() => { void s.requestGps(); }, []);
  // Sólo con el track abierto: si no, mantener la pantalla encendida toda la
  // jornada gastaría batería sin que nadie lo haya pedido.
  useWakeLock(s.activeEvent?.trackState === 'activo');

  const project = s.projects.find((p) => p.id === s.projectId) ?? null;
  const stations = s.stations.filter((st) => st.projectId === s.projectId);
  const station = stations.find((st) => st.id === s.stationId) ?? null;
  const campaigns = s.campaigns.filter((c) => c.projectId === s.projectId);
  const today = new Date().toISOString().slice(0, 10);
  const todays = s.records.filter((r) => r.event.eventDate === today);
  // Metodologías ya trabajadas hoy en la estación elegida: evita repetir un
  // punto por descuido y deja ver de un vistazo qué falta ahí.
  const doneToday = new Set(
    todays.filter((r) => r.event.stationId === s.stationId).map((r) => r.event.method),
  );

  async function submit(text: string) {
    if (!text.trim()) return;
    const command = await s.handleUtterance(text);
    if (command) runCommand(command);
    setTyped('');
    setHeard('');
  }

  function runCommand(command: { kind: string; [k: string]: unknown }) {
    switch (command.kind) {
      case 'nuevo_registro': s.startManualDraft(); break;
      case 'revisar_pendientes': s.setScreen('registros'); break;
      case 'resumen': s.setScreen('resumen'); break;
      case 'que_me_falta':
        s.notify(s.drafts.length ? s.missingFor(s.drafts[0].draftId).join(' · ') || 'No falta nada.' : 'No hay un registro en curso.', 'warn');
        break;
      case 'otro_igual': void s.repeatLast(Number(command.veces) || 1); break;
      case 'deshacer': void s.undoLastSave(); break;
      case 'corregir': void s.correctLast(String(command.texto)); break;
      case 'iniciar_track': void s.beginTrack(); break;
      case 'cerrar_track': void s.finishTrack(); break;
      case 'marcar_punto': void s.addWaypoint(String(command.label)); break;
      case 'sin_detecciones': void s.recordNoDetections(); break;
      case 'no_realizado': void s.recordNotPerformed(command.motivo as string | null); break;
      case 'cambiar_estacion': {
        const match = stations.find((st) => st.stationCode === command.stationCode);
        if (match) { s.select({ stationId: match.id }); s.notify(`Estación ${match.stationCode}.`); }
        else s.notify(`No conozco la estación ${String(command.stationCode)}.`, 'error');
        break;
      }
      default: s.notify('Ese comando aplica dentro de un registro.', 'warn');
    }
  }

  function toggleMic() {
    if (listening) { recognizer.current.stop(); return; }
    setHeard('');
    setListening(true);
    beep('ok');
    recognizer.current.start({
      onResult: (r) => {
        setHeard(r.transcript);
        if (r.isFinal) void submit(r.transcript);
      },
      onError: (message) => { setListening(false); beep('error'); s.notify(message, 'error'); },
      onEnd: () => setListening(false),
    });
  }

  return (
    <>
      <section className="card">
        <h2>Contexto</h2>
        <div className="field">
          <label htmlFor="proj">Proyecto</label>
          <select id="proj" value={s.projectId ?? ''} onChange={(e) => s.select({ projectId: e.target.value })}>
            {s.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="camp">Campaña</label>
            <select id="camp" value={s.campaignId ?? ''} onChange={(e) => s.select({ campaignId: e.target.value })}>
              <option value="">—</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="est">Estación</label>
            <select id="est" value={s.stationId ?? ''} onChange={(e) => s.select({ stationId: e.target.value })}>
              <option value="">Seleccionar…</option>
              {stations.map((st) => <option key={st.id} value={st.id}>{st.stationCode} · {st.habitat ?? 'sin ambiente'}</option>)}
            </select>
          </div>
        </div>

        {/* La metodología cambia varias veces al día —Sherman temprano, después
            el transecto, en la tarde el playback— y cambia lo que la app pide.
            Va en botones grandes, no escondida en un desplegable. */}
        <div className="field">
          <label>Metodología</label>
          <div className="methods" role="group" aria-label="Metodología">
            {(project?.methods ?? []).map((m) => {
              const activa = s.method === m;
              const hechaHoy = doneToday.has(m);
              return (
                <button key={m} type="button" className="method" aria-pressed={activa}
                  onClick={() => s.select({ method: m })}
                  title={METHOD_HINT[m] ?? METHOD_LABELS[m] ?? m}>
                  <span className="glyph" aria-hidden>{METHOD_GLYPH[m] ?? '📋'}</span>
                  <span>{METHOD_LABELS[m] ?? m}</span>
                  {hechaHoy && <span className="done">✓ hoy</span>}
                </button>
              );
            })}
          </div>
          {s.method && (
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>{METHOD_HINT[s.method] ?? ''}</p>
          )}
        </div>

        {/* El GPS sugiere; nunca reemplaza una estación ya confirmada (§4). */}
        {s.suggestions.length > 0 && !s.stationConfirmed && (
          <div className="issue" data-severity="question">
            <p>Estación detectada por GPS: <b>{s.suggestions[0].station.stationCode}</b>{' '}
              <span className="muted">a {s.suggestions[0].distanceMeters} m</span></p>
            <div className="row">
              <button className="btn primary" onClick={() => s.confirmSuggestedStation(s.suggestions[0].station.id)}>Confirmar</button>
              <button className="btn ghost" onClick={() => useStore.setState({ suggestions: [] })}>Seleccionar otra</button>
            </div>
          </div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {s.fix
            ? `GPS ±${Math.round(s.fix.accuracyMeters ?? 0)} m · UTM ${s.fix.utmZone}${project?.utmHemisphere ?? 'S'} ${Math.round(s.fix.utmEast ?? 0)} / ${Math.round(s.fix.utmNorth ?? 0)}`
            : s.gpsError ?? 'Buscando GPS…'}
          {station?.utmEast ? ` · Estación ${station.stationCode} en ${Math.round(station.utmEast)} / ${Math.round(station.utmNorth ?? 0)}` : ''}
        </p>
        {/* La cabecera que antes se escribía a mano en una nota: hora de
            inicio, ladera y clima. Se ve aquí para saber que quedó guardada. */}
        {(s.activeEvent?.startedAt || s.activeEvent?.weather || station?.slopeAspect) && (
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
            {[
              s.activeEvent?.startedAt
                ? `Inicio ${new Date(s.activeEvent.startedAt).toTimeString().slice(0, 5)}`
                : null,
              station?.slopeAspect ? `Ladera ${station.slopeAspect}` : null,
              s.activeEvent?.weather,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </section>

      {/* El recorrido es OPCIONAL y explícito. En el uso normal se dice
          "EMF44" y las especies, después "EMF55" y más especies, sin abrir ni
          cerrar nada: por eso este panel sólo aparece con el track activo. */}
      {s.activeEvent?.trackState === 'activo' && (
        <section className="card" style={{ marginBottom: 12, borderColor: 'var(--accent)' }}>
          <h2>Track activo</h2>
          <p style={{ margin: '0 0 10px' }}>
            <span className="chip ok">⏱ {s.effort?.durationMinutes != null ? formatDuration(s.effort.durationMinutes) : '0 min'}</span>{' '}
            <span className="chip ok">📏 {s.effort?.distanceMeters != null ? formatDistance(s.effort.distanceMeters) : '—'}</span>{' '}
            <span className="chip">📌 {(s.activeEvent.waypoints ?? []).length} punto(s)</span>
          </p>
          {(s.activeEvent.waypoints ?? []).length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
              {(s.activeEvent.waypoints ?? []).map((w) => w.label).join(' → ')}
            </p>
          )}
          <div className="row">
            <button className="btn" onClick={() => void s.addWaypoint(waypointLabel || 'punto')}>Marcar punto</button>
            <input type="text" value={waypointLabel} placeholder="100"
              style={{ maxWidth: 110 }} onChange={(e) => setWaypointLabel(e.target.value)} />
            <button className="btn primary" onClick={() => void s.finishTrack()}>Cerrar track</button>
          </div>
        </section>
      )}

      <button className="mic" data-listening={listening} onClick={toggleMic}>
        <span className="glyph" aria-hidden>🎙️</span>
        {listening ? 'Escuchando…' : 'Registrar observación'}
        <small>{heard || '"Chucao, uno, vocalización"'}</small>
      </button>

      <div className="row" style={{ marginTop: 12 }}>
        <input
          type="text" value={typed} placeholder="…o escríbelo aquí"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(typed); }}
        />
        <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => void submit(typed)}>Interpretar</button>
      </div>
      {/* Todo lo que se puede decir se puede tocar: en terreno a veces no se
          puede hablar (viento, ruido, compañía) o el micrófono no engancha. */}
      {s.records.length > 0 && (
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => void s.repeatLast()}>
            ↺ Otro {(s.records[0].taxon?.commonName ?? 'igual').toLowerCase()}
          </button>
          {s.lastSaved && (
            <button className="btn ghost" onClick={() => void s.undoLastSave()}>Deshacer</button>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={() => s.startManualDraft()}>Registro manual</button>
        <button className="btn ghost" onClick={() => void s.requestGps()}>Actualizar GPS</button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {/* Una estación recorrida sin fauna es un dato de ausencia, no un vacío. */}
        <button className="btn ghost" onClick={() => void s.recordNoDetections()}>Sin detecciones aquí</button>
        {s.activeEvent?.trackState !== 'activo' && (
          <button className="btn ghost" onClick={() => void s.beginTrack()}>Iniciar track</button>
        )}
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h2>Últimos registros ({todays.length} hoy)</h2>
        {todays.length === 0 && <p className="muted">Sin registros todavía.</p>}
        <ul className="list">
          {todays.slice(0, 6).map((r) => (
            <li key={r.occurrence.id}>
              <span className="time">{r.occurrence.occurrenceTime}</span>
              <span className="name">{r.taxon?.commonName ?? r.occurrence.verbatimTaxonText ?? '—'}</span>
              <span className="meta">
                {r.occurrence.recordType}
                {r.occurrence.individualCount != null ? ` ×${r.occurrence.individualCount}` : ''}
              </span>
              <span className={`dot ${r.occurrence.syncState}`} title={r.occurrence.syncState} />
            </li>
          ))}
        </ul>
        {s.sync.pending > 0 && (
          <p className="chip warn" style={{ marginTop: 8 }}>⚠️ {s.sync.pending} registro(s) sin sincronizar</p>
        )}
      </section>
    </>
  );
}

/** Un ícono por metodología: se reconoce antes de leer la palabra. */
export const METHOD_GLYPH: Record<string, string> = {
  transecto: '🥾', playback_aves: '🔊', playback_anfibios: '🐸',
  camara_trampa: '📷', trampa_sherman: '🪤', songmeter: '🎧',
  transito_aereo: '🦅', transito_aereo_nocturno: '🌙',
  punto_conteo: '⏱️', atropello: '🛣️', registro_oportunista: '👀', otro: '📋',
};

/** Qué cambia al elegirla: lo que la app va a pedir y lo que no. */
export const METHOD_HINT: Record<string, string> = {
  transecto: 'Recorrido a pie. Track y esfuerzo opcionales; sin campos de vuelo.',
  playback_aves: 'Por punto de playback. Pide la respuesta al reproducir.',
  playback_anfibios: 'Por punto de playback, de noche. Pide la respuesta.',
  camara_trampa: 'Pide fotografía y acepta el número de la cámara.',
  trampa_sherman: 'Pide la línea y el número de trampa; marca del individuo y recaptura.',
  songmeter: 'Grabadora fija: el registro es de audio, sin conducta.',
  transito_aereo: 'Pide dirección y altura de vuelo, origen y destino.',
  transito_aereo_nocturno: 'MTAN: bloque horario y contra qué se estimó la altura.',
  punto_conteo: 'Pide la distancia de detección, que es lo que da la densidad.',
  atropello: 'Pide coordenada y estado del organismo.',
  registro_oportunista: 'Fuera de muestreo: la coordenada es lo único que lo ubica.',
  otro: 'Metodología libre.',
};

export const METHOD_LABELS: Record<string, string> = {
  transecto: 'Transecto', playback_aves: 'Playback aves', playback_anfibios: 'Playback anfibios',
  camara_trampa: 'Cámara trampa', trampa_sherman: 'Trampas Sherman', songmeter: 'Songmeter',
  transito_aereo: 'Tránsito aéreo', transito_aereo_nocturno: 'Tránsito aéreo nocturno',
  punto_conteo: 'Punto de conteo', atropello: 'Atropello',
  registro_oportunista: 'Registro oportunista', otro: 'Otro',
};
