import type { Knex } from 'knex';

// Records the location/property an employee's attendance was logged at on a given
// day (from the uploaded biometric file). Lets HR analytics break attendance down
// per property/location independent of the employee's home branch.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('attendance_records', 'location'))) {
    await knex.schema.alterTable('attendance_records', (table) => {
      table.string('location', 150);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('attendance_records', 'location')) {
    await knex.schema.alterTable('attendance_records', (table) => {
      table.dropColumn('location');
    });
  }
}
