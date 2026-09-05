/**
 * Exportar las fotografías de una campaña, rotuladas.
 *
 * Salen **las dos versiones**, que es lo que pidió terreno:
 *
 *   fotos/rotuladas/   con el rótulo dibujado, para el informe
 *   fotos/limpias/     la original tal como se tomó, por si el rótulo falla
 *
 * El rótulo se dibuja acá y no al tomar la foto, así que se arma con el
 * registro tal como está HOY. Si el punto se corrigió después de terreno, la
 * foto exportada sale con el punto corregido sin volver a fotografiar nada.
 *
 * El nombre del archivo también es dato: punto, fecha, hora y especie. Una
 * carpeta ordenada alfabéticamente queda ordenada por punto y por hora, que es
 * como se revisa un informe.
 */
import type { MediaObject } from '../domain/types';
import { construirRotulo, rotular, CAMPOS_ROTULO_POR_DEFECTO } from '../media/rotulo';
import type { FlatRecord } from './shape';

export interface FotoExportable {
  record: FlatRecord;
  media: MediaObject;
  /** Orden dentro del mismo registro, desde 1. */
  indice: number;
}

/**
 * Nombre de archivo: `EMF44_2026-09-04_1034_Chucao_1.jpg`.
 *
 * Sin tildes ni espacios, porque el archivo viaja por correo, se descomprime en
 * Windows y termina en un servidor de la consultora.
 */
export function nombreDeFoto(f: FotoExportable): string {
  const r = f.record;
  const punto = r.station?.finalStationCode ?? r.station?.stationCode ?? 'sin-punto';
  const hora = (r.occurrence.occurrenceTime ?? r.event.eventTime ?? '').replace(':', '');
  const especie = r.taxon?.commonName ?? r.occurrence.verbatimTaxonText ?? 'sin-especie';
  const partes = [punto, r.event.eventDate, hora, especie, String(f.indice)];
  return `${partes.filter(Boolean).map(limpiar).join('_')}.jpg`;
}

/** Agrupa las fotos de una lista de registros, numerándolas dentro de cada uno. */
export function fotosDe(records: FlatRecord[], media: Map<string, MediaObject>): FotoExportable[] {
  const out: FotoExportable[] = [];
  for (const record of records) {
    let indice = 0;
    for (const id of record.occurrence.mediaIds) {
      const m = media.get(id);
      if (!m || m.kind !== 'foto' || !m.blob) continue;
      indice += 1;
      out.push({ record, media: m, indice });
    }
  }
  return out;
}

/**
 * Arma las entradas del .zip. Devuelve bytes, listos para `zip()`.
 *
 * Si una foto no se puede rotular —un blob corrupto, un canvas que falla— se
 * incluye igual sin rótulo antes que perderla: la evidencia de terreno no se
 * descarta por un problema de dibujo.
 */
export async function empaquetarFotos(
  fotos: FotoExportable[], campos: string[] = CAMPOS_ROTULO_POR_DEFECTO,
): Promise<Record<string, Uint8Array<ArrayBuffer>>> {
  const salida: Record<string, Uint8Array<ArrayBuffer>> = {};
  for (const f of fotos) {
    const nombre = nombreDeFoto(f);
    const limpia = new Uint8Array(await f.media.blob.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    salida[`fotos/limpias/${nombre}`] = limpia;

    const lineas = construirRotulo(f.record, campos);
    try {
      const conRotulo = await rotular(f.media.blob, lineas);
      salida[`fotos/rotuladas/${nombre}`] = new Uint8Array(await conRotulo.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    } catch {
      salida[`fotos/rotuladas/${nombre}`] = limpia;
    }
  }
  return salida;
}

function limpiar(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
