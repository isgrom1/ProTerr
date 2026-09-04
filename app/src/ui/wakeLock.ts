/**
 * Mantiene la pantalla encendida mientras hay un muestreo abierto.
 *
 * En terreno, cada bloqueo de pantalla son diez segundos de desbloquear con
 * guantes y una observación que se olvidó. La contrapartida es batería, así
 * que el bloqueo se suelta apenas se cierra el muestreo, y se vuelve a pedir
 * al volver a la app (el navegador lo libera al perder el foco).
 */
import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return; // no está en todos los navegadores; no es crítico

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const next = await api.request('screen');
        if (cancelled) { void next.release(); return; }
        sentinel = next;
      } catch {
        // Batería baja o permiso denegado: la app sigue funcionando igual.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible' && !sentinel) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
      sentinel = null;
    };
  }, [active]);
}
