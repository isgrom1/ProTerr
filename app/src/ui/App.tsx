import { lazy, Suspense, useEffect } from 'react';
import { useStore, type Screen } from '../state/store';
import { Icono, type IconName } from './Icono';
import { applyModo, readModo } from './modo';
import { Confirmar } from './screens/Confirmar';
import { Registros } from './screens/Registros';
import { Terreno } from './screens/Terreno';
import { Acceso } from './screens/Acceso';

// Resumen y Ajustes arrastran la librería de Excel (~900 kB). Se cargan aparte
// para que la pantalla de terreno, que es la que se usa con el celular en la
// mano, arranque liviana. Una vez visitadas quedan en la caché del service worker.
const Resumen = lazy(() => import('./screens/Resumen').then((m) => ({ default: m.Resumen })));
const Ajustes = lazy(() => import('./screens/Ajustes').then((m) => ({ default: m.Ajustes })));
const Jornada = lazy(() => import('./screens/Jornada').then((m) => ({ default: m.Jornada })));

const TABS: Array<{ id: Screen; label: string; icon: IconName }> = [
  { id: 'terreno', label: 'Terreno', icon: 'microfono' },
  { id: 'confirmar', label: 'Confirmar', icon: 'confirmar' },
  { id: 'registros', label: 'Registros', icon: 'registros' },
  { id: 'jornada', label: 'Jornada', icon: 'jornada' },
  { id: 'resumen', label: 'Resumen', icon: 'resumen' },
  { id: 'ajustes', label: 'Ajustes', icon: 'ajustes' },
];

export function App() {
  const s = useStore();
  useEffect(() => { void s.init(); }, []);
  // El modo guardado se aplica antes de pintar nada: encender la pantalla en
  // blanco y corregir después ya arruinó la visión nocturna.
  useEffect(() => { applyModo(readModo()); }, []);

  if (!s.ready) {
    return <div className="app"><main className="main"><p className="muted">Cargando catálogos…</p></main></div>;
  }

  // Con la jornada cerrada se reemplazan las dos pantallas que escriben. El
  // resto —registros, resumen, respaldo— queda intacto: bloquear no es retener.
  const cerrada = s.acceso !== null && !s.acceso.puedeRegistrar;

  return (
    <div className="app">
      <header className="topbar">
        <h1>ProTerr</h1>
        <span className="chip">
          {cerrada
            ? <><span className="dot pending" /> jornada cerrada</>
            : s.sync.pending > 0 ? <><span className="dot pending" /> {s.sync.pending} en cola</>
            : <><span className="dot synced" /> al día</>}
        </span>
      </header>

      <main className="main">
        {s.screen === 'terreno' && (cerrada ? <Acceso /> : <Terreno />)}
        {s.screen === 'confirmar' && (cerrada ? <Acceso /> : <Confirmar />)}
        {s.screen === 'registros' && <Registros />}
        <Suspense fallback={<p className="muted">Cargando…</p>}>
          {s.screen === 'jornada' && <Jornada />}
          {s.screen === 'resumen' && <Resumen />}
          {s.screen === 'ajustes' && <Ajustes />}
        </Suspense>
      </main>

      {s.banner && (
        <div className="banner" data-tone={s.banner.tone} role="status">
          {s.banner.text}
          {/* Deshacer donde uno mira después de guardar, no tres pantallas más allá. */}
          {s.lastSaved && Date.now() - s.lastSaved.at < 20000 && s.banner.tone === 'ok' && (
            <button className="btn ghost" style={{ minHeight: 36, padding: '4px 12px', marginLeft: 10 }}
              onClick={() => void s.undoLastSave()}>Deshacer</button>
          )}
        </div>
      )}

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} aria-current={s.screen === t.id} onClick={() => s.setScreen(t.id)}>
            <span className="glyph" aria-hidden><Icono name={t.icon} /></span>
            {t.label}
            {t.id === 'confirmar' && s.drafts.length > 0 ? ` (${s.drafts.length})` : ''}
          </button>
        ))}
      </nav>
    </div>
  );
}
