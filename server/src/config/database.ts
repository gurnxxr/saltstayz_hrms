import knex from 'knex';
import { env } from './env';

// PostgreSQL. Unlike the previous SQLite setup there are no pragmas to apply: Postgres enforces
// foreign keys natively and handles concurrent writers with MVCC, so the old
// journal_mode/foreign_keys/busy_timeout dance (and the SQLITE_BUSY 500s it guarded against) is
// gone. The pool is a real connection pool — keep max modest so a small managed instance
// (e.g. Neon's free tier) isn't exhausted by one app instance.
const db = knex({
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    // Managed Postgres terminates TLS with its own CA; a local Postgres runs without TLS.
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  },
  pool: { min: 0, max: 10 },
});

export default db;
