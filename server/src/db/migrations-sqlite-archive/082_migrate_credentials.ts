import type { Knex } from 'knex';

// Move existing credentials into Better Auth's model without disrupting anyone:
//  - backfill users.name (from the linked employee) and users.role (the role NAME, which the
//    admin plugin uses to decide who may manage users);
//  - create a `credential` account row per user carrying the SAME bcrypt password_hash, so
//    everyone signs in with their current password (Better Auth verifies bcrypt);
//  - clear the plaintext initial_password column — no readable passwords remain.
export async function up(knex: Knex): Promise<void> {
  // 1. Names — "First Last" from the linked employee, else the email.
  await knex.raw(`
    UPDATE users SET name = COALESCE(
      (SELECT TRIM(e.first_name || ' ' || e.last_name) FROM employees e WHERE e.id = users.employee_id),
      email
    ) WHERE name IS NULL OR name = ''
  `);

  // 2. Admin-plugin role = the app's role name (so 'admin' users can manage logins).
  await knex.raw(`
    UPDATE users SET role = (SELECT r.name FROM roles r WHERE r.id = users.role_id) WHERE role IS NULL
  `);

  // 3. One credential account per user, carrying the existing bcrypt hash. Idempotent.
  const users = await knex('users').select('id', 'password_hash');
  const now = new Date().toISOString();
  for (const u of users as any[]) {
    if (!u.password_hash) continue;
    const exists = await knex('account')
      .where({ userId: u.id, providerId: 'credential' }).first();
    if (exists) continue;
    await knex('account').insert({
      accountId: String(u.id),
      providerId: 'credential',
      userId: u.id,
      password: u.password_hash,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 4. Remove the stored plaintext passwords (the security fix). The column itself is left in
  //    place (dropping it would require rebuilding the FK-referenced users table); it is now
  //    always NULL and no longer read.
  await knex('users').update({ initial_password: null });
}

export async function down(knex: Knex): Promise<void> {
  // Remove the credential accounts this migration created; leave the backfilled name/role in
  // place (harmless) and the cleared plaintext as-is (not restorable, by design).
  await knex('account').where('providerId', 'credential').del();
}
