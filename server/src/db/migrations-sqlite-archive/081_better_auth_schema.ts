import type { Knex } from 'knex';

// Better Auth adopts the existing `users` table (keeping its integer id, so the ~50 inbound
// foreign keys stay intact) and adds its own session / account / verification tables. This
// migration only creates the schema; migration 082 copies the credentials across.
//
// The user-column additions carry safe defaults / are nullable because `users` is already
// populated (SQLite can't add a NOT NULL column without a default to a non-empty table).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.text('name');                                   // backfilled from the linked employee (082)
    t.boolean('email_verified').notNullable().defaultTo(true); // internal HR app — no email step
    t.text('image');
    t.text('role');                                   // admin-plugin capability (backfilled = role name)
    t.boolean('banned').defaultTo(false);
    t.text('banReason');
    t.timestamp('banExpires');
  });

  // Session — the live server-side session that makes logout / deactivation instant.
  await knex.schema.createTable('session', (t) => {
    t.increments('id').primary();
    t.timestamp('expiresAt').notNullable();
    t.text('token').notNullable().unique();
    t.timestamp('createdAt').notNullable();
    t.timestamp('updatedAt').notNullable();
    t.text('ipAddress');
    t.text('userAgent');
    t.integer('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('impersonatedBy'); // admin-plugin impersonation
  });

  // Account — holds the credential (the bcrypt password) and, in future, any social links.
  await knex.schema.createTable('account', (t) => {
    t.increments('id').primary();
    t.text('accountId').notNullable();
    t.text('providerId').notNullable();
    t.integer('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('accessToken');
    t.text('refreshToken');
    t.text('idToken');
    t.timestamp('accessTokenExpiresAt');
    t.timestamp('refreshTokenExpiresAt');
    t.text('scope');
    t.text('password');
    t.timestamp('createdAt').notNullable();
    t.timestamp('updatedAt').notNullable();
  });

  // Verification — email/identity tokens (unused now; created for completeness / future use).
  await knex.schema.createTable('verification', (t) => {
    t.increments('id').primary();
    t.text('identifier').notNullable();
    t.text('value').notNullable();
    t.timestamp('expiresAt').notNullable();
    t.timestamp('createdAt');
    t.timestamp('updatedAt');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('session');
  await knex.schema.dropTableIfExists('account');
  await knex.schema.dropTableIfExists('verification');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('name');
    t.dropColumn('email_verified');
    t.dropColumn('image');
    t.dropColumn('role');
    t.dropColumn('banned');
    t.dropColumn('banReason');
    t.dropColumn('banExpires');
  });
}
