import knex from 'knex';
import { env } from './env';

const db = knex({
  client: 'better-sqlite3',
  connection: {
    // Persistent-volume path in production; repo-local default in dev. See env.DATABASE_PATH.
    filename: env.DATABASE_PATH,
  },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn: any, cb: any) => {
      conn.pragma('journal_mode = WAL');
      conn.pragma('foreign_keys = ON');
      // Wait up to 5s for a held lock instead of throwing SQLITE_BUSY instantly.
      // With WAL + a knex connection pool and an audit-log write on nearly every
      // request, two pooled connections can contend; without this a transient
      // busy error surfaces as a generic 500 (e.g. a login that only works on
      // the retry). The driver retries internally within the timeout.
      conn.pragma('busy_timeout = 5000');
      cb();
    },
  },
});

export default db;
