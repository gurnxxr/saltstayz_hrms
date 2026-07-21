import type { Knex } from 'knex';

// Audit log of every attendance CSV upload — who uploaded, when (created_at), the
// file, row outcomes, the date range covered, and the result status. Powers the
// "upload history" view and the daily upload reminder.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('attendance_upload_logs')) return;
  await knex.schema.createTable('attendance_upload_logs', (t) => {
    t.increments('id').primary();
    t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('uploaded_by_email', 255); // snapshot (survives user deletion)
    t.string('file_name', 255);
    t.integer('rows_total').notNullable().defaultTo(0);
    t.integer('rows_created').notNullable().defaultTo(0);
    t.integer('rows_updated').notNullable().defaultTo(0);
    t.integer('rows_skipped').notNullable().defaultTo(0);
    t.integer('unmatched_count').notNullable().defaultTo(0);
    t.string('date_from', 10);   // earliest attendance date in the file
    t.string('date_to', 10);     // latest attendance date in the file
    t.integer('dates_count').notNullable().defaultTo(0);
    t.text('locations');         // comma-joined property/location names seen
    t.string('status', 12).notNullable().defaultTo('success'); // success | partial | failed
    t.text('error_note');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('attendance_upload_logs');
}
