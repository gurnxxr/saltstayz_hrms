import type { Knex } from 'knex';
import path from 'path';
import { env } from '../config/env';

// Config for the migration/seed CLI (driven by run-migrate.ts). Reads the SAME DATABASE_URL as the
// runtime connection in config/database.ts, so migrate/seed always target the database the app
// actually uses — the old version hard-pointed at the local SQLite file and could drift.
const config: Knex.Config = {
  client: 'pg',
  connection: {
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    extension: 'ts',
  },
  seeds: {
    directory: path.join(__dirname, 'seeds'),
    extension: 'ts',
  },
  pool: { min: 0, max: 5 },
};

export default config;
module.exports = config;
