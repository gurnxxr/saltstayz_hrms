import type { Knex } from 'knex';
import { linkUserProfiles } from '../linkUserProfiles';

/**
 * Runs last: after every employee-loading seed, link any login account whose
 * employee profile came unset (see linkUserProfiles for the matching rules).
 * A no-op on a clean seed run where 03/06 already linked everyone — it earns
 * its keep when employees are re-imported and the FK links go stale.
 */
export async function seed(knex: Knex): Promise<void> {
  await linkUserProfiles(knex);
}
