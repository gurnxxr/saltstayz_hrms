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
};
