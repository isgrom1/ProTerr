/** Identificadores locales. Un registro nace con su UUID: no depende del servidor. */

export function uuid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else fallbackRandom(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fallbackRandom(bytes: Uint8Array): Uint8Array {
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/**
 * dwc:occurrenceID con forma de URN estable y legible.
 * Incluye el proyecto para que dos planillas de equipos distintos puedan
 * fusionarse sin colisión, que es justo lo que la columna "N°" no permitía.
 */
export function occurrenceIdFor(projectCode: string, id: string): string {
  return `urn:proterr:${slug(projectCode)}:occ:${id}`;
}

export function eventIdFor(projectCode: string, id: string): string {
  return `urn:proterr:${slug(projectCode)}:evt:${id}`;
}

export function locationIdFor(projectCode: string, stationCode: string): string {
  return `urn:proterr:${slug(projectCode)}:loc:${slug(stationCode)}`;
}

function slug(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
