/**
 * Cámara dentro de la app.
 *
 * Existe para que el rótulo lo ponga ProTerr y no una pizarra que se olvida de
 * actualizar. Pero tiene un costo que hay que decir en voz alta:
 *
 *  - **La foto sale peor.** La app de cámara del teléfono hace HDR, modo noche
 *    y apilado de varios cuadros; `getUserMedia` entrega un cuadro del visor y
 *    nada más. Para un ave a distancia eso se nota.
 *  - **No hay EXIF.** El cuadro nace en un canvas: no trae GPS, ni hora de
 *    cámara, ni rumbo. Da igual para la posición y la hora —las pone la app,
 *    que además las tiene mejores— pero el rumbo se pierde, y el rumbo es lo
 *    que usa la pestaña Jornada para separar las tomas de orientación de las de
 *    especies. Por eso se intenta leer la brújula del dispositivo.
 *
 * Conclusión de diseño: **esta cámara no reemplaza a la del teléfono, se suma**.
 * Sirve para lo que antes hacía la pizarra —punto, orientación, ambiente— y la
 * cámara nativa sigue disponible para la foto de la especie, donde la calidad
 * manda. El rótulo se dibuja igual sobre las dos, porque no vive en los píxeles.
 *
 * Requisito duro: `getUserMedia` sólo existe en contexto seguro. En `localhost`
 * funciona; abierta desde el celular contra la IP del computador, no. Es una
 * razón más para publicar en HTTPS.
 */

export interface OpcionesCamara {
  /** 'environment' es la trasera. La frontal no se usa en terreno. */
  facingMode?: 'environment' | 'user';
  anchoIdeal?: number;
}

export function camaraDisponible(): boolean {
  return Boolean(
    globalThis.isSecureContext
    && globalThis.navigator?.mediaDevices?.getUserMedia,
  );
}

/** Por qué no se puede usar la cámara, en palabras que sirvan al usuario. */
export function motivoSinCamara(): string | null {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    return 'Este navegador no permite abrir la cámara desde la app.';
  }
  if (!globalThis.isSecureContext) {
    return 'La cámara sólo funciona con la app publicada en HTTPS. Mientras tanto, usa la cámara del teléfono.';
  }
  return null;
}

export async function abrirCamara(o: OpcionesCamara = {}): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: o.facingMode ?? 'environment',
      width: { ideal: o.anchoIdeal ?? 1920 },
    },
    audio: false,
  });
}

export function cerrarCamara(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Congela el cuadro actual del visor en un JPEG, sin rótulo. */
export async function capturar(video: HTMLVideoElement, calidad = 0.9): Promise<Blob | null> {
  const ancho = video.videoWidth;
  const alto = video.videoHeight;
  if (!ancho || !alto) return null;

  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, ancho, alto);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', calidad);
  });
}

/**
 * Rumbo de la brújula, para no perder lo que daba el EXIF.
 *
 * En iOS hay que pedir permiso con un gesto del usuario y la lectura llega como
 * `webkitCompassHeading`; en Android viene en `alpha`, medido al revés. Si no
 * hay brújula devuelve null y la app sigue: nunca se bloquea una foto por esto.
 */
export function leerRumbo(msEspera = 1200): Promise<number | null> {
  const D = globalThis.DeviceOrientationEvent as
    (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }) | undefined;
  if (!D) return Promise.resolve(null);

  return new Promise((resolve) => {
    let listo = false;
    const terminar = (v: number | null) => {
      if (listo) return;
      listo = true;
      globalThis.removeEventListener('deviceorientation', onOrient as EventListener);
      resolve(v);
    };
    const onOrient = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const ios = e.webkitCompassHeading;
      if (typeof ios === 'number' && Number.isFinite(ios)) return terminar(redondear(ios));
      if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return terminar(redondear(360 - e.alpha));
    };

    const escuchar = () => {
      globalThis.addEventListener('deviceorientation', onOrient as EventListener);
      setTimeout(() => terminar(null), msEspera);
    };

    if (typeof D.requestPermission === 'function') {
      D.requestPermission().then((r) => (r === 'granted' ? escuchar() : terminar(null))).catch(() => terminar(null));
    } else {
      escuchar();
    }
  });
}

function redondear(grados: number): number {
  return Math.round((((grados % 360) + 360) % 360) * 10) / 10;
}
