/**
 * De dónde salen los videos recompensados.
 *
 * Hoy no salen de ninguna parte, y eso es a propósito. Los eCPM que hacen que
 * este modelo tenga sentido —US$3 a US$5— vienen de los SDK de AdMob, Unity o
 * ironSource, y esos **sólo existen dentro de una app instalada desde la
 * tienda**. ProTerr es una PWA: una página. Desde la web sólo se puede mostrar
 * display, que paga veinte veces menos.
 *
 * Así que lo que se construye acá es la costura, no el proveedor. Todo el resto
 * del sistema —el libro de segundos, la barra, el desbloqueo— funciona y se
 * prueba contra esta interfaz. El día que exista el envoltorio nativo se
 * escribe un `ProveedorAds` más y no se toca nada de lo demás.
 *
 * Regla que no se negocia: **si no hay proveedor o no hay señal, la app abre
 * igual**. Nunca se espera a un aviso para dejar trabajar a alguien.
 */

/** Lo que dura un video recompensado típico. */
export const DURACION_VIDEO = 30;

export interface Recompensa {
  /** false si el usuario lo cerró antes de tiempo: no se acredita nada. */
  visto: boolean;
  /** Segundos efectivamente vistos. */
  segundos: number;
}

export interface ProveedorAds {
  readonly id: string;
  /** Hay red, hay inventario y se puede mostrar algo ahora mismo. */
  disponible(): Promise<boolean>;
  mostrar(): Promise<Recompensa>;
}

/** Lo que corre hoy: no hay red de publicidad conectada. */
export const SIN_ADS: ProveedorAds = {
  id: 'ninguno',
  async disponible() { return false; },
  async mostrar() { return { visto: false, segundos: 0 }; },
};

/**
 * Proveedor de mentira, para las pruebas y para poder ver la pantalla real
 * antes de que exista la app nativa. No muestra nada: devuelve la recompensa.
 */
export function proveedorSimulado(opciones: { segundos?: number; falla?: boolean } = {}): ProveedorAds {
  const segundos = opciones.segundos ?? DURACION_VIDEO;
  return {
    id: 'simulado',
    async disponible() { return !opciones.falla; },
    async mostrar() {
      if (opciones.falla) return { visto: false, segundos: 0 };
      return { visto: true, segundos };
    },
  };
}

let actual: ProveedorAds = SIN_ADS;

export function setProveedorAds(p: ProveedorAds): void { actual = p; }
export function getProveedorAds(): ProveedorAds { return actual; }
