import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('attendance_records', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.date('date').notNullable();
    table.timestamp('check_in');
    table.timestamp('check_out');
    table.string('status', 20).defaultTo('present');
    table.decimal('working_hours', 4, 2);
    table.unique(['employee_id', 'date']);
    table.timestamps(true, true);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance_records(employee_id, date)');

  await knex.schema.createTable('attendance_regularisations', (table) => {
    table.increments('id').primary();
    table.integer('attendance_id').unsigned().references('id').inTable('attendance_records').onDelete('CASCADE');
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.timestamp('requested_check_in');
    table.timestamp('requested_check_out');
    table.text('reason');
    table.string('status', 20).defaultTo('pending');
    table.integer('approved_by').unsigned().references('id').inTable('employees').onDelete('SET NULL');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attendance_regularisations');
  await knex.schema.dropTableIfExists('attendance_records');
}
