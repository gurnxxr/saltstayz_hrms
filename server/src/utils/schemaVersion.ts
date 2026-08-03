import fs from 'fs';
import path from 'path';
import db from '../config/database';

/**
 * Is the database up to date with the migrations this build ships?
 *
 * On 2026-08-03 the deployed API answered every request happily while the employees page returned
 * a bare 500 for everyone. The cause was not a bug: production had run migration 001 and nothing
 * since, so `employees.pan_number` — added by 007 — did not exist, and the SELECT that named it
 * failed. Render's start command has never run migrations, so the schema sat still while the code
 * advanced through thirty-two more. Nothing anywhere said so.
 *
 * This is the thing that would have said so, in the first line of the deploy log.
 *
 * ── Why filenames, and why `.ts` ──
 *
 * knex records each applied migration by FILENAME in `knex_migrations`, and every row on
 * production ends in `.ts` because they are run through tsx against `src/`. Compiling them into
 * `dist/` and running the `.js` output would leave knex comparing `001_baseline_postgres.js`
 * against a recorded `001_baseline_postgres.ts`, concluding that all thirty-three are pending, and
 * attempting to apply the whole history to a database that already has it. So this compares
 * against the SOURCE directory, on purpose — and see DEPLOYMENT.md before "optimising" that away.
 */

export interface SchemaState {
  applied: number;
  pending: string[];
  /** Recorded as applied but absent from this build — a rollback, or a deploy of older code. */
  unknown: string[];
  ok: boolean;
  /** Set when the check could not run at all; `ok` is then meaningless rather than false. */
  error?: string;
}

/**
 * Migration files this build ships, by the name knex would record.
 *
 * `__dirname` is `dist/utils` in a built server and `src/utils` under tsx, so both walk up to the
 * workspace root and look at `src/db/migrations` either way.
 */
function migrationFilesOnDisk(): string[] {
  const candidates = [
    path.join(__dirname, '../db/migrations'),        // running from src (tsx)
    path.join(__dirname, '../../src/db/migrations'), // running from dist
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter((f) => /^\d+_.*\.ts$/.test(f) && !f.endsWith('.d.ts'))
      .sort();
    if (files.length) return files;
  }
  return [];
}

/** The comparison itself, kept pure so it can be tested without a database in a given state. */
export function diffMigrations(onDisk: string[], appliedNames: string[]): SchemaState {
  const applied = new Set(appliedNames);
  const pending = onDisk.filter((f) => !applied.has(f));
  const unknown = appliedNames.filter((n) => !onDisk.includes(n)).sort();
  return { applied: applied.size, pending, unknown, ok: pending.length === 0 };
}

export async function getSchemaState(): Promise<SchemaState> {
  try {
    const onDisk = migrationFilesOnDisk();
    if (!onDisk.length) {
      // The source tree is not deployed alongside the build. Report honestly rather than claim
      // everything is fine — a check that cannot see the files knows nothing.
      return { applied: 0, pending: [], unknown: [], ok: true, error: 'migration files not found on disk' };
    }
    const rows = await db('knex_migrations').select('name');
    return diffMigrations(onDisk, rows.map((r: any) => String(r.name)));
  } catch (err: any) {
    // Never let the check itself take the server down. `ok` stays true because we do not know
    // otherwise; `error` is what tells the reader the answer is absent, not clean.
    return { applied: 0, pending: [], unknown: [], ok: true, error: err?.message || 'schema check failed' };
  }
}

/**
 * Computed once per process. Migrations run before the server starts (see DEPLOYMENT.md), so the
 * answer cannot change while it is up — and /health is polled often enough that re-reading the
 * directory and re-querying on every ping would be waste.
 */
let cached: SchemaState | null = null;
export async function getCachedSchemaState(): Promise<SchemaState> {
  if (!cached) cached = await getSchemaState();
  return cached;
}

/**
 * Say it once, at boot, where a deploy log will show it.
 *
 * Deliberately does NOT exit. A server that refuses to start turns one broken page into a total
 * outage and, on a platform that retries, a boot loop — worse than the problem. The job here is
 * that nobody can say afterwards that nothing warned them.
 */
export async function logSchemaState(): Promise<SchemaState> {
  const state = await getCachedSchemaState();
  if (state.error) {
    console.warn(`[schema] could not verify migrations: ${state.error}`);
    return state;
  }
  if (state.pending.length) {
    const line = '='.repeat(72);
    console.error(line);
    console.error(`[schema] DATABASE IS BEHIND THIS BUILD — ${state.pending.length} migration(s) not applied.`);
    console.error('[schema] Features added by these will fail at runtime, usually as a bare 500:');
    for (const m of state.pending.slice(0, 10)) console.error(`[schema]   - ${m}`);
    if (state.pending.length > 10) console.error(`[schema]   …and ${state.pending.length - 10} more`);
    console.error('[schema] Fix: npm run db:migrate --workspace=server  (see DEPLOYMENT.md)');
    console.error(line);
  } else {
    console.log(`[schema] up to date — ${state.applied} migration(s) applied.`);
  }
  if (state.unknown.length) {
    console.warn(`[schema] ${state.unknown.length} migration(s) applied that this build does not ship `
      + `(older code deployed, or a rollback): ${state.unknown.slice(0, 5).join(', ')}`);
  }
  return state;
}
