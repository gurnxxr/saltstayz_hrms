import type { Knex } from 'knex';

/**
 * Onboarding offer-letter lifecycle. The pre-acceptance "case" lives on the
 * candidate row (candidates.employee_id already bridges to the employee created
 * on acceptance), so this is purely additive — no rebuild of the employee-keyed
 * onboarding_checklists / offer_letters tables.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('candidates', (table) => {
    table.string('offer_status', 20);                 // pending | sent | accepted | declined
    table.text('offer_data');                         // JSON snapshot: designation, annual_ctc, joining_date
    table.timestamp('offer_generated_at');
    table.integer('offer_generated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.timestamp('offer_responded_at');
  });

  await knex.schema.alterTable('onboarding_items', (table) => {
    table.string('document_name', 255);               // original filename (document_url already stores the path)
  });
}

export async function down(knex: Knex): Promise<void> {
  // SQLite: one dropColumn per alterTable call.
  await knex.schema.alterTable('onboarding_items', (table) => { table.dropColumn('document_name'); });
  await knex.schema.alterTable('candidates', (table) => { table.dropColumn('offer_responded_at'); });
  await knex.schema.alterTable('candidates', (table) => { table.dropColumn('offer_generated_by'); });
  await knex.schema.alterTable('candidates', (table) => { table.dropColumn('offer_generated_at'); });
  await knex.schema.alterTable('candidates', (table) => { table.dropColumn('offer_data'); });
  await knex.schema.alterTable('candidates', (table) => { table.dropColumn('offer_status'); });
}
