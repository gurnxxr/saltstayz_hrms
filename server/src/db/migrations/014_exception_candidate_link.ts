import type { Knex } from 'knex';

// A blocked recruitment offer can now raise an approval request that stays tied to the candidate it
// is for: candidate_id links the exception to the pipeline candidate (null for the standalone
// manpower "Add Hire" flow, which mints its own employee on approval). consumed_at marks when an
// approved request was actually spent by a hire, so one approval can't wave through repeated hires.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('manpower_exceptions', (t) => {
    t.integer('candidate_id').references('id').inTable('candidates').onDelete('SET NULL');
    t.timestamp('consumed_at', { useTz: true });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('manpower_exceptions', (t) => {
    t.dropColumn('candidate_id');
    t.dropColumn('consumed_at');
  });
}
