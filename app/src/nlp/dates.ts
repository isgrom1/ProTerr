/**
 * Fechas dichas como se dicen en terreno.
 *
 * Existe porque el trabajo no termina en el punto: uno llega a la casa y se
 * acuerda de lo que no anotó. "Ayer en el EMF44 había una loica macho" tiene
 * que poder escribirse tal cual, y la app tiene que entender que ese registro
 * es del día anterior aunque se esté ingresando hoy.
 *
 * Se resuelve contra una fecha de referencia que se pasa por parámetro (hoy,
 * normalmente): así la función es determinista y se puede probar.
 */
import { fold } from './text';

export interface SpokenDate {
  /** Fecha resuelta, AAAA-MM-DD. */
  iso: string;
  /** Lo que se dijo, para dejarlo en la trazabilidad. */
  verbatim: string;
  /** Días hacia atrás respecto de la referencia. 0 = hoy. */
  daysAgo: number;
  /** Tokens consumidos, para que el parser no los lea como otra cosa. */
  length: number;
}

const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
  noviembre: 11, diciembre: 12,
};

/** Palabras que anuncian una fecha y no aportan nada más ("el", "día"). */
const RELLENO = ['el', 'la', 'del', 'de', 'dia', 'pasado', 'pasada', 'antepasado'];

const NUMEROS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10,
};

/**
 * Busca una fecha hablada en los tokens, empezando en `start`.
 * Devuelve null si ahí no hay ninguna: el parser sigue con lo suyo.
 */
export function readSpokenDate(tokens: string[], start: number, today: Date): SpokenDate | null {
  const t = tokens[start];
  if (!t) return null;

  if (t === 'hoy') return at(today, 0, 'hoy', 1);
  if (t === 'ayer') return at(today, 1, 'ayer', 1);
  if (t === 'anteayer' || t === 'antier') return at(today, 2, t, 1);

  // "antes de ayer"
  if (t === 'antes' && tokens[start + 1] === 'de' && tokens[start + 2] === 'ayer') {
    return at(today, 2, 'antes de ayer', 3);
  }

  // "hace dos días", "hace 3 dias"
  if (t === 'hace') {
    const n = numberAt(tokens, start + 1);
    if (n && esDia(tokens[start + 1 + n.length])) {
      return at(today, n.value, `hace ${n.value} días`, n.length + 2);
    }
  }

  // "el lunes", "el lunes pasado" -> el más reciente que ya pasó.
  const conDia = diaSemana(tokens, start, today);
  if (conDia) return conDia;

  // "el 2 de junio" (y "2 de junio" a secas)
  const conMes = diaMes(tokens, start, today);
  if (conMes) return conMes;

  return null;
}

/** ¿Hay una fecha hablada en cualquier parte del fragmento? */
export function findSpokenDate(
  tokens: string[], today: Date,
): { start: number; date: SpokenDate } | null {
  for (let i = 0; i < tokens.length; i++) {
    const date = readSpokenDate(tokens, i, today);
    if (date) return { start: i, date };
  }
  return null;
}

function diaSemana(tokens: string[], start: number, today: Date): SpokenDate | null {
  let i = start;
  let consumidos = 0;
  while (RELLENO.includes(tokens[i] ?? '') && consumidos < 2) { i++; consumidos++; }
  const nombre = tokens[i];
  const objetivo = nombre === undefined ? undefined : DIAS[fold(nombre)];
  if (objetivo === undefined) return null;

  // El día de la semana siempre mira hacia atrás: si hoy es martes y se dice
  // "el martes", se habla del martes pasado, no del de la próxima semana.
  let atras = (today.getDay() - objetivo + 7) % 7;
  if (atras === 0) atras = 7;
  let largo = i - start + 1;
  // "el lunes pasado" es una semana más atrás que "el lunes".
  if (tokens[i + 1] === 'pasado' || tokens[i + 1] === 'pasada') { atras += 7; largo++; }
  return at(today, atras, nombre, largo);
}

function diaMes(tokens: string[], start: number, today: Date): SpokenDate | null {
  let i = start;
  let largo = 0;
  if (RELLENO.includes(tokens[i] ?? '')) { i++; largo++; }
  const n = numberAt(tokens, i);
  if (!n || n.value < 1 || n.value > 31) return null;
  i += n.length;
  largo += n.length;
  if (tokens[i] === 'de') { i++; largo++; }
  const mes = MESES[fold(tokens[i] ?? '')];
  if (!mes) return null;
  largo++;

  // Sin año: se asume el más reciente que ya ocurrió. Nadie registra fauna
  // que verá el año que viene.
  const candidato = new Date(today.getFullYear(), mes - 1, n.value);
  if (candidato > today) candidato.setFullYear(today.getFullYear() - 1);
  const daysAgo = Math.round((startOfDay(today).getTime() - startOfDay(candidato).getTime()) / 86400000);
  return { iso: iso(candidato), verbatim: `${n.value} de ${tokens[i]}`, daysAgo, length: largo };
}

function esDia(token: string | undefined): boolean {
  return token === 'dias' || token === 'dia';
}

function numberAt(tokens: string[], i: number): { value: number; length: number } | null {
  const t = tokens[i];
  if (!t) return null;
  if (/^\d{1,2}$/.test(t)) return { value: Number(t), length: 1 };
  const palabra = NUMEROS[t];
  return palabra ? { value: palabra, length: 1 } : null;
}

function at(today: Date, daysAgo: number, verbatim: string, length: number): SpokenDate {
  const d = startOfDay(today);
  d.setDate(d.getDate() - daysAgo);
  return { iso: iso(d), verbatim, daysAgo, length };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function iso(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
