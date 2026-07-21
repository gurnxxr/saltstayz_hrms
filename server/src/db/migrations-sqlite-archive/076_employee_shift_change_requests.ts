import type { Knex } from 'knex';

// Employee-raised shift-change requests: "on <date> I'm rostered <from>, please
// change me to <to>". A pending request goes to the reporting manager (or HR);
// approving it writes the employee's published roster cell for that date.
// (The legacy `shift_change_requests` table from migration 007 modelled shift-TYPE
//  field edits and is unrelated — left untouched.)
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_shift_change_requests', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.date('date').notNullable(); // the rostered day the employee wants changed
    // Snapshot of what they're rostered now (null shift = weekly-off / unrostered):
    t.integer('from_shift_type_id').unsigned().references('id').inTable('shift_types').onDelete('SET NULL');
    t.string('from_day_type', 20).notNullable().defaultTo('working');
    // What they're requesting (null shift when requesting a weekly off):
    t.integer('to_shift_type_id').unsigned().references('id').inTable('shift_types').onDelete('SET NULL');
    t.string('to_day_type', 20).notNullable().defaultTo('working'); // working | weekly_off
    t.text('reason');
    t.string('status', 20).notNullable().defaultTo('pending'); // pending | approved | rejected
    t.integer('reviewed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.text('review_note');
    t.timestamps(true, true);
    t.index(['employee_id', 'status']);
    t.index(['status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_shift_change_requests');
}
