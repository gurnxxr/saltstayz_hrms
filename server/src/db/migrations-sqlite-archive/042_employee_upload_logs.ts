import type { Knex } from 'knex';

// Persist the outcome of each employee bulk CSV upload (mirrors attendance_upload_logs)
// so HR keeps a durable record of created/updated/skipped counts AND the per-row
// errors — instead of a toast/modal that vanishes on close.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_upload_logs', (t) => {
    t.increments('id').primary();
    t.integer('uploaded_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.string('uploaded_by_email', 255); // snapshot (survives user deletion)
    t.string('file_name', 255);
    t.integer('rows_total').notNullable().defaultTo(0);
    t.integer('rows_created').notNullable().defaultTo(0);
    t.integer('rows_updated').notNullable().defaultTo(0);
    t.integer('rows_skipped').notNullable().defaultTo(0);
    t.text('errors');           // JSON-encoded string[] of skip/error messages
    t.string('status', 12).notNullable().defaultTo('success'); // success | partial | failed
    t.text('error_note');       // whole-file failure (e.g. bad header)
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_upload_logs');
}
