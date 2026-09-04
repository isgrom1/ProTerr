/**
 * Respaldo y restauración completa de la base local (brief §28: "backup").
 *
 * Sin esto, un teléfono perdido o un IndexedDB desalojado por el sistema se
 * lleva toda la campaña. La exportación a Excel no sirve de respaldo: pierde
 * la auditoría, la cola de sincronización, las fotos y los identificadores.
 *
 * El respaldo es un único archivo JSON autocontenido. Las fotos van como
 * data URI dentro del mismo archivo, para que no haya nada que "adjuntar
 * aparte" en un cerro sin señal.
 */
import { db } from './db';
import type { MediaObject } from '../domain/types';

export const BACKUP_FORMAT = 'proterr-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  deviceId: string;
  /** Conteos declarados; se verifican al restaurar. */
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
}

/** Tablas que se respaldan. Los catálogos se omiten: se vuelven a sembrar. */
const TABLES = [
  'events', 'occurrences', 'identifications', 'measurements',
  'audit', 'outbox', 'syncLog', 'settings',
] as const;

/** Las fotos pueden pesar; se incluyen sólo si el usuario lo pide. */
export interface BackupOptions {
  includeMedia?: boolean;
}

export async function createBackup(deviceId: string, options: BackupOptions = {}): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    data[table] = await db.table(table).toArray();
  }

  if (options.includeMedia) {
    const media = await db.media.toArray();
    data.media = await Promise.all(media.map(serializeMedia));
  } else {
    // Se guarda el registro de la foto sin sus bytes, para saber qué falta.
    data.media = (await db.media.toArray()).map(({ blob: _blob, ...rest }) => ({ ...rest, blobOmitted: true }));
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    deviceId,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    data,
  };
}

type SerializedMedia = Omit<MediaObject, 'blob'> & { blobDataUrl: string | null };

async function serializeMedia(media: MediaObject): Promise<SerializedMedia> {
  const { blob, ...rest } = media;
  return { ...rest, blobDataUrl: blob ? await blobToDataUrl(blob) : null };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export type RestoreMode =
  /** Añade lo que falta y conserva la versión local ante un choque de id. */
  | 'fusionar'
  /** Reemplaza el contenido local por el del respaldo. */
  | 'reemplazar';

export interface RestoreReport {
  inserted: Record<string, number>;
  skipped: Record<string, number>;
  /** Registros del respaldo que ya existían localmente con distinto contenido. */
  conflicts: Array<{ table: string; id: string }>;
  warnings: string[];
}

export function isBackupFile(value: unknown): value is BackupFile {
  const v = value as Partial<BackupFile> | null;
  return Boolean(v && v.format === BACKUP_FORMAT && typeof v.version === 'number' && v.data);
}

/**
 * Restaura un respaldo. En modo `fusionar` nunca sobrescribe un registro local
 * distinto: lo reporta como conflicto y deja que una persona decida, igual que
 * hace la sincronización.
 */
export async function restoreBackup(file: unknown, mode: RestoreMode = 'fusionar'): Promise<RestoreReport> {
  if (!isBackupFile(file)) throw new Error('El archivo no es un respaldo de ProTerr.');
  if (file.version > BACKUP_VERSION) {
    throw new Error(`El respaldo es de una versión más nueva (${file.version}) que esta app (${BACKUP_VERSION}).`);
  }

  const report: RestoreReport = { inserted: {}, skipped: {}, conflicts: [], warnings: [] };

  for (const [table, rows] of Object.entries(file.data)) {
    if (!db.tables.some((t) => t.name === table)) {
      report.warnings.push(`Tabla desconocida en el respaldo: ${table}`);
      continue;
    }
    const target = db.table(table);
    let inserted = 0;
    let skipped = 0;

    for (const raw of rows as Array<Record<string, unknown>>) {
      const row = table === 'media' ? await deserializeMedia(raw, report) : raw;
      if (row === null) { skipped++; continue; }

      const key = (row as { id?: string; key?: string; name?: string }).id
        ?? (row as { key?: string }).key
        ?? (row as { name?: string }).name;
      if (key === undefined) { skipped++; continue; }

      const existing = await target.get(key);
      if (existing && mode === 'fusionar') {
        if (JSON.stringify(existing) !== JSON.stringify(row)) report.conflicts.push({ table, id: String(key) });
        skipped++;
        continue;
      }
      await target.put(row);
      inserted++;
    }
    report.inserted[table] = inserted;
    report.skipped[table] = skipped;
  }

  const declared = file.counts ?? {};
  for (const [table, count] of Object.entries(declared)) {
    const seen = (report.inserted[table] ?? 0) + (report.skipped[table] ?? 0);
    if (seen !== count) report.warnings.push(`${table}: el respaldo declaraba ${count} filas y se leyeron ${seen}.`);
  }
  return report;
}

async function deserializeMedia(
  raw: Record<string, unknown>, report: RestoreReport,
): Promise<Record<string, unknown> | null> {
  if (raw.blobOmitted) {
    report.warnings.push(`Fotografía ${String(raw.id)} sin bytes: el respaldo se hizo sin incluir imágenes.`);
    return null;
  }
  const { blobDataUrl, ...rest } = raw as { blobDataUrl?: string | null };
  if (!blobDataUrl) return null;
  return { ...rest, blob: await dataUrlToBlob(blobDataUrl) };
}

/** Nombre de archivo con fecha, para que varios respaldos no se pisen. */
export function backupFileName(projectCode: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `ProTerr_respaldo_${projectCode.replace(/\s+/g, '-')}_${stamp}.json`;
}
