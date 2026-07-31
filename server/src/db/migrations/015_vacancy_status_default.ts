import type { Knex } from 'knex';

/**
 * Vacancies were created with the DB column default `status = 'open'`, but the app's status
 * taxonomy (and the recruitment filter tabs) is 'new_role' / 'listed' / 'closed'. An 'open'
 * vacancy therefore matched no tab and only showed under "All".
 *
 * Align the column default with the taxonomy and rewrite the stragglers to 'new_role' (step 1
 * of the funnel). createVacancy also now sets the status explicitly.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw("ALTER TABLE vacancies ALTER COLUMN status SET DEFAULT 'new_role'");
  await knex('vacancies').where('status', 'open').update({ status: 'new_role' });
}

export async function down(knex: Knex): Promise<void> {
  // Revert only the default. Do NOT rewrite 'new_role' back to 'open' — that would also hit
  // genuinely new_role vacancies created since, which never carried the legacy value.
  await knex.raw("ALTER TABLE vacancies ALTER COLUMN status SET DEFAULT 'open'");
}
