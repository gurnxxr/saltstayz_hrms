import type { Knex } from 'knex';

// Applicants uploaded via CSV carry an address (Name / Phone / Address / Resume
// Link / Email). Every other field already exists on `candidates` (name, phone,
// email, resume_url); only address was missing.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('candidates', 'address'))) {
    await knex.schema.alterTable('candidates', (t) => {
      t.string('address', 500);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('candidates', 'address')) {
    await knex.schema.alterTable('candidates', (t) => {
      t.dropColumn('address');
    });
  }
}
