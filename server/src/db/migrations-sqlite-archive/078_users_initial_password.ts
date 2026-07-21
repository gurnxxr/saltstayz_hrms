import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

// Task 26 — the Admin "User Credentials" screen shows a shareable onboarding
// password per login so admins can copy & hand it to a new hire. Passwords are
// stored as bcrypt hashes (irreversible), so we keep a separate plaintext
// `initial_password`: set whenever an admin creates/resets a login, and cleared
// the moment the user changes their own password (auth.changePassword). Here we
// backfill it for accounts still on the known seed password so the table isn't
// empty on an existing database.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('users', 'initial_password'))) {
    await knex.schema.alterTable('users', (t) => {
      t.string('initial_password', 255).nullable();
    });
  }

  const users = await knex('users').select('id', 'password_hash', 'initial_password');
  for (const u of users) {
    if (u.initial_password) continue;
    try {
      if (u.password_hash && await bcrypt.compare('1234', u.password_hash)) {
        await knex('users').where('id', u.id).update({ initial_password: '1234' });
      }
    } catch { /* unreadable hash — leave null (shows as "changed by user") */ }
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('users', 'initial_password')) {
    await knex.schema.alterTable('users', (t) => { t.dropColumn('initial_password'); });
  }
}
