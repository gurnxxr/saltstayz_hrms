import type { Knex } from 'knex';

// In-app notifications, delivered to a recipient user. The notify() seam in the
// service is provider-agnostic, so email/SMS delivery can be layered on later
// without touching call sites.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('notifications')) return;
  await knex.schema.createTable('notifications', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.string('type', 40).notNullable().defaultTo('info'); // leave_approved | payslip_ready | ...
    table.string('title', 160).notNullable();
    table.text('message');
    table.string('link', 255);          // client-side href to open on click
    table.boolean('is_read').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['user_id', 'is_read']);
    table.index(['user_id', 'created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notifications');
}
