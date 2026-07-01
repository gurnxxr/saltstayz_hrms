import fs from 'fs';
import path from 'path';
import db from '../config/database';

const DATA_DIR = path.join(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION = Math.max(1, parseInt(process.env.BACKUP_RETENTION || '14', 10));

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface BackupFile {
  file: string;
  size: number;
  created_at: string; // ISO (UTC)
}

function listFiles(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const s = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: s.size, created_at: s.mtime.toISOString() };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at)); // newest first
}

export function listBackups(): BackupFile[] {
  return listFiles();
}

/** Prunes the oldest backups beyond the retention count. */
function prune(): number {
  const extra = listFiles().slice(RETENTION);
  let removed = 0;
  for (const f of extra) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f.file)); removed++; } catch { /* ignore */ }
  }
  return removed;
}

/**
 * Creates a consistent single-file backup using SQLite `VACUUM INTO`. This is
 * WAL-safe (no need to checkpoint or stop writers) and produces a defragmented
 * copy. Returns the new file's metadata and prunes old backups to RETENTION.
 */
export async function runBackup(): Promise<BackupFile & { pruned: number }> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `hrms-${stamp()}.db`;
  const target = path.join(BACKUP_DIR, file).replace(/\\/g, '/'); // forward slashes for SQLite
  await db.raw('VACUUM INTO ?', [target]);
  const { size, mtime } = fs.statSync(path.join(BACKUP_DIR, file));
  const pruned = prune();
  return { file, size, created_at: mtime.toISOString(), pruned };
}
