import type { Knex } from 'knex';

// Immutable audit trail: who did what, when, to which record, and the outcome.
// Populated automatically by the audit middleware for every mutating request.
export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('audit_logs')) return;
  await knex.schema.createTable('audit_logs', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().nullable()
      .references('id').inTable('users').onDelete('SET NULL');
    table.string('actor_email', 160);   // captured at write time for stable display
    table.string('actor_role', 40);
    table.string('action', 40).notNullable();    // create | update | delete | approve | login | ...
    table.string('module', 60).notNullable();     // employees | leave | admin | ...
    table.string('entity', 60);                    // salary-structures | users | requests | ...
    table.string('target_id', 60);                 // affected record id, when present
    table.string('method', 8).notNullable();
    table.string('path', 255).notNullable();
    table.integer('status_code');
    table.string('summary', 255);                  // human-readable one-liner
    table.text('metadata');                        // redacted JSON snapshot of the request body
    table.string('ip_address', 60);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['module']);
    table.index(['action']);
    table.index(['user_id']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
}
