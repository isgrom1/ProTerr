/**
 * La puerta. Aparece sólo cuando la jornada está cerrada.
 *
 * El tono de esta pantalla importa tanto como el cálculo detrás. Quien la ve
 * está a punto de salir a terreno, o peor, ya está en terreno. Tres decisiones:
 *
 * - **Primero se dice qué SÍ se puede hacer.** Antes de ofrecer nada. Nadie
 *   perdió sus datos y hay que verlo en la primera línea, no en letra chica.
 * - **Las tres salidas se muestran juntas**, sin esconder la gratis. Ver videos
 *   es un camino legítimo, no un castigo por no pagar.
 * - **Se muestra el tiempo total que la persona ha mirado avisos.** Es su tiempo
 *   y tiene derecho a saber cuánto lleva gastado. Que además ese número sea el
 *   mejor argumento para suscribirse es cierto, y no lo hace menos honesto.
 */
import { useEffect, useState } from 'react';
import { useStore } from '../../state/store';
import { Icono } from '../Icono';
import { getProveedorAds } from '../../licence/ads';
import { acceso, usarDiaAcreditado, verVideo, type Acceso as EstadoAcceso } from '../../licence/licencia';

export function Acceso() {
  const { setScreen, notify } = useStore();
  const [estado, setEstado] = useState<EstadoAcceso | null>(null);
  const [hayAds, setHayAds] = useState(false);
  const [viendo, setViendo] = useState(false);

  useEffect(() => {
    void (async () => {
      setEstado(await acceso());
      setHayAds(await getProveedorAds().disponible());
    })();
  }, []);

  if (!estado) return <p className="muted">Revisando el acceso…</p>;

  const { progreso, ciclo, diasAcreditados } = estado;

  async function mirar() {
    setViendo(true);
    try {
      const r = await verVideo();
      setEstado(r.acceso);
      if (!r.visto) notify('El video no se completó. No se descontó nada.', 'warn');
      else if (r.liberadas > 0) notify(`Liberaste ${r.liberadas === 1 ? 'un día' : `${r.liberadas} días`}.`);
    } finally {
      setViendo(false);
    }
  }

  async function usarDia() {
    const a = await usarDiaAcreditado();
    setEstado(a);
    if (a.puedeRegistrar) {
      notify('Jornada abierta. Buen terreno.');
      setScreen('terreno');
    }
  }

  return (
    <>
      <div className="card">
        <h2>Jornada cerrada</h2>
        <p style={{ margin: '0 0 10px' }}>
          Hoy no puedes <strong>registrar especies nuevas</strong>. Todo lo demás sigue igual:
          tus registros están donde los dejaste y puedes leerlos, exportarlos y respaldarlos.
        </p>
        <button className="btn ghost" onClick={() => setScreen('resumen')}>
          <span className="glyph" aria-hidden><Icono name="resumen" /></span> Ver y exportar lo guardado
        </button>
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
          Tus próximos dos días gratis llegan en {ciclo.diasParaGratis === 1 ? 'un día' : `${ciclo.diasParaGratis} días`}.
        </p>
      </div>

      {diasAcreditados > 0 && (
        <div className="card">
          <h2>Tienes {diasAcreditados === 1 ? 'un día liberado' : `${diasAcreditados} días liberados`}</h2>
          <p style={{ margin: '0 0 10px' }}>
            Se gasta cuando tú lo digas, no al abrir la app. Una vez abierta, la jornada
            queda abierta hasta las 4 de la mañana: puedes cerrar la app y volver sin perderlo.
          </p>
          <button className="btn primary" onClick={() => void usarDia()}>
            Usar un día y abrir la jornada
          </button>
        </div>
      )}

      <div className="card">
        <h2>Liberar un día viendo videos</h2>
        <div className="barra" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progreso.fraccion * 100)}
          aria-label="Progreso hacia el próximo día liberado">
          <i style={{ width: `${progreso.fraccion * 100}%` }} />
        </div>
        <div className="barra-pie">
          <span>{duracion(progreso.segundos)} de {duracion(progreso.meta)}</span>
          <span>{progreso.videosFaltantes} videos para el próximo día</span>
        </div>

        {hayAds ? (
          <button className="btn" disabled={viendo} onClick={() => void mirar()}>
            {viendo ? 'Reproduciendo…' : 'Ver un video'}
          </button>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Todavía no hay videos disponibles: la red de publicidad no funciona en la
            versión web de la app. El progreso que acumules se guarda igual.
          </p>
        )}

        <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
          Lo que veas se acumula entre días. Si hoy miras diez minutos y mañana treinta,
          el día se libera igual.
        </p>
      </div>

      <div className="card">
        <h2>O deja de contar minutos</h2>
        <p style={{ margin: '0 0 10px' }}>
          La suscripción abre todos los días, sin videos y sin avisos al abrir.
        </p>
        {estado.totalVisto > 0 && (
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
            Llevas {duracion(estado.totalVisto)} viendo avisos desde que instalaste ProTerr.
          </p>
        )}
        <button className="btn" disabled title="Necesita el servidor de licencias">
          Suscribirme — próximamente
        </button>
      </div>

      {estado.relojAlterado && (
        <div className="card">
          <h2>El reloj del teléfono se movió</h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Detectamos que la fecha del equipo retrocedió. No te bloqueamos por eso —un
            teléfono al que se le agotó la batería amanece con la fecha cambiada— pero
            conviene corregirla: la hora de tus registros sale de ahí.
          </p>
        </div>
      )}
    </>
  );
}

function duracion(segundos: number): string {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  if (min === 0) return `${seg} s`;
  if (seg === 0) return `${min} min`;
  return `${min} min ${seg} s`;
}
