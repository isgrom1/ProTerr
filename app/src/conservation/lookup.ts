/**
 * Categoría de conservación consultada EN LÍNEA.
 *
 * La nómina del MMA no viaja dentro de la app, a propósito: cambia con cada
 * proceso de clasificación —a junio de 2026 van veinte— y una copia vieja
 * dentro de la app es una categoría equivocada en un informe, que es un error
 * caro. La fuente vive en un servicio y la app pregunta.
 *
 * Pero en terreno casi nunca hay señal, así que TODA respuesta se guarda. Una
 * especie ya consultada vuelve a responder sin conexión, con la fecha en que
 * se consultó a la vista: quien lea el informe sabe de cuándo es el dato.
 *
 * Lo que la app NUNCA hace es inventar una categoría. Si no se ha consultado
 * y no hay señal, lo dice: "sin consultar", que es distinto de "sin categoría".
 */
import type { ConservationStatus } from '../domain/types';
import { db } from '../db/db';
import type { NominaCargada } from './nomina';

/** Contrato del servicio. Debe responder JSON a GET <endpoint>?nombre=<binomio>. */
export interface LookupResponse {
  /** Código IUCN vigente: CR, EN, VU, NT, LC, DD, EX… o compuesto regional. */
  categoria: string | null;
  origen?: string | null;
  endemica?: boolean | null;
  /** De qué versión de la nómina viene, para poder citarla. */
  fuente?: string | null;
  fechaFuente?: string | null;
}

export interface Consulta {
  scientificName: string;
  status: ConservationStatus | null;
  /** Cuándo se consultó, para saber qué tan viejo es el dato guardado. */
  consultadoEl: string;
  /** true si salió de la caché y no del servicio. */
  desdeCache: boolean;
}

const CLAVE_ENDPOINT = 'conservacion.endpoint';
const CLAVE_NOMINA = 'conservacion.nomina';
const PREFIJO = 'conservacion:';

/** La nómina cargada, en memoria, para no leer 1.600 filas en cada consulta. */
let enMemoria: { archivo: string; cargadaEl: string; mapa: Map<string, ConservationStatus | null> } | null = null;

export async function guardarNomina(n: NominaCargada): Promise<void> {
  await db.settings.put({ key: CLAVE_NOMINA, value: n } as never);
  enMemoria = null;
}

export async function nominaCargada(): Promise<{ archivo: string; cargadaEl: string; especies: number } | null> {
  const row = await db.settings.get(CLAVE_NOMINA);
  const v = (row as unknown as { value?: NominaCargada } | undefined)?.value;
  return v ? { archivo: v.archivo, cargadaEl: v.cargadaEl, especies: v.especies.length } : null;
}

export async function borrarNomina(): Promise<void> {
  await db.settings.delete(CLAVE_NOMINA);
  enMemoria = null;
}

async function indiceNomina() {
  if (enMemoria) return enMemoria;
  const row = await db.settings.get(CLAVE_NOMINA);
  const v = (row as unknown as { value?: NominaCargada } | undefined)?.value;
  if (!v) return null;
  const mapa = new Map<string, ConservationStatus | null>();
  for (const e of v.especies) {
    mapa.set(clave(e.scientificName), e.categoria ? ({
      rce: e.categoria,
      rceDecree: e.decreto,
      iucn: null,
      origin: e.endemica ? 'Endémica' : null,
      endemic: e.endemica,
      migratory: null,
      source: `Nómina MMA · ${v.archivo}`,
    } as ConservationStatus) : null);
  }
  enMemoria = { archivo: v.archivo, cargadaEl: v.cargadaEl, mapa };
  return enMemoria;
}

export async function getEndpoint(): Promise<string | null> {
  const row = await db.settings.get(CLAVE_ENDPOINT);
  return (row as { value?: string } | undefined)?.value ?? null;
}

export async function setEndpoint(url: string | null): Promise<void> {
  if (url) await db.settings.put({ key: CLAVE_ENDPOINT, value: url.trim() } as never);
  else await db.settings.delete(CLAVE_ENDPOINT);
}

/**
 * Consulta una especie. Sin señal o sin servicio configurado devuelve lo que
 * haya en caché, y `null` si nunca se consultó.
 */
export async function consultar(
  scientificName: string,
  opciones: { forzar?: boolean; fetch?: typeof globalThis.fetch } = {},
): Promise<Consulta | null> {
  const nombre = scientificName.trim();
  if (!nombre) return null;

  // La nómina oficial cargada manda sobre todo: es la fuente, no una copia.
  const nomina = await indiceNomina();
  if (nomina && nomina.mapa.has(clave(nombre))) {
    return {
      scientificName: nombre,
      status: nomina.mapa.get(clave(nombre)) ?? null,
      consultadoEl: nomina.cargadaEl,
      desdeCache: true,
    };
  }

  if (!opciones.forzar) {
    const guardado = await leerCache(nombre);
    if (guardado) return guardado;
  }

  const endpoint = await getEndpoint();
  if (!endpoint) return (await leerCache(nombre)) ?? null;

  const traer = opciones.fetch ?? globalThis.fetch;
  if (!traer) return (await leerCache(nombre)) ?? null;

  try {
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}nombre=${encodeURIComponent(nombre)}`;
    const res = await traer(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return (await leerCache(nombre)) ?? null;
    const body = (await res.json()) as LookupResponse;
    const consulta: Consulta = {
      scientificName: nombre,
      status: aStatus(body),
      consultadoEl: new Date().toISOString(),
      desdeCache: false,
    };
    await db.settings.put({ key: PREFIJO + clave(nombre), value: consulta } as never);
    return consulta;
  } catch {
    // Sin señal: lo consultado antes sigue sirviendo, lo demás queda sin consultar.
    return (await leerCache(nombre)) ?? null;
  }
}

/** Consulta varias, una por una, y devuelve sólo las que se resolvieron. */
export async function consultarVarias(
  nombres: string[],
  opciones: { forzar?: boolean; fetch?: typeof globalThis.fetch } = {},
): Promise<Map<string, Consulta>> {
  const out = new Map<string, Consulta>();
  for (const n of [...new Set(nombres.map((s) => s.trim()).filter(Boolean))]) {
    const c = await consultar(n, opciones);
    if (c) out.set(n, c);
  }
  return out;
}

/** Cuántas especies se han consultado y cuál es la consulta más antigua. */
export async function estadoCache(): Promise<{ especies: number; masAntigua: string | null }> {
  const filas = await db.settings.toArray();
  const guardadas = filas
    .filter((f) => String((f as { key: string }).key).startsWith(PREFIJO))
    .map((f) => (f as unknown as { value: Consulta }).value)
    .filter((v) => v && v.consultadoEl);
  const fechas = guardadas.map((v) => v.consultadoEl).sort();
  return { especies: guardadas.length, masAntigua: fechas[0] ?? null };
}

export async function limpiarCache(): Promise<number> {
  const filas = await db.settings.toArray();
  const claves = filas
    .map((f) => String((f as { key: string }).key))
    .filter((k) => k.startsWith(PREFIJO));
  await db.settings.bulkDelete(claves);
  return claves.length;
}

async function leerCache(nombre: string): Promise<Consulta | null> {
  const row = await db.settings.get(PREFIJO + clave(nombre));
  const v = (row as unknown as { value?: Consulta } | undefined)?.value;
  return v ? { ...v, desdeCache: true } : null;
}

function clave(nombre: string): string {
  return nombre.toLowerCase().replace(/\s+/g, ' ');
}

function aStatus(body: LookupResponse): ConservationStatus | null {
  if (!body || !body.categoria) return null;
  return {
    rce: body.categoria,
    origin: body.origen ?? null,
    endemic: body.endemica ?? null,
    migratory: null,
    source: [body.fuente, body.fechaFuente].filter(Boolean).join(' · ') || 'consulta en línea',
  } as ConservationStatus;
}
