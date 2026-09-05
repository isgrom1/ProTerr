/**
 * El rótulo de la fotografía.
 *
 * En terreno la costumbre es fotografiar una pizarra escrita a mano con el
 * código del punto antes de las tomas del punto. De ahí sale el problema de
 * J.16: la pizarra se olvida de actualizar y la primera foto de PMF50 sale
 * rotulada PMF40. La app lo detecta después, cruzándolo con el GPS, pero
 * detectarlo es peor que no cometerlo.
 *
 * Si el rótulo lo escribe ProTerr, no puede quedarse atrasado: sale del
 * registro, y el registro sabe en qué punto está porque acaba de elegirlo y el
 * GPS lo confirma.
 *
 * **El rótulo no se hornea en los píxeles.** La foto guardada queda limpia y
 * el rótulo se dibuja encima al mostrarla y al exportarla. Tres razones:
 *
 *  - Si el punto estaba mal y se corrige, el rótulo se corrige solo. Con el
 *    texto quemado en la imagen habría que volver a terreno.
 *  - No se duplica el peso. Cien fotos de jornada ya son el archivo más pesado
 *    del dispositivo.
 *  - La foto original, sin retocar, sigue siendo la que respalda el informe.
 *
 * Al exportar salen las dos versiones, que es lo que pidió terreno: la rotulada
 * para el informe y la limpia por si el rótulo tuviera algún error.
 *
 * Qué dice el rótulo lo elige el consultor sobre el mismo catálogo de campos de
 * exportación: no hay un vocabulario nuevo que aprender.
 */
import type { GeoFix, Project, Station } from '../domain/types';
import { FIELDS_BY_ID, resolveField } from '../export/fields';
import { coordinatesOf, type FlatRecord } from '../export/shape';

export interface LineaRotulo {
  etiqueta: string;
  valor: string;
}

/** Campo sintético: las coordenadas en una sola línea, con su zona y datum. */
export const CAMPO_UTM = '__utm';
/** Campo sintético: latitud y longitud decimales. */
export const CAMPO_LATLON = '__latlon';

/**
 * Lo que lleva una pizarra de terreno en la práctica. Cinco líneas: más no se
 * leen en una foto y tapan el sujeto.
 */
export const CAMPOS_ROTULO_POR_DEFECTO = [
  'station.code', 'event.date', 'occurrence.time', CAMPO_UTM, 'project.name',
];

/** Los campos sintéticos, para poder ofrecerlos junto a los del catálogo. */
export const CAMPOS_SINTETICOS: Array<{ id: string; label: string }> = [
  { id: CAMPO_UTM, label: 'Coordenadas UTM (una línea)' },
  { id: CAMPO_LATLON, label: 'Latitud y longitud (una línea)' },
];

export function etiquetaDeCampo(id: string): string {
  return CAMPOS_SINTETICOS.find((c) => c.id === id)?.label
    ?? FIELDS_BY_ID.get(id)?.label
    ?? id;
}

/**
 * Arma las líneas del rótulo. Lo que no tenga valor se omite: un rótulo con
 * "Estación: —" es peor que uno sin esa línea.
 */
export function construirRotulo(
  record: FlatRecord, campos: string[] = CAMPOS_ROTULO_POR_DEFECTO,
): LineaRotulo[] {
  const lineas: LineaRotulo[] = [];
  for (const id of campos) {
    const valor = valorDe(id, record);
    if (valor) lineas.push({ etiqueta: etiquetaCorta(id), valor });
  }
  return lineas;
}

/**
 * Las mismas líneas, pero antes de que exista el registro: en el visor de la
 * cámara todavía no hay una observación guardada. Se arma un registro mínimo
 * con lo que la app ya sabe y se usa la misma función, para que lo que se ve en
 * el visor sea exactamente lo que va a salir impreso.
 */
export function rotuloEnVivo(
  ctx: { project: Project | null; station: Station | null; fix: GeoFix | null; fecha: string; hora: string },
  campos: string[] = CAMPOS_ROTULO_POR_DEFECTO,
): LineaRotulo[] {
  const parcial = {
    occurrence: { occurrenceTime: ctx.hora, occurrenceFix: ctx.fix, mediaIds: [] },
    event: { eventDate: ctx.fecha, recordedBy: ctx.station?.recordedBy ?? null, method: 'transecto' },
    station: ctx.station,
    site: null, project: ctx.project, campaign: null, taxon: null, facts: [],
  } as unknown as FlatRecord;
  return construirRotulo(parcial, campos);
}

function valorDe(id: string, r: FlatRecord): string {
  if (id === CAMPO_UTM) {
    const c = coordinatesOf(r);
    if (c.utmEast === null || c.utmNorth === null) return '';
    const zona = c.zone ? `${c.zone}S ` : '';
    return `${zona}${Math.round(c.utmEast)} E / ${Math.round(c.utmNorth)} N`;
  }
  if (id === CAMPO_LATLON) {
    const c = coordinatesOf(r);
    if (c.latitude === null || c.longitude === null) return '';
    return `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`;
  }
  const v = resolveField(id, r);
  return v === null || v === undefined || v === '' ? '' : String(v);
}

/** La etiqueta se acorta donde el nombre largo no aporta en una foto. */
const CORTAS: Record<string, string> = {
  'station.code': 'Punto',
  'station.finalCode': 'Punto',
  'project.name': 'Proyecto',
  'event.date': 'Fecha',
  'occurrence.time': 'Hora',
  'event.recordedBy': 'Observador',
  [CAMPO_UTM]: 'UTM',
  [CAMPO_LATLON]: 'Coord.',
};

function etiquetaCorta(id: string): string {
  return CORTAS[id] ?? etiquetaDeCampo(id);
}

/**
 * Cómo se ve el rótulo. Todo relativo al ancho de la foto, para que se vea
 * igual en una imagen de 1600 px que en una de 4000.
 *
 * **Sin recuadro y sin fondo.** Un rectángulo negro semitransparente tapa parte
 * de la foto y le da aire de marca de agua de aplicación gratuita. La forma
 * correcta de escribir sobre una imagen que puede ser cielo blanco o sotobosque
 * negro es la que usan los mapas y las transmisiones deportivas: letra clara con
 * un contorno oscuro alrededor. Se lee sobre cualquier fondo y no oculta nada.
 */
const ESTILO = {
  /** Cuerpo de letra como fracción del ancho de la imagen. */
  cuerpoRel: 0.024,
  /** La primera línea —el punto— se lee de un vistazo y va más grande. */
  factorPrimera: 1.35,
  margenRel: 0.026,
  interlineado: 1.42,
  /** Grosor del contorno respecto al cuerpo de letra. */
  contornoRel: 0.17,
};

/**
 * Dibuja el rótulo abajo a la izquierda, sobre la foto y sin recuadro.
 *
 * Cada línea se traza dos veces: primero el contorno oscuro y encima la letra
 * clara. Ese halo es lo que la hace legible contra un cielo blanco sin necesidad
 * de ponerle una caja detrás.
 */
export function dibujarRotulo(
  ctx: CanvasRenderingContext2D, lineas: LineaRotulo[], ancho: number, alto: number,
): void {
  if (!lineas.length) return;

  const cuerpo = Math.max(12, Math.round(ancho * ESTILO.cuerpoRel));
  const primera = Math.round(cuerpo * ESTILO.factorPrimera);
  const margen = Math.round(ancho * ESTILO.margenRel);

  const tamanos = lineas.map((_, i) => (i === 0 ? primera : cuerpo));
  const altos = tamanos.map((t) => t * ESTILO.interlineado);
  const total = altos.reduce((a, b) => a + b, 0);

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
  ctx.fillStyle = '#ffffff';

  let y = alto - margen - total;
  lineas.forEach((linea, i) => {
    const tam = tamanos[i];
    const peso = i === 0 ? 650 : 500;
    ctx.font = `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.lineWidth = Math.max(1.6, tam * ESTILO.contornoRel);

    const texto = `${linea.etiqueta}: ${linea.valor}`;
    const lineaBase = y + tam;
    ctx.strokeText(texto, margen, lineaBase, ancho - margen * 2);
    ctx.fillText(texto, margen, lineaBase, ancho - margen * 2);
    y += altos[i];
  });
  ctx.restore();
}

/** Devuelve una copia de la foto con el rótulo dibujado encima. */
export async function rotular(
  blob: Blob, lineas: LineaRotulo[], calidad = 0.85,
): Promise<Blob> {
  if (!lineas.length) return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0);
    dibujarRotulo(ctx, lineas, bitmap.width, bitmap.height);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', calidad);
    });
  } finally {
    bitmap.close();
  }
}
