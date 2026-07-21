/**
 * One-time data migration: copies every row from the legacy SQLite database into the PostgreSQL
 * schema created by 001_baseline_postgres.ts.
 *
 *   npx tsx src/db/migrate-sqlite-to-pg.ts [path-to-sqlite.db]
 *
 * Defaults to the newest file in server/data/backups (take one with `npm run db:backup` on the old
 * SQLite build). The source is opened READ-ONLY — the legacy database is never modified.
 *
 * What it handles:
 *  - Booleans: SQLite stores 0/1, Postgres wants true/false.
 *  - Empty strings in numeric/timestamp columns become NULL (Postgres rejects '').
 *  - Insert order: tables are topologically sorted from the real foreign-key graph so parents land
 *    before children. This needs no special privileges (unlike disabling FK triggers), so it works
 *    on managed Postgres such as Neon.
 *  - Self-references (e.g. employees.reporting_manager_id -> employees.id) are nulled on insert and
 *    filled in by a second pass, since a row can point at another row in the same table.
 *  - Sequences are advanced to max(id) afterwards, or the next insert would collide with copied ids.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import db from '../config/database';

const SKIP = new Set(['knex_migrations', 'knex_migrations_lock', 'sqlite_sequence']);
const BATCH = 500;

function resolveSource(): string {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const dir = path.join(__dirname, '../../data/backups');
  if (!fs.existsSync(dir)) throw new Error(`No source given and no backups dir at ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  if (!files.length) throw new Error(`No .db backups in ${dir}`);
  return path.join(dir, files[files.length - 1]);
}

type ColMeta = { name: string; type: string };

async function pgColumns(table: string): Promise<Map<string, { type: string; nullable: boolean }>> {
  const rows = await db('information_schema.columns')
    .where({ table_schema: 'public', table_name: table })
    .select('column_name', 'data_type', 'is_nullable');
  return new Map(rows.map((r: any) => [r.column_name, { type: r.data_type, nullable: r.is_nullable === 'YES' }]));
}

/** Every foreign-key column with the table it points at (includes self-references). */
async function fkColumns(): Promise<{ table: string; column: string; parent: string }[]> {
  const { rows } = await db.raw(`
    SELECT c.relname AS table, a.attname AS column, p.relname AS parent
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_class p ON p.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(k.conkey) AS ck(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ck.attnum
    WHERE k.contype = 'f' AND n.nspname = 'public'
  `);
  return rows;
}

/**
 * Order tables so parents load before children. Cycles (users <-> employees) are broken MINIMALLY:
 * when nothing is ready we force exactly one table whose unmet dependencies are all "breakable"
 * (every FK column implementing them is nullable, so it can be nulled now and restored later).
 * Forcing one at a time keeps correct ordering for every table not actually in the cycle — the
 * earlier version dumped all remaining tables, which pushed exit_interviews (NOT NULL FK to
 * employees) ahead of employees.
 */
function topoSort(tables: string[], edges: { child: string; parent: string; breakable: boolean }[]): string[] {
  const deps = new Map<string, Map<string, boolean>>(tables.map((t) => [t, new Map<string, boolean>()]));
  for (const e of edges) {
    if (!deps.has(e.child) || !deps.has(e.parent) || e.child === e.parent) continue;
    const cur = deps.get(e.child)!;
    // If any constraint for this pair is non-nullable, the whole edge is unbreakable.
    cur.set(e.parent, (cur.get(e.parent) ?? true) && e.breakable);
  }
  const out: string[] = [];
  const done = new Set<string>();
  while (out.length < tables.length) {
    const remaining = tables.filter((t) => !done.has(t));
    const ready = remaining.filter((t) => [...deps.get(t)!.keys()].every((d) => done.has(d)));
    if (ready.length) {
      for (const t of ready) { out.push(t); done.add(t); }
      continue;
    }
    // Deadlock: force one table whose unmet deps are all breakable, else the first remaining.
    const forced =
      remaining.find((t) => [...deps.get(t)!.entries()].every(([d, breakable]) => done.has(d) || breakable)) ??
      remaining[0];
    out.push(forced);
    done.add(forced);
  }
  return out;
}

function coerce(value: any, pgType: string | undefined): any {
  if (value === null || value === undefined) return null;
  if (!pgType) return value;
  if (pgType === 'boolean') {
    if (typeof value === 'boolean') return value;
    return value === 1 || value === '1' || value === 'true';
  }
  // Postgres rejects '' for numeric/timestamp columns; SQLite happily stored it.
  if (value === '' && (pgType.startsWith('timestamp') || pgType === 'integer' || pgType === 'numeric' || pgType === 'double precision' || pgType === 'real' || pgType === 'bigint' || pgType === 'date')) {
    return null;
  }
  return value;
}

async function main() {
  const src = resolveSource();
  console.log(`Source (read-only): ${src}`);
  const sqlite = new Database(src, { readonly: true });

  const pgTables: string[] = (
    await db('information_schema.tables').where({ table_schema: 'public', table_type: 'BASE TABLE' }).select('table_name')
  )
    .map((r: any) => r.table_name)
    .filter((t: string) => !SKIP.has(t));

  const sqliteTables = new Set<string>(
    (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name),
  );

  const allFks = await fkColumns();
  const colsCache = new Map<string, Map<string, { type: string; nullable: boolean }>>();
  for (const t of pgTables) colsCache.set(t, await pgColumns(t));

  // An edge is "breakable" only if the FK column implementing it is nullable — that is what lets
  // the sort defer it when cycles force a choice.
  const order = topoSort(
    pgTables,
    allFks.map((f) => ({
      child: f.table,
      parent: f.parent,
      breakable: colsCache.get(f.table)?.get(f.column)?.nullable ?? false,
    })),
  );
  const inserted = new Set<string>();
  const deferred: { table: string; cols: string[] }[] = [];
  let totalRows = 0;

  for (const table of order) {
    if (!sqliteTables.has(table)) { inserted.add(table); console.log(`- ${table}: not in source, skipped`); continue; }

    const cols = colsCache.get(table)!;
    // Any FK column pointing at a table that isn't populated yet — a self-reference, or a genuine
    // cycle such as users.employee_id <-> employees.created_by_user_id — is nulled now and restored
    // in the second pass below. This is what lets cyclic schemas load without superuser privileges.
    const pending = [...new Set(allFks.filter((f) => f.table === table && !inserted.has(f.parent)).map((f) => f.column))];
    const defer = pending.filter((c) => cols.get(c)?.nullable);
    const blocked = pending.filter((c) => cols.has(c) && !cols.get(c)!.nullable);
    if (blocked.length) console.warn(`  ! ${table}: NOT NULL FK to un-inserted parent: ${blocked.join(', ')}`);

    const rows = sqlite.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all() as any[];
    inserted.add(table);
    if (!rows.length) { console.log(`- ${table}: 0`); continue; }

    const mapped = rows.map((r) => {
      const o: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        if (!cols.has(k)) continue; // column no longer exists in the Postgres schema
        o[k] = defer.includes(k) ? null : coerce(v, cols.get(k)!.type);
      }
      return o;
    });

    for (let i = 0; i < mapped.length; i += BATCH) {
      await db(table).insert(mapped.slice(i, i + BATCH));
    }
    if (defer.length) deferred.push({ table, cols: defer });
    totalRows += rows.length;
    console.log(`- ${table}: ${rows.length}`);
  }

  // Second pass: restore the deferred foreign keys now that every row exists.
  for (const { table, cols } of deferred) {
    const rows = sqlite.prepare(`SELECT * FROM ${JSON.stringify(table)}`).all() as any[];
    let n = 0;
    for (const r of rows) {
      const patch: Record<string, any> = {};
      for (const c of cols) if (r[c] !== null && r[c] !== undefined) patch[c] = r[c];
      if (Object.keys(patch).length) { await db(table).where({ id: r.id }).update(patch); n++; }
    }
    console.log(`- ${table}: restored ${n} deferred FK rows (${cols.join(', ')})`);
  }

  // Advance id sequences past the copied ids.
  let seqs = 0;
  for (const table of order) {
    // Skip tables with no `id` column (e.g. role_permissions has a composite key) —
    // pg_get_serial_sequence raises rather than returning NULL for a missing column.
    if (!colsCache.get(table)?.has('id')) continue;
    const { rows: got } = await db.raw(`SELECT pg_get_serial_sequence(?, 'id') AS seq`, [table]);
    const seq = got[0]?.seq;
    if (!seq) continue;
    await db.raw(`SELECT setval(?, COALESCE((SELECT MAX(id) FROM ${JSON.stringify(table)}), 1))`, [seq]);
    seqs++;
  }

  console.log(`\nDone. ${totalRows} rows across ${order.length} tables; ${seqs} sequences advanced.`);
  sqlite.close();
  await db.destroy();
}

main().catch(async (e) => {
  console.error('Data migration failed:', e);
  await db.destroy();
  process.exit(1);
});
