import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { env } from '../config/env';

const execFileAsync = promisify(execFile);

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
    .filter((f) => f.endsWith('.sql') || f.endsWith('.db')) // .db = legacy SQLite-era backups
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
 * Creates a logical backup with `pg_dump` (the SQLite `VACUUM INTO` this replaced has no Postgres
 * equivalent). Produces a plain-SQL dump that `psql` can restore. Returns the new file's metadata
 * and prunes old backups to RETENTION.
 *
 * Requires the `pg_dump` binary on PATH (set PG_DUMP to point at it elsewhere). If it's missing we
 * fail with an actionable message rather than a generic 500 — managed hosts such as Neon also take
 * their own automatic backups, which is the recommended safety net in production.
 */
export async function runBackup(): Promise<BackupFile & { pruned: number }> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = `hrms-${stamp()}.sql`;
  const target = path.join(BACKUP_DIR, file);
  const bin = process.env.PG_DUMP || 'pg_dump';

  try {
    await execFileAsync(bin, ['--no-owner', '--no-privileges', '--file', target, env.DATABASE_URL], {
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (e: any) {
    try { fs.unlinkSync(target); } catch { /* nothing to clean up */ }
    if (e?.code === 'ENOENT') {
      throw Object.assign(
        new Error('pg_dump not found. Install the PostgreSQL client tools or set PG_DUMP to its path.'),
        { status: 503 },
      );
    }
    throw Object.assign(new Error(`pg_dump failed: ${e?.stderr || e?.message || 'unknown error'}`), { status: 500 });
  }

  const { size, mtime } = fs.statSync(target);
  const pruned = prune();
  return { file, size, created_at: mtime.toISOString(), pruned };
}
