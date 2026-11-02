/**
 * Cargar el catálogo de especies de la consultora.
 *
 * El catálogo de arranque de ProTerr trae 257 especies escritas para este
 * proyecto. Es un punto de partida, no la lista de la fauna de Chile, y en
 * terreno eso se nota al primer bicho que no está: se dictó "platero" en
 * Atacama y no existía.
 *
 * Parchar el catálogo especie por especie no escala, y además es la pregunta
 * equivocada. Cada consultora trabaja contra **su** lista autorizada: los
 * nombres de esa lista son los que su planilla espera, y un registro con el
 * nombre común de otra lista no le sirve aunque la especie sea la misma. Así
 * que la lista la trae la consultora, igual que el formulario.
 *
 * Y suele venir en el mismo archivo: la planilla que ya se sube para aprender
 * su formato trae, en otra hoja, el listado de especies con su taxonomía.
 *
 * Qué NO hace esto:
 *
 *  - No guarda el archivo. Se lee en memoria, se extrae el catálogo y se
 *    descarta, igual que con las plantillas.
 *  - No inventa taxonomía. Lo que la lista no diga queda vacío.
 *  - No borra lo que ya había. Se fusiona por nombre científico, y una
 *    especie que ya tenía registros conserva su identificador para no
 *    dejarlos huérfanos.
 */
import * as XLSX from 'xlsx';
import type { Taxon, TaxonRank } from '../domain/types';
import { guessField } from '../export/template';
import { fold } from '../nlp/text';

/** Campos del catálogo, en el orden en que se muestran al revisar. */
export const CAMPOS_CATALOGO = [
  'commonName', 'scientificName', 'kingdom', 'phylum', 'class',
  'order', 'family', 'genus', 'specificEpithet', 'infraspecificEpithet',
] as const;
export type CampoCatalogo = (typeof CAMPOS_CATALOGO)[number];

export const ETIQUETA_CAMPO: Record<CampoCatalogo, string> = {
  commonName: 'Nombre común', scientificName: 'Nombre científico',
  kingdom: 'Reino', phylum: 'Filo', class: 'Clase', order: 'Orden',
  family: 'Familia', genus: 'Género', specificEpithet: 'Epíteto específico',
  infraspecificEpithet: 'Subespecie',
};

/** Qué campo del catálogo alimenta cada campo de exportación reconocido. */
const DESDE_EXPORTACION: Record<string, CampoCatalogo> = {
  'occurrence.commonName': 'commonName',
  'taxon.scientificName': 'scientificName',
  'taxon.kingdom': 'kingdom',
  'taxon.phylum': 'phylum',
  'taxon.class': 'class',
  'taxon.classLatin': 'class',
  'taxon.order': 'order',
  'taxon.family': 'family',
  'taxon.genus': 'genus',
  'taxon.specificEpithet': 'specificEpithet',
  'taxon.infraspecificEpithet': 'infraspecificEpithet',
};

/**
 * Encabezados que el catálogo de exportación no reconoce porque allá
 * significan otra cosa. "Tipo" en una lista de especies es el filo
 * —Chordata, Arthropoda—, no el tipo de registro.
 */
const PROPIOS: Array<[RegExp, CampoCatalogo]> = [
  [/^tipo\b/, 'phylum'],
  [/^filo\b/, 'phylum'],
  [/^division\b/, 'phylum'],
];

export interface ColumnaCatalogo {
  index: number;
  header: string;
  campo: CampoCatalogo | null;
}

export interface DeteccionCatalogo {
  hoja: string;
  filaEncabezado: number;
  columnas: ColumnaCatalogo[];
  /** Cuántas filas traen al menos un nombre. */
  filas: number;
  /** Hojas que se miraron, para poder elegir otra a mano. */
  hojasPosibles: string[];
  ejemplos: string[];
}

const CLASE_LATIN: Record<string, string> = {
  aves: 'Aves', ave: 'Aves',
  mamiferos: 'Mammalia', mamifero: 'Mammalia', mammalia: 'Mammalia',
  reptiles: 'Reptilia', reptil: 'Reptilia', reptilia: 'Reptilia',
  anfibios: 'Amphibia', anfibio: 'Amphibia', amphibia: 'Amphibia',
};
const CLASE_ES: Record<string, string> = {
  Aves: 'Aves', Mammalia: 'Mamíferos', Reptilia: 'Reptiles', Amphibia: 'Anfibios',
};
const GRUPO: Record<string, Taxon['group']> = {
  Aves: 'aves', Mammalia: 'mamiferos', Reptilia: 'reptiles', Amphibia: 'anfibios',
};

/**
 * Busca la hoja que parece un listado de especies: la que tenga columna de
 * nombre científico y de nombre común, y más filas con nombres.
 */
export function detectarCatalogo(
  data: ArrayBuffer, hojaElegida?: string,
): DeteccionCatalogo | null {
  const wb = XLSX.read(data, { cellDates: false });
  const candidatas: DeteccionCatalogo[] = [];

  for (const hoja of wb.SheetNames) {
    if (hojaElegida && hoja !== hojaElegida) continue;
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[hoja], { header: 1, blankrows: false, defval: '' });
    if (filas.length < 2) continue;

    // El encabezado es la primera fila con al menos dos columnas reconocidas.
    for (let i = 0; i < Math.min(12, filas.length); i++) {
      const columnas = (filas[i] as unknown[]).map((raw, index) => {
        const header = String(raw ?? '').trim();
        return { index, header, campo: header ? campoDe(header) : null };
      });
      const campos = new Set(columnas.map((c) => c.campo).filter(Boolean));
      if (!campos.has('commonName') && !campos.has('scientificName')) continue;
      if (campos.size < 3) continue;

      const cuerpo = filas.slice(i + 1);
      const iCom = columnas.find((c) => c.campo === 'commonName')?.index;
      const iSci = columnas.find((c) => c.campo === 'scientificName')?.index;
      const conNombre = cuerpo.filter((f) => texto((f as unknown[])[iCom ?? -1]) || texto((f as unknown[])[iSci ?? -1]));
      if (!conNombre.length) continue;

      candidatas.push({
        hoja, filaEncabezado: i, columnas, filas: conNombre.length,
        hojasPosibles: wb.SheetNames,
        ejemplos: conNombre.slice(0, 4).map((f) => {
          const c = texto((f as unknown[])[iCom ?? -1]);
          const s = texto((f as unknown[])[iSci ?? -1]);
          return [c, s].filter(Boolean).join(' · ');
        }),
      });
      break;
    }
  }

  // La hoja con más especies es la lista; las demás son formularios que
  // también nombran especies en sus columnas.
  return candidatas.sort((a, b) => b.filas - a.filas)[0] ?? null;
}

function campoDe(header: string): CampoCatalogo | null {
  const f = fold(header);
  for (const [re, campo] of PROPIOS) if (re.test(f)) return campo;
  const g = guessField(header);
  return (g.fieldId ? DESDE_EXPORTACION[g.fieldId] : null) ?? null;
}

export interface ResultadoCatalogo {
  taxones: Taxon[];
  /** Filas descartadas por no traer ningún nombre utilizable. */
  descartadas: number;
}

/** Construye los taxones. `existentes` conserva el id de los que ya estaban. */
export function construirCatalogo(
  data: ArrayBuffer, deteccion: DeteccionCatalogo, existentes: Taxon[] = [],
): ResultadoCatalogo {
  const wb = XLSX.read(data, { cellDates: false });
  const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[deteccion.hoja], { header: 1, blankrows: false, defval: '' });
  const cuerpo = filas.slice(deteccion.filaEncabezado + 1);

  const porClave = new Map<string, Taxon>();
  for (const t of existentes) porClave.set(claveDe(t.scientificName, t.commonName), t);

  const salida = new Map<string, Taxon>();
  let descartadas = 0;

  for (const raw of cuerpo) {
    const fila = raw as unknown[];
    const leer = (campo: CampoCatalogo): string | null => {
      const col = deteccion.columnas.find((c) => c.campo === campo);
      return col ? texto(fila[col.index]) : null;
    };

    const commonName = leer('commonName');
    const scientificName = leer('scientificName');
    if (!commonName && !scientificName) { descartadas += 1; continue; }

    const clave = claveDe(scientificName, commonName);
    const previo = porClave.get(clave);

    const claseCruda = leer('class');
    const clase = claseCruda ? CLASE_LATIN[fold(claseCruda)] ?? claseCruda : null;
    const genus = leer('genus') ?? scientificName?.split(/\s+/)[0] ?? null;
    const specificEpithet = leer('specificEpithet') ?? scientificName?.split(/\s+/)[1] ?? null;
    const infra = leer('infraspecificEpithet');

    const nombre = commonName ?? scientificName!;
    const taxon: Taxon = {
      // Conservar el id de una especie que ya existe es lo que impide dejar
      // huérfanos los registros que la referencian.
      id: previo?.id ?? `tx_${hash(clave)}`,
      sourceCommonName: nombre,
      commonName: nombre,
      otherCommonNames: previo?.otherCommonNames ?? [],
      scientificName,
      scientificNameRaw: scientificName,
      scientificNameNote: null,
      kingdom: leer('kingdom'),
      phylum: leer('phylum'),
      class: clase,
      classEs: clase ? CLASE_ES[clase] ?? claseCruda : claseCruda,
      order: leer('order'),
      family: leer('family'),
      genus,
      specificEpithet,
      infraspecificEpithet: infra,
      taxonRank: rangoDe(scientificName, specificEpithet, infra),
      group: (clase ? GRUPO[clase] : undefined) ?? 'otro',
      isPlaceholder: esComodin(nombre, scientificName),
      searchKeys: clavesDeBusqueda(nombre, scientificName, previo?.otherCommonNames ?? []),
      ambiguousCommonName: false,
      conservation: previo?.conservation ?? null,
    } as Taxon;
    salida.set(clave, taxon);
  }

  // Un nombre común repetido en dos especies hay que preguntarlo, no elegirlo.
  const porComun = new Map<string, number>();
  for (const t of salida.values()) porComun.set(fold(t.commonName), (porComun.get(fold(t.commonName)) ?? 0) + 1);
  for (const t of salida.values()) {
    if ((porComun.get(fold(t.commonName)) ?? 0) > 1) t.ambiguousCommonName = true;
  }

  return { taxones: [...salida.values()], descartadas };
}

function claveDe(scientificName: string | null, commonName: string | null): string {
  return fold(scientificName || commonName || '');
}

/** La lista escribe los vacíos con un guión; eso no es un dato. */
function texto(v: unknown): string | null {
  const s = v === null || v === undefined ? '' : String(v).trim();
  if (!s || s === '-' || s === '--' || s === 'n/a' || s === 'N/A') return null;
  return s;
}

function rangoDe(sci: string | null, epiteto: string | null, infra: string | null): TaxonRank {
  if (infra) return 'subspecies';
  if (epiteto) return 'species';
  if (sci) return 'genus';
  return 'unranked';
}

/** "Ratón sp", "A Sin registro": comodines para registrar sin llegar a especie. */
function esComodin(commonName: string, scientificName: string | null): boolean {
  if (!scientificName) return true;
  return /\bsp\.?$|\bspp\.?$|no identificad|sin registro|indeterminad/i.test(commonName);
}

function clavesDeBusqueda(commonName: string, sci: string | null, otros: string[]): string[] {
  const claves = new Set<string>();
  const añadir = (v: string | null | undefined) => { const f = fold(v ?? ''); if (f) claves.add(f); };
  añadir(commonName);
  for (const o of otros) añadir(o);
  añadir(sci);
  // "a spinicauda" para quien dicta el científico abreviado.
  const partes = (sci ?? '').split(/\s+/).filter(Boolean);
  if (partes.length >= 2) añadir(`${partes[0][0]} ${partes.slice(1).join(' ')}`);
  return [...claves].sort();
}

/** Hash estable y corto. No es criptográfico: sólo tiene que ser reproducible. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 10);
}
