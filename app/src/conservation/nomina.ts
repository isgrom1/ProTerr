/**
 * Lector de la Nómina oficial del Ministerio del Medio Ambiente.
 *
 * Fuente: clasificacionespecies.mma.gob.cl → "Nómina de especies según estado
 * de conservación". Es un XLSX con una hoja `Especies` de ~1.600 filas.
 *
 * Tres cosas que este archivo tiene y hay que respetar:
 *
 * 1. **Una especie puede aparecer dos veces**, una por cada proceso de
 *    clasificación en que se la revisó. Vale la del proceso MÁS ALTO. A junio
 *    de 2026 son dos casos —Aegla papudo y Sophora masafuerana, ambas subidas
 *    a CR— y quedarse con la primera fila deja dos categorías atrasadas.
 *
 * 2. **La categoría no siempre es un código.** De 74 valores distintos, muchos
 *    son compuestos o regionales: "EN (JF); LC (Chile continental)",
 *    "VU (XV-XIV); NT (VI & RM-XII)". Se guardan TAL CUAL. Reducirlos a un
 *    código sería inventar: la categoría de esa especie depende de dónde está.
 *
 * 3. **Hay entradas que no son especies válidas**, marcadas como "Nombre
 *    científico NO válido; sinonimia de…". Se conservan con esa nota, porque
 *    alguien que dictó ese nombre necesita ver que existe pero es sinónimo.
 *
 * Las columnas se buscan por su encabezado, no por posición: el MMA reordena
 * el archivo entre versiones.
 */
import * as XLSX from 'xlsx';
import { fold } from '../nlp/text';

export interface EspecieNomina {
  scientificName: string;
  commonName: string | null;
  /** La categoría tal como la escribe el MMA, sin simplificar. */
  categoria: string | null;
  /** Código simple (CR, EN, VU…) sólo cuando la categoría ES un código. */
  codigo: string | null;
  /** true cuando la categoría depende de la región o de la subespecie. */
  compuesta: boolean;
  /** El nombre no es válido: la nómina lo lista como sinónimo de otro. */
  sinonimia: boolean;
  fuente: string | null;
  decreto: string | null;
  proceso: number | null;
  endemica: boolean | null;
  clase: string | null;
  orden: string | null;
  familia: string | null;
}

export interface NominaCargada {
  especies: EspecieNomina[];
  /** Nombre del archivo, para poder citarlo en el informe. */
  archivo: string;
  cargadaEl: string;
  /** Filas que se descartaron por quedar atrás en un duplicado. */
  duplicadosResueltos: Array<{ scientificName: string; descartado: string; vigente: string }>;
}

/** Códigos que la nómina usa cuando la categoría es una sola. */
const CODIGOS = new Set([
  'EX', 'EW', 'RE', 'CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE',
  'CR-R', 'EN-R', 'VU-R', 'NT-R', 'LC-R',
]);

/** Qué encabezado alimenta cada campo. Se comparan plegados y por prefijo. */
const COLUMNAS: Array<[keyof EspecieNomina | 'proceso', string]> = [
  ['scientificName', 'nombre cientifico'],
  ['commonName', 'nombre comun'],
  ['categoria', 'categoria vigente'],
  ['fuente', 'fuente de categoria vigente'],
  ['proceso', 'numero proceso rce'],
  ['decreto', 'referencia o decreto'],
  ['endemica', 'endemica'],
  ['clase', 'clase'],
  ['orden', 'orden'],
  ['familia', 'familia'],
];

export function leerNomina(data: ArrayBuffer, archivo: string): NominaCargada {
  const wb = XLSX.read(data, { cellDates: false });
  const nombreHoja = wb.SheetNames.find((n) => fold(n).startsWith('especie')) ?? wb.SheetNames[0];
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombreHoja], { header: 1, blankrows: false });
  if (!filas.length) throw new Error('La hoja de especies está vacía.');

  const encabezado = (filas[0] as unknown[]).map((v) => fold(String(v ?? '')));
  const indice = new Map<string, number>();
  for (const [campo, texto] of COLUMNAS) {
    const i = encabezado.findIndex((h) => h.startsWith(texto));
    if (i >= 0) indice.set(campo, i);
  }
  if (!indice.has('scientificName') || !indice.has('categoria')) {
    throw new Error('El archivo no parece la Nómina del MMA: faltan las columnas de nombre científico o categoría vigente.');
  }

  const porNombre = new Map<string, EspecieNomina>();
  const duplicadosResueltos: NominaCargada['duplicadosResueltos'] = [];

  for (const raw of filas.slice(1)) {
    const fila = raw as unknown[];
    const leer = (campo: string) => {
      const i = indice.get(campo);
      const v = i === undefined ? null : fila[i];
      const s = v === null || v === undefined ? '' : String(v).trim();
      return s || null;
    };
    const scientificName = leer('scientificName');
    if (!scientificName) continue;

    const categoria = leer('categoria');
    const especie: EspecieNomina = {
      scientificName,
      commonName: leer('commonName'),
      categoria,
      codigo: categoria && CODIGOS.has(categoria.toUpperCase()) ? categoria.toUpperCase() : null,
      compuesta: Boolean(categoria) && !CODIGOS.has((categoria ?? '').toUpperCase()),
      sinonimia: Boolean(categoria && /no v[aá]lid/i.test(categoria)),
      fuente: leer('fuente'),
      decreto: leer('decreto'),
      proceso: numero(leer('proceso')),
      endemica: si(leer('endemica')),
      clase: leer('clase'),
      orden: leer('orden'),
      familia: leer('familia'),
    };

    const clave = fold(scientificName);
    const previa = porNombre.get(clave);
    if (!previa) { porNombre.set(clave, especie); continue; }

    // Duplicado: manda el proceso de clasificación más alto. Sin él, la última
    // fila; nunca la primera, que es lo que deja categorías atrasadas.
    const gana = (especie.proceso ?? 0) >= (previa.proceso ?? 0);
    const vigente = gana ? especie : previa;
    const descartada = gana ? previa : especie;
    porNombre.set(clave, vigente);
    duplicadosResueltos.push({
      scientificName,
      descartado: `${descartada.categoria ?? '—'} (proceso ${descartada.proceso ?? '?'})`,
      vigente: `${vigente.categoria ?? '—'} (proceso ${vigente.proceso ?? '?'})`,
    });
  }

  return {
    especies: [...porNombre.values()],
    archivo,
    cargadaEl: new Date().toISOString(),
    duplicadosResueltos,
  };
}

/** Resumen para mostrar al cargar, sin tener que recorrer la lista a mano. */
export function resumirNomina(n: NominaCargada): {
  total: number; conCategoria: number; compuestas: number; sinonimias: number; amenazadas: number;
} {
  const amenaza = new Set(['CR', 'EN', 'VU', 'CR-R', 'EN-R', 'VU-R']);
  return {
    total: n.especies.length,
    conCategoria: n.especies.filter((e) => e.categoria).length,
    compuestas: n.especies.filter((e) => e.compuesta && !e.sinonimia).length,
    sinonimias: n.especies.filter((e) => e.sinonimia).length,
    amenazadas: n.especies.filter((e) => e.codigo && amenaza.has(e.codigo)).length,
  };
}

function numero(v: string | null): number | null {
  if (!v) return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function si(v: string | null): boolean | null {
  if (!v) return null;
  const f = fold(v);
  if (f === 'si' || f === 's') return true;
  if (f === 'no' || f === 'n') return false;
  return null;
}
