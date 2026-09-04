/** Utilidades de texto compartidas por el parser y el buscador de especies. */

/**
 * Clave de comparación: minúsculas, sin acentos, sin puntuación, espacios
 * colapsados. Debe producir exactamente lo mismo que `fold()` en
 * tools/extraer_catalogos.py, porque las `searchKeys` del catálogo se generan allí.
 */
export function fold(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const f = fold(input);
  return f.length ? f.split(' ') : [];
}

/**
 * Candidatos en singular para una palabra en plural del español.
 * Devuelve la palabra original primero: el llamador prueba en orden y se queda
 * con la primera que exista en el catálogo, así "fecas" (que es plural
 * lexicalizado) no se convierte por error en "feca".
 */
export function singularCandidates(word: string): string[] {
  const out = [word];
  if (word.length > 3) {
    if (word.endsWith('ces')) out.push(word.slice(0, -3) + 'z'); // perdices -> perdiz
    if (word.endsWith('es')) out.push(word.slice(0, -2)); // tiuques -> tiuque? no: -> tiuqu
    if (word.endsWith('s')) out.push(word.slice(0, -1)); // rayaditos -> rayadito, tiuques -> tiuque
  }
  return [...new Set(out)];
}

/** Distancia de Levenshtein acotada: devuelve `max + 1` si se supera el umbral. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
