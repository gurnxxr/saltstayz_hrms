import type { Knex } from 'knex';

// Lets recruitment park a candidate at any active stage without advancing or rejecting them.
// on_hold blocks stage changes until resumed; hold_reason records why (required to hold).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('candidates', (t) => {
    t.boolean('on_hold').notNullable().defaultTo(false);
    t.text('hold_reason');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('candidates', (t) => {
    t.dropColumn('on_hold');
    t.dropColumn('hold_reason');
  });
}
