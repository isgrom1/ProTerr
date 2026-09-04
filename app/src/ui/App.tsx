import { lazy, Suspense, useEffect } from 'react';
import { useStore, type Screen } from '../state/store';
import { Confirmar } from './screens/Confirmar';
import { Registros } from './screens/Registros';
import { Terreno } from './screens/Terreno';

// Resumen y Ajustes arrastran la librería de Excel (~900 kB). Se cargan aparte
// para que la pantalla de terreno, que es la que se usa con el celular en la
// mano, arranque liviana. Una vez visitadas quedan en la caché del service worker.
const Resumen = lazy(() => import('./screens/Resumen').then((m) => ({ default: m.Resumen })));
const Ajustes = lazy(() => import('./screens/Ajustes').then((m) => ({ default: m.Ajustes })));
const Jornada = lazy(() => import('./screens/Jornada').then((m) => ({ default: m.Jornada })));

const TABS: Array<{ id: Screen; label: string; glyph: string }> = [
  { id: 'terreno', label: 'Terreno', glyph: '🎙️' },
  { id: 'confirmar', label: 'Confirmar', glyph: '✅' },
  { id: 'registros', label: 'Registros', glyph: '📋' },
  { id: 'jornada', label: 'Jornada', glyph: '📷' },
  { id: 'resumen', label: 'Resumen', glyph: '📊' },
  { id: 'ajustes', label: 'Ajustes', glyph: '⚙️' },
];

export function App() {
  const s = useStore();
  useEffect(() => { void s.init(); }, []);

  if (!s.ready) {
    return <div className="app"><main className="main"><p className="muted">Cargando catálogos…</p></main></div>;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>ProTerr</h1>
        <span className="chip">
          {s.sync.pending > 0 ? <><span className="dot pending" /> {s.sync.pending} en cola</> : <><span className="dot synced" /> al día</>}
        </span>
      </header>

      <main className="main">
        {s.screen === 'terreno' && <Terreno />}
        {s.screen === 'confirmar' && <Confirmar />}
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
            <span className="glyph" aria-hidden>{t.glyph}</span>
            {t.label}
            {t.id === 'confirmar' && s.drafts.length > 0 ? ` (${s.drafts.length})` : ''}
          </button>
        ))}
      </nav>
    </div>
  );
}
