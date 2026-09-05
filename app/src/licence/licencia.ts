/**
 * Quién puede registrar hoy, y por qué.
 *
 * Tres caminos, y el usuario elige cuál:
 *
 * - **Pagó.** Acceso completo, sin avisos, sin puerta. Nada que calcular.
 * - **Es día gratis.** Los dos primeros de cada ciclo de siete.
 * - **Liberó el día viendo videos.** Cuarenta minutos acumulados valen una
 *   jornada. No hay tope: quien esté dispuesto a mirar avisos puede usar la app
 *   gratis para siempre. Es una decisión tomada, no un descuido — la fricción de
 *   los cuarenta minutos ES el argumento de venta de la suscripción.
 *
 * Cuatro reglas de comportamiento que importan más que el cálculo:
 *
 * 1. **Bloquear nunca significa retener.** Lo que se cierra es registrar nuevo.
 *    Leer, exportar y respaldar están siempre disponibles. Un dato de terreno
 *    que no se puede sacar es un dato secuestrado.
 *
 * 2. **Un día acreditado no se gasta solo.** Si se gastara al abrir, alguien que
 *    entra a mirar el resumen del domingo perdería un día de terreno sin
 *    enterarse. Se gasta cuando la persona aprieta el botón, y una vez gastado
 *    cubre toda la jornada: cerrar y volver a abrir no cobra de nuevo.
 *
 * 3. **Los segundos sobrantes se guardan.** Quien mira diez minutos hoy y diez
 *    mañana llega a los cuarenta igual. Sin esto el modelo sólo serviría para
 *    quien pueda sentarse cuarenta minutos seguidos.
 *
 * 4. **El reloj atrasado se anota, no se castiga.** Sin servidor esto es
 *    inevitablemente confiable-por-honor: quien quiera saltárselo, se lo salta.
 *    Pero un teléfono viejo al que le sacaron la batería también amanece con el
 *    reloj en 1970, y bloquear a esa persona en terreno sería peor que perder la
 *    licencia. Se registra y se resuelve el día que exista servidor.
 */
import { db } from '../db/db';
import { cicloDe, jornadaDe, diasEntre, sumarDias, type Ciclo } from './ciclo';
import { getProveedorAds, DURACION_VIDEO } from './ads';

/** Cuánto video hay que ver para liberar una jornada. */
export const META_SEGUNDOS = 40 * 60;

const CLAVE = 'licencia.estado';
/** Cuántas jornadas abiertas se recuerdan. Más que eso no le sirve a nadie. */
const MEMORIA_JORNADAS = 60;
/** Tolerancia de reloj antes de gritar. Cubre desajustes normales del teléfono. */
const TOLERANCIA_MS = 5 * 60 * 1000;

export interface EstadoLicencia {
  /** Jornada del primer uso. Desde acá corre el ciclo. */
  inicio: string | null;
  /** Segundos vistos que todavía no completan una jornada. */
  visto: number;
  /** Jornadas ganadas y no gastadas. */
  diasAcreditados: number;
  /** Jornadas ya abiertas con un día acreditado, para no cobrarlas dos veces. */
  jornadasAbiertas: string[];
  /** Hasta qué jornada alcanza la suscripción, o null si no pagó. */
  pagadoHasta: string | null;
  /** Último instante visto, en UTC. Para detectar el reloj corrido. */
  ultimoInstante: string | null;
  relojAlterado: boolean;
  /** Todo lo visto desde siempre. Se le muestra al usuario: es su tiempo. */
  totalVisto: number;
}

export type MotivoAcceso = 'pagado' | 'gratis' | 'acreditado' | 'bloqueado';

export interface Progreso {
  segundos: number;
  meta: number;
  /** De 0 a 1, para la barra. */
  fraccion: number;
  faltan: number;
  /** Cuántos videos faltan, redondeando hacia arriba. */
  videosFaltantes: number;
}

export interface Acceso {
  jornada: string;
  motivo: MotivoAcceso;
  /** Lo único que el bloqueo impide. Leer y exportar siguen abiertos. */
  puedeRegistrar: boolean;
  ciclo: Ciclo;
  diasAcreditados: number;
  progreso: Progreso;
  pagadoHasta: string | null;
  relojAlterado: boolean;
  totalVisto: number;
}

const VACIO: EstadoLicencia = {
  inicio: null, visto: 0, diasAcreditados: 0, jornadasAbiertas: [],
  pagadoHasta: null, ultimoInstante: null, relojAlterado: false, totalVisto: 0,
};

export async function leerEstado(): Promise<EstadoLicencia> {
  const row = await db.settings.get(CLAVE);
  const v = (row as unknown as { value?: Partial<EstadoLicencia> } | undefined)?.value;
  return { ...VACIO, ...(v ?? {}) };
}

async function guardar(e: EstadoLicencia): Promise<void> {
  await db.settings.put({ key: CLAVE, value: e } as never);
}

/**
 * Se llama al abrir la app. Fija el inicio del ciclo la primera vez y revisa el
 * reloj. No gasta nada ni desbloquea nada.
 */
export async function registrarApertura(ahora: Date = new Date()): Promise<Acceso> {
  const e = await leerEstado();
  const jornada = jornadaDe(ahora);

  if (!e.inicio) e.inicio = jornada;

  const previo = e.ultimoInstante ? Date.parse(e.ultimoInstante) : null;
  if (previo !== null && ahora.getTime() < previo - TOLERANCIA_MS) e.relojAlterado = true;
  // El instante guardado nunca retrocede: si el reloj volvió atrás, la marca
  // alta se conserva y el desajuste sigue siendo visible mañana.
  if (previo === null || ahora.getTime() > previo) e.ultimoInstante = ahora.toISOString();

  await guardar(e);
  return calcular(e, jornada);
}

/** Estado actual sin tocar nada. */
export async function acceso(ahora: Date = new Date()): Promise<Acceso> {
  return calcular(await leerEstado(), jornadaDe(ahora));
}

/**
 * Muestra un video y acredita lo visto. Devuelve el acceso actualizado y cuántas
 * jornadas se completaron con este video —normalmente cero, y de vez en cuando
 * una, que es el momento que la barra estuvo anunciando.
 */
export async function verVideo(ahora: Date = new Date()): Promise<{ acceso: Acceso; liberadas: number; visto: boolean }> {
  const proveedor = getProveedorAds();
  const r = await proveedor.mostrar();
  const e = await leerEstado();
  const jornada = jornadaDe(ahora);

  if (!r.visto || r.segundos <= 0) {
    return { acceso: calcular(e, jornada), liberadas: 0, visto: false };
  }

  e.visto += r.segundos;
  e.totalVisto += r.segundos;
  let liberadas = 0;
  while (e.visto >= META_SEGUNDOS) {
    e.visto -= META_SEGUNDOS;
    e.diasAcreditados += 1;
    liberadas += 1;
  }
  await guardar(e);
  return { acceso: calcular(e, jornada), liberadas, visto: true };
}

/**
 * Gasta un día acreditado en la jornada de hoy. Sólo a pedido explícito: ver la
 * regla 2 de la cabecera.
 */
export async function usarDiaAcreditado(ahora: Date = new Date()): Promise<Acceso> {
  const e = await leerEstado();
  const jornada = jornadaDe(ahora);
  const yaAbierta = e.jornadasAbiertas.includes(jornada);

  if (!yaAbierta && e.diasAcreditados > 0) {
    e.diasAcreditados -= 1;
    e.jornadasAbiertas = [...e.jornadasAbiertas, jornada].slice(-MEMORIA_JORNADAS);
    await guardar(e);
  }
  return calcular(e, jornada);
}

/** Activa la suscripción por N días desde hoy. */
export async function activarPago(dias: number, ahora: Date = new Date()): Promise<Acceso> {
  const e = await leerEstado();
  const jornada = jornadaDe(ahora);
  // Renovar antes de que venza suma sobre lo que queda, no lo pisa.
  const base = e.pagadoHasta && diasEntre(jornada, e.pagadoHasta) > 0 ? e.pagadoHasta : jornada;
  e.pagadoHasta = sumarDias(base, dias);
  if (!e.inicio) e.inicio = jornada;
  await guardar(e);
  return calcular(e, jornada);
}

/** Sólo para pruebas y para el botón de reinicio en Ajustes. */
export async function reiniciarLicencia(): Promise<void> {
  await db.settings.delete(CLAVE);
}

function calcular(e: EstadoLicencia, jornada: string): Acceso {
  const ciclo = cicloDe(e.inicio ?? jornada, jornada);
  const pagado = Boolean(e.pagadoHasta && diasEntre(jornada, e.pagadoHasta) >= 0);
  const acreditado = e.jornadasAbiertas.includes(jornada);

  const motivo: MotivoAcceso = pagado ? 'pagado'
    : ciclo.gratis ? 'gratis'
    : acreditado ? 'acreditado'
    : 'bloqueado';

  const faltan = Math.max(0, META_SEGUNDOS - e.visto);
  return {
    jornada,
    motivo,
    puedeRegistrar: motivo !== 'bloqueado',
    ciclo,
    diasAcreditados: e.diasAcreditados,
    progreso: {
      segundos: e.visto,
      meta: META_SEGUNDOS,
      fraccion: Math.min(1, e.visto / META_SEGUNDOS),
      faltan,
      videosFaltantes: Math.ceil(faltan / DURACION_VIDEO),
    },
    pagadoHasta: e.pagadoHasta,
    relojAlterado: e.relojAlterado,
    totalVisto: e.totalVisto,
  };
}
