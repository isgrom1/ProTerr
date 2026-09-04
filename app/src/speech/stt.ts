/**
 * Reconocimiento de voz.
 *
 * Estrategia offline-first (brief §13 y §G): se usa el motor del dispositivo
 * (Web Speech API en el navegador; en una app nativa, el reconocedor del
 * sistema), que en Android/iOS funciona sin conexión con el paquete de idioma
 * español descargado. NO se envía audio a un servicio remoto: en terreno no
 * hay red, y el audio de campo es dato sensible del proyecto.
 *
 * Si el motor no está disponible, la app cae a dictado por teclado sin perder
 * ninguna funcionalidad: el parser opera sobre texto, venga de donde venga.
 */

export interface SpeechResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface SpeechRecognizer {
  readonly available: boolean;
  start(handlers: {
    onResult: (r: SpeechResult) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }): void;
  stop(): void;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function constructor(): (new () => SpeechRecognitionLike) | null {
  const w = globalThis as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  'no-speech': 'No se escuchó nada. Toca el micrófono y habla de nuevo.',
  'audio-capture': 'No se pudo usar el micrófono.',
  'not-allowed': 'Falta permiso de micrófono. Puedes escribir el registro.',
  network: 'El motor de voz pidió conexión. Escribe el registro o usa el dictado del teclado.',
  aborted: 'Dictado interrumpido.',
};

export function createRecognizer(lang = 'es-CL'): SpeechRecognizer {
  const Ctor = constructor();
  let instance: SpeechRecognitionLike | null = null;

  return {
    available: Ctor !== null,
    start(handlers) {
      if (!Ctor) {
        handlers.onError('Este dispositivo no tiene reconocimiento de voz; escribe el registro.');
        handlers.onEnd();
        return;
      }
      instance = new Ctor();
      instance.lang = lang;
      instance.continuous = false;
      instance.interimResults = true; // feedback inmediato: el usuario ve lo que se está entendiendo
      instance.maxAlternatives = 1;
      instance.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const alt = result[0];
          handlers.onResult({ transcript: alt.transcript, isFinal: result.isFinal, confidence: alt.confidence ?? 0 });
        }
      };
      instance.onerror = (e) => handlers.onError(ERROR_MESSAGES[e.error] ?? `Error de dictado: ${e.error}`);
      instance.onend = () => { instance = null; handlers.onEnd(); };
      instance.start();
    },
    stop() {
      instance?.stop();
    },
  };
}

/** Retroalimentación sonora: en terreno el usuario no siempre mira la pantalla. */
export function beep(kind: 'ok' | 'error'): void {
  const AudioCtor = (globalThis as unknown as { AudioContext?: new () => AudioContext }).AudioContext;
  if (!AudioCtor) return;
  try {
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = kind === 'ok' ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (kind === 'ok' ? 0.09 : 0.22));
    osc.onended = () => void ctx.close();
  } catch {
    // El audio es un extra: si el navegador lo bloquea, no pasa nada.
  }
}
