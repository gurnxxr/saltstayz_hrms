import type { Knex } from 'knex';

// Shift types become organization-wide (not scoped to a property), and a new
// per-employee assignment table lets admin set/change any employee's shift.
export async function up(knex: Knex): Promise<void> {
  // De-duplicate shift types by name, repointing references, then enforce uniqueness.
  const all = await knex('shift_types').select('id', 'name').orderBy('id');
  const canonical = new Map<string, number>();
  for (const s of all) if (!canonical.has(s.name)) canonical.set(s.name, s.id);
  for (const s of all) {
    const keep = canonical.get(s.name)!;
    if (keep !== s.id) {
      await knex('shift_rosters').where('shift_type_id', s.id).update({ shift_type_id: keep });
      await knex('shift_change_requests').where('shift_type_id', s.id).update({ shift_type_id: keep });
      await knex('shift_types').where('id', s.id).del();
    }
  }

  // The legacy NOT NULL property_id column is retained (dropping/altering it forces a
  // SQLite table rebuild that conflicts with the RESTRICT FK from shift_rosters). It is
  // simply ignored everywhere now — uniqueness is enforced on name, making shift types
  // organization-wide.
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS shift_types_name_unique ON shift_types(name)');

  if (!(await knex.schema.hasTable('employee_shift_assignments'))) {
    await knex.schema.createTable('employee_shift_assignments', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable().unique()
        .references('id').inTable('employees').onDelete('CASCADE');
      table.integer('shift_type_id').unsigned().notNullable()
        .references('id').inTable('shift_types').onDelete('RESTRICT');
      table.integer('assigned_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_shift_assignments');
  await knex.raw('DROP INDEX IF EXISTS shift_types_name_unique');
}
