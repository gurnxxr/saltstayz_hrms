import type { Knex } from 'knex';

// Runs after every user-creating seed. Completes each login for Better Auth so a fresh
// db:reset produces working sign-ins: backfill the Better Auth user columns, create a
// `credential` account from the bcrypt password_hash, and clear any plaintext password.
// Mirrors migration 082 (which handles an already-populated live DB); this handles the
// freshly-seeded case, where 082 ran before any users existed. Idempotent.
export async function seed(knex: Knex): Promise<void> {
  await knex.raw(`
    UPDATE users SET name = COALESCE(
      (SELECT TRIM(e.first_name || ' ' || e.last_name) FROM employees e WHERE e.id = users.employee_id),
      email
    ) WHERE name IS NULL OR name = ''
  `);
  await knex.raw(`UPDATE users SET role = (SELECT r.name FROM roles r WHERE r.id = users.role_id) WHERE role IS NULL`);
  await knex('users').whereNull('email_verified').update({ email_verified: 1 });

  const users = await knex('users').select('id', 'password_hash');
  const now = new Date().toISOString();
  for (const u of users as any[]) {
    if (!u.password_hash) continue;
    const exists = await knex('account').where({ userId: u.id, providerId: 'credential' }).first();
    if (exists) continue;
    await knex('account').insert({
      accountId: String(u.id), providerId: 'credential', userId: u.id,
      password: u.password_hash, createdAt: now, updatedAt: now,
    });
  }

  // No plaintext passwords are kept — credentials live only as hashes in `account`.
  await knex('users').update({ initial_password: null });
}
