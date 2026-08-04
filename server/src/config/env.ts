import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';

// Better Auth secret: reuse JWT_SECRET if a dedicated one isn't set, so a single secret
// still works. Must be ≥32 chars (Better Auth requirement).
const DEV_SECRET = 'saltstayz-hrms-dev-only-secret-key-change-in-production';
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || DEV_SECRET;

if (NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET && !process.env.JWT_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required in production');
}

// PostgreSQL connection string. Dev falls back to a local Postgres so importing this module never
// needs configuration (the pure-logic tests import services that import the db module, and must
// stay database-free — nothing here opens a connection).
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/hrms';

if (NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required in production');
}

// Many hosts (Railway, Fly, Render, Heroku, …) inject the port to bind as PORT; honour it first,
// then our own SERVER_PORT, then the local default. Without this the app would bind 5000 while the
// platform routes to $PORT, and the host would consider the service down.
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '5000', 10);

/**
 * How outbound mail leaves this process. `none` — the default — means it does not.
 *
 *   none    no provider configured. Self-service password reset stays switched OFF and the login
 *           screen does not offer it, because a "check your email" that never arrives is worse
 *           than no button at all.
 *   resend  HTTPS to Resend. Needs MAIL_FROM on a domain whose SPF and DKIM you control.
 *   log     DEVELOPMENT ONLY. Prints the message, code included, to the server console so the
 *           flow can be walked through locally. Refused in production, loudly — see mailer.ts.
 *   memory  TESTS ONLY. Keeps the last message in memory for assertions. Sends nothing.
 */
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || 'none') as 'none' | 'resend' | 'log' | 'memory';

if (NODE_ENV === 'production' && (MAIL_PROVIDER === 'log' || MAIL_PROVIDER === 'memory')) {
  throw new Error(`MAIL_PROVIDER='${MAIL_PROVIDER}' is a development aid and must never run in production`);
}

/**
 * Pepper for the one-time codes, kept OUT of the database.
 *
 * The codes are six digits, so a plain digest of one is a million-entry rainbow table — anyone who
 * can read the `verification` table recovers every live code. Keying the hash means a database
 * compromise alone is not enough. It falls back to the auth secret in development so nothing needs
 * configuring locally, and is required in production for the same reason that secret is.
 */
const OTP_PEPPER = process.env.OTP_PEPPER || BETTER_AUTH_SECRET;

// Keyed on the PROVIDER, not on NODE_ENV. The fallback chain ends at DEV_SECRET, a literal in this
// file and therefore in the repository — so gating the requirement on NODE_ENV === 'production'
// meant a staging or UAT box (NODE_ENV=staging, or unset) sending real codes to real mailboxes
// while the HMAC key protecting them was public, making every live code in `verification`
// recoverable. If mail can actually leave the process, the pepper must be set explicitly.
if (MAIL_PROVIDER === 'resend' && !process.env.OTP_PEPPER) {
  throw new Error('OTP_PEPPER environment variable is required whenever MAIL_PROVIDER can send real mail');
}

export const env = {
  // JWT_* retained during the Better Auth migration; removed once the old path is gone.
  JWT_SECRET: process.env.JWT_SECRET || DEV_SECRET,
  JWT_ROUNDS: 12,
  BETTER_AUTH_SECRET,
  // The API's own base URL (where Better Auth is mounted).
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`,
  SERVER_PORT: PORT,
  // PostgreSQL connection (Knex + Better Auth both use this).
  DATABASE_URL,
  // Managed Postgres (Neon, Supabase, …) requires TLS; a local Postgres normally doesn't.
  DATABASE_SSL: !/localhost|127\.0\.0\.1/.test(DATABASE_URL),
  // LEGACY: path to the old SQLite file. Retained only for the one-time SQLite→Postgres data
  // copy (db/migrate-sqlite-to-pg.ts); nothing in the running app reads it any more.
  DATABASE_PATH: process.env.DATABASE_PATH || path.join(__dirname, '../../data/hrms.db'),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  NODE_ENV,
  // Outbound mail — see MAIL_PROVIDER above. `none` keeps password reset switched off end to end.
  MAIL_PROVIDER,
  MAIL_FROM: process.env.MAIL_FROM || 'SaltStayz HRMS <no-reply@saltstayz.com>',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  OTP_PEPPER,
};
