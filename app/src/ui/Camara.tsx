/**
 * El visor de la cámara con el rótulo encima.
 *
 * Lo que se ve en el visor es exactamente lo que va a salir impreso: el rótulo
 * se arma con la misma función que usa la exportación. Si dice el punto
 * equivocado, se ve ANTES de disparar, que es cuando todavía se puede arreglar.
 *
 * Ocupa la pantalla completa a propósito. Con guante, a contraluz y con el
 * animal a punto de irse, el disparador tiene que ser lo único que se pueda
 * tocar sin mirar.
 */
import { useEffect, useRef, useState } from 'react';
import { abrirCamara, capturar, cerrarCamara, leerRumbo, motivoSinCamara } from '../media/camara';
import type { LineaRotulo } from '../media/rotulo';
import { Icono } from './Icono';

interface Props {
  lineas: LineaRotulo[];
  /** Devuelve la foto SIN rótulo: el rótulo no se hornea en los píxeles. */
  onFoto(blob: Blob, rumbo: number | null): Promise<void> | void;
  onCerrar(): void;
}

export function Camara({ lineas, onFoto, onCerrar }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(motivoSinCamara());
  const [ocupada, setOcupada] = useState(false);
  const [tomadas, setTomadas] = useState(0);

  useEffect(() => {
    let vivo = true;
    if (motivoSinCamara()) return;
    void (async () => {
      try {
        const s = await abrirCamara();
        if (!vivo) { cerrarCamara(s); return; }
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => undefined);
        }
      } catch {
        setError('No se pudo abrir la cámara. Revisa que le hayas dado permiso al navegador.');
      }
    })();
    return () => { vivo = false; cerrarCamara(stream.current); stream.current = null; };
  }, []);

  async function disparar() {
    if (!video.current || ocupada) return;
    setOcupada(true);
    try {
      const blob = await capturar(video.current);
      if (!blob) { setError('El visor todavía no entrega imagen. Espera un segundo.'); return; }
      // El rumbo se pide después de disparar para no demorar la foto.
      const rumbo = await leerRumbo();
      await onFoto(blob, rumbo);
      setTomadas((n) => n + 1);
    } finally {
      setOcupada(false);
    }
  }

  return (
    <div className="camara" role="dialog" aria-modal="true" aria-label="Cámara con rótulo">
      {error ? (
        <div className="camara-aviso">
          <p>{error}</p>
          <button className="btn" onClick={onCerrar}>Volver</button>
        </div>
      ) : (
        <>
          <video ref={video} className="camara-visor" playsInline muted autoPlay />

          {lineas.length > 0 && (
            <div className="camara-rotulo">
              {lineas.map((l) => (
                <div key={l.etiqueta}><span>{l.etiqueta}:</span> {l.valor}</div>
              ))}
            </div>
          )}

          <div className="camara-barra">
            <button className="btn ghost" onClick={onCerrar}>
              {tomadas > 0 ? `Listo (${tomadas})` : 'Cancelar'}
            </button>
            <button className="camara-disparo" onClick={() => void disparar()}
              disabled={ocupada} aria-label="Tomar fotografía">
              <span className="glyph" aria-hidden><Icono name="jornada" size={30} /></span>
            </button>
            <span className="camara-cuenta">{tomadas > 0 ? `${tomadas} foto${tomadas === 1 ? '' : 's'}` : ''}</span>
          </div>
        </>
      )}
    </div>
  );
}
