/** Descarga de archivos generados en el dispositivo (Excel, CSV, DwC-A). */

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Empaqueta el Darwin Core Archive en un .zip.
 *
 * Se arma a mano, sin dependencias: en terreno no se puede contar con
 * descargar una librería de compresión. Acepta texto y bytes, porque el mismo
 * empaquetador sirve para las tablas del archivo y para las fotografías.
 */
export async function zip(files: Record<string, string | Uint8Array<ArrayBuffer>>): Promise<Blob> {
  const encoder = new TextEncoder();
  const entries: Array<{ name: Uint8Array<ArrayBuffer>; data: Uint8Array<ArrayBuffer>; crc: number; offset: number }> = [];
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name) as Uint8Array<ArrayBuffer>;
    // Las fotos ya vienen en bytes; el texto hay que codificarlo.
    const data = typeof content === 'string' ? encoder.encode(content) as Uint8Array<ArrayBuffer> : content;
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true); // sin compresión: los archivos son pequeños y así es verificable
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);
    entries.push({ name: nameBytes, data, crc, offset });
    offset += local.length + data.length;
  }

  const central: Uint8Array<ArrayBuffer>[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const header = new Uint8Array(46 + e.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(10, 0, true);
    view.setUint32(16, e.crc, true);
    view.setUint32(20, e.data.length, true);
    view.setUint32(24, e.data.length, true);
    view.setUint16(28, e.name.length, true);
    view.setUint32(42, e.offset, true);
    header.set(e.name, 46);
    central.push(header);
    centralSize += header.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], { type: 'application/zip' });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
