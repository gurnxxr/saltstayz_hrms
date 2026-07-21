import type { Knex } from 'knex';

// Payroll Phase 2: component-based salary structures + per-employee assignments.
//
// A structure is a named template (one per employee category/designation) made of
// salary_components lines with value rules; each employee is assigned a structure
// plus a base amount. Replaces the legacy per-designation percentage columns
// (designation_salary_structures) and per-employee salary_setup, which stop being
// read after this phase.
export async function up(knex: Knex): Promise<void> {
  // Migration 009 created a per-employee `salary_structures` table that was
  // superseded by salary_setup/designation_salary_structures and never used
  // (0 rows, no code references). Clear it so the v2 table can take the name.
  if (await knex.schema.hasTable('salary_structures') && !(await knex.schema.hasColumn('salary_structures', 'name'))) {
    const legacyCount = await knex('salary_structures').count('id as c').first();
    if (Number((legacyCount as any)?.c || 0) > 0) {
      throw new Error('Legacy salary_structures table unexpectedly has rows — aborting.');
    }
    await knex.schema.dropTable('salary_structures');
  }

  await knex.schema.createTable('salary_structures', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.text('description');
    t.integer('job_title_id'); // optional category link — powers offers/JD/new-hire defaults
    t.string('payment_basis', 10).notNullable().defaultTo('monthly'); // monthly | hourly
    t.decimal('default_base', 12, 2).notNullable().defaultTo(0); // reference gross (or hourly rate)
    t.string('city', 50).notNullable().defaultTo('Haryana');     // statutory state resolution
    t.boolean('is_active').defaultTo(true);
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS salary_structures_name_unique ON salary_structures(name)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS salary_structures_job_title_unique ON salary_structures(job_title_id) WHERE job_title_id IS NOT NULL');

  await knex.schema.createTable('salary_structure_components', (t) => {
    t.increments('id').primary();
    t.integer('structure_id').unsigned().notNullable().references('id').inTable('salary_structures').onDelete('CASCADE');
    t.integer('component_id').unsigned().notNullable().references('id').inTable('salary_components').onDelete('RESTRICT');
    t.string('calculation_type', 20).notNullable().defaultTo('flat'); // flat | pct_of_base | pct_of_basic | remainder
    t.decimal('value', 12, 4).notNullable().defaultTo(0);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.unique(['structure_id', 'component_id']);
  });

  await knex.schema.createTable('salary_structure_assignments', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().unique()
      .references('id').inTable('employees').onDelete('CASCADE');
    t.integer('structure_id').unsigned().notNullable()
      .references('id').inTable('salary_structures').onDelete('RESTRICT');
    t.decimal('base', 12, 2).notNullable(); // monthly gross (or hourly rate for hourly basis)
    t.date('effective_from');
    t.integer('assigned_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('salary_structure_assignments');
  await knex.schema.dropTableIfExists('salary_structure_components');
  await knex.raw('DROP INDEX IF EXISTS salary_structures_job_title_unique');
  await knex.raw('DROP INDEX IF EXISTS salary_structures_name_unique');
  await knex.schema.dropTableIfExists('salary_structures');

  // up() replaced migration 009's per-employee `salary_structures` table with the v2
  // designation-level one. The `payslips` table (also from 009) still holds a foreign key
  // to `salary_structures`; dropping the v2 table above would leave that FK dangling and
  // abort the rest of a `db:rollback` / `db:reset` batch. Recreate the legacy 009-shape
  // table (empty) so the FK target exists — 009's own down() drops it at the end.
  if (!(await knex.schema.hasTable('salary_structures'))) {
    await knex.schema.createTable('salary_structures', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
      table.decimal('basic', 12, 2).notNullable();
      table.decimal('hra', 12, 2).defaultTo(0);
      table.decimal('da', 12, 2).defaultTo(0);
      table.decimal('special_allowance', 12, 2).defaultTo(0);
      table.decimal('gross', 12, 2).notNullable();
      table.decimal('pf_deduction', 12, 2).defaultTo(0);
      table.decimal('esi_deduction', 12, 2).defaultTo(0);
      table.decimal('tax_deduction', 12, 2).defaultTo(0);
      table.decimal('net_salary', 12, 2).notNullable();
      table.date('effective_from').notNullable();
      table.timestamps(true, true);
    });
  }
}
