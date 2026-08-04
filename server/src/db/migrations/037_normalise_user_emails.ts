import type { Knex } from 'knex';

/**
 * Store login emails in lowercase, so every lookup agrees about which account is which.
 *
 * Better Auth resolves an account by lowercasing the address it is given and comparing it to
 * `users.email` with plain equality. An account stored as `Priya@saltstayz.com` therefore matches
 * nothing, and self-service password reset silently did nothing for that person while spending one
 * of their three codes per fifteen minutes. `passwordReset.service` now agrees with Better Auth
 * rather than being more permissive, which stops the budget drain — but the person still could not
 * recover their own password until the stored value itself is normalised.
 *
 * `users.email` carries a UNIQUE constraint (baseline migration, `t.unique(['email'])`), so this
 * REFUSES rather than guesses if two rows differ only by case: merging two logins is a decision for
 * a person, not a migration. Nothing in dev is affected (0 of 31 rows); production is not assumed
 * to look the same, which is exactly why the check is here.
 */
export async function up(knex: Knex): Promise<void> {
  const collisions = await knex('users')
    .select(knex.raw('lower(email) as normalised'))
    .count('* as n')
    .groupByRaw('lower(email)')
    .havingRaw('count(*) > 1');

  if (collisions.length) {
    const list = collisions.map((c: any) => c.normalised).join(', ');
    throw new Error(
      `Cannot normalise users.email: ${collisions.length} address(es) exist in more than one casing `
      + `and users.email is UNIQUE. Merge or remove the duplicates by hand first: ${list}`,
    );
  }

  await knex('users').update({ email: knex.raw('lower(email)') }).whereRaw('email <> lower(email)');
}

/**
 * Irreversible by design. The original casing is not recorded anywhere, so there is nothing to put
 * back; lowercase addresses are valid input to every path that reads them, so leaving them is safe.
 */
export async function down(): Promise<void> {
  // no-op
}
