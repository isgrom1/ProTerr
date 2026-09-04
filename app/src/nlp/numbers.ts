/** Reconocimiento de cantidades escritas con palabras en español (0-9999). */

const UNITS: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18,
  diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70,
  ochenta: 80, noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400,
  quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800,
  novecientos: 900,
};

export function isNumberWord(token: string): boolean {
  return token in UNITS || token in TENS || token in HUNDREDS || token === 'mil' || token === 'y' || /^\d+$/.test(token);
}

/**
 * Lee una cantidad a partir de `start`. Devuelve el valor y cuántos tokens
 * consumió (0 si no había número). Soporta "veinte", "veinticinco",
 * "treinta y dos", "mil doscientos" y dígitos.
 */
export function readNumber(tokens: string[], start: number): { value: number; length: number } | null {
  let i = start;
  let total = 0;
  let current = 0;
  let consumed = 0;
  let sawAny = false;

  while (i < tokens.length) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) {
      if (sawAny) break;
      return { value: parseInt(t, 10), length: 1 };
    }
    if (t === 'mil') {
      total += (current || 1) * 1000;
      current = 0;
    } else if (t in HUNDREDS) {
      current += HUNDREDS[t];
    } else if (t in TENS) {
      current += TENS[t];
    } else if (t in UNITS) {
      // "treinta y dos": la unidad se suma a la decena ya leída.
      current += UNITS[t];
    } else if (t === 'y' && sawAny && i + 1 < tokens.length && (tokens[i + 1] in UNITS)) {
      i++;
      consumed++;
      continue;
    } else {
      break;
    }
    sawAny = true;
    i++;
    consumed++;
  }
  if (!sawAny) return null;
  return { value: total + current, length: consumed };
}
