import type { Knex } from 'knex';

// Departments become organization-wide (shared across all properties) instead of
// being defined separately per property. We de-duplicate by name, repoint any
// vacancies onto the surviving (canonical) department row, and enforce uniqueness
// on name.
//
// Note: the legacy `property_id` column is intentionally NOT dropped — doing so
// forces a SQLite table rebuild that conflicts with the RESTRICT foreign key from
// `vacancies.department_id` inside a migration transaction. Instead it is nulled
// out and left unused (no code references it any more).
export async function up(knex: Knex): Promise<void> {
  const all = await knex('departments').select('id', 'name').orderBy('id');
  const canonical = new Map<string, number>();
  for (const d of all) {
    if (!canonical.has(d.name)) canonical.set(d.name, d.id);
  }
  for (const d of all) {
    const keep = canonical.get(d.name)!;
    if (keep !== d.id) {
      await knex('vacancies').where('department_id', d.id).update({ department_id: keep });
      await knex('departments').where('id', d.id).del();
    }
  }

  if (await knex.schema.hasColumn('departments', 'property_id')) {
    await knex('departments').update({ property_id: null });
  }

  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS departments_name_unique ON departments(name)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS departments_name_unique');
}
