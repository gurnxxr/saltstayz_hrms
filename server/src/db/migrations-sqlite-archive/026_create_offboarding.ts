import type { Knex } from 'knex';

// Offboarding / exit workflow — the mirror of onboarding. A case tracks an
// employee's exit from resignation through clearance and Full & Final settlement
// to completion (which deactivates the employee + their login and records the exit).
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('offboarding_cases'))) {
    await knex.schema.createTable('offboarding_cases', (table) => {
      table.increments('id').primary();
      table.integer('employee_id').unsigned().notNullable().unique()
        .references('id').inTable('employees').onDelete('CASCADE');
      // initiated → in_progress → cleared → completed
      table.string('status', 20).notNullable().defaultTo('initiated');
      // resignation | termination | retirement | end_of_contract | absconding
      table.string('exit_type', 30).notNullable().defaultTo('resignation');
      table.text('reason');
      table.date('resignation_date');
      table.date('last_working_day').notNullable();
      table.integer('notice_period_days').defaultTo(0);
      table.text('exit_interview_notes');
      table.decimal('fnf_amount', 12, 2);
      table.text('fnf_details');            // JSON snapshot of the settlement components
      table.integer('initiated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.timestamp('completed_at');
      table.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('offboarding_items'))) {
    await knex.schema.createTable('offboarding_items', (table) => {
      table.increments('id').primary();
      table.integer('case_id').unsigned().notNullable()
        .references('id').inTable('offboarding_cases').onDelete('CASCADE');
      table.string('category', 40).notNullable().defaultTo('General'); // IT | Finance | HR | Admin | Manager
      table.string('item_name', 200).notNullable();
      table.boolean('is_completed').defaultTo(false);
      table.timestamp('completed_at');
      table.integer('verified_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      table.text('notes');
      table.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('offboarding_items');
  await knex.schema.dropTableIfExists('offboarding_cases');
}
