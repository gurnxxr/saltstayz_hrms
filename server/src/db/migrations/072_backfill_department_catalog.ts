import type { Knex } from 'knex';

// The Roster (and other screens) treat the `departments` table as the catalog of
// real departments, but employees carry `dept_name` as free text — so staff have
// historically ended up in departments the catalog never listed (e.g. "Security").
// This one-time backfill reconciles the catalog with reality: every distinct
// department name actually in use on an employee but missing from `departments`
// is inserted. Idempotent — a case-insensitive guard against the existing catalog
// makes re-runs no-ops. Paired with the employee editor now offering departments
// as a pick-list, the catalog and the real data stop drifting apart.
export async function up(knex: Knex): Promise<void> {
  const inUse: Array<{ dept_name: string | null }> = await knex('employees')
    .distinct('dept_name')
    .whereNotNull('dept_name')
    .andWhere('dept_name', '!=', '');

  const existing: string[] = await knex('departments').pluck('name');
  const seen = new Set(existing.map((n) => (n ?? '').trim().toLowerCase()));

  const toAdd: string[] = [];
  for (const row of inUse) {
    const name = (row.dept_name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    toAdd.push(name);
  }

  if (toAdd.length) {
    await knex('departments').insert(toAdd.map((name) => ({ name })));
  }
}

// Data backfill — down is a deliberate no-op. Removing catalog rows on rollback
// could orphan employees whose dept_name matches, and a department added here may
// since have been assigned or relied upon.
export async function down(): Promise<void> {
  // no-op
}
