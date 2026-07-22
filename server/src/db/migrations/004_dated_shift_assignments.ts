import type { Knex } from 'knex';

/**
 * Lets an employee's shift change from a date, instead of being a single row that only ever
 * describes the present.
 *
 * This is what keeps history reproducible. Once the weekly grid is gone, the only way to know
 * which shift someone was on in a past month is the mapping — so it has to remember that they
 * moved from Morning to Night on a given date, rather than just holding wherever they are now.
 *
 * Existing rows are stamped with the date they were recorded. Anything earlier than that is
 * resolved by falling back to the employee's earliest assignment, so no historical date is
 * left without a shift.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.text('effective_from');
  });

  // Stamp existing rows with the day the assignment was recorded.
  await knex.raw(`
    UPDATE employee_shift_assignments
       SET effective_from = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
     WHERE effective_from IS NULL
  `);
  // Belt and braces for any row with no created_at.
  await knex('employee_shift_assignments').whereNull('effective_from').update({ effective_from: '2000-01-01' });

  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.text('effective_from').notNullable().alter();
    // One shift per employee per start date, rather than one shift per employee ever.
    t.dropUnique(['employee_id']);
    t.unique(['employee_id', 'effective_from']);
    t.index(['employee_id', 'effective_from'], 'esa_employee_effective_index');
  });

  const n = await knex('employee_shift_assignments').count('id as c').first();
  console.log(`  ${n?.c} assignment(s) now dated`);
}

export async function down(knex: Knex): Promise<void> {
  // Collapse back to one row per employee, keeping the most recent.
  await knex.raw(`
    DELETE FROM employee_shift_assignments a
     USING employee_shift_assignments b
     WHERE a.employee_id = b.employee_id
       AND (a.effective_from < b.effective_from
            OR (a.effective_from = b.effective_from AND a.id < b.id))
  `);
  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.dropIndex(['employee_id', 'effective_from'], 'esa_employee_effective_index');
    t.dropUnique(['employee_id', 'effective_from']);
    t.unique(['employee_id']);
    t.dropColumn('effective_from');
  });
}
