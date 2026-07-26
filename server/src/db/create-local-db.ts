/**
 * Creates the local development database named in DATABASE_URL, if it doesn't exist yet.
 *
 * Postgres has no "CREATE DATABASE IF NOT EXISTS", and you can't create a database from
 * inside itself — so this connects to the `postgres` maintenance database using the same
 * credentials and creates the target from there.
 *
 * One-time setup for a fresh local Postgres. Run it, then `npm run db:migrate` and
 * `npm run db:seed`. It never touches an existing database and prints no credentials.
 */
import 'dotenv/config';
import { Client } from 'pg';

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set — check server/.env');
  if (/PUT_YOUR_POSTGRES_PASSWORD_HERE/.test(raw)) {
    throw new Error('DATABASE_URL still has the placeholder password — edit server/.env first.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'DATABASE_URL could not be parsed. If your password contains @ : / ? # or %, ' +
      'those characters must be percent-encoded (e.g. @ becomes %40).',
    );
  }

  const target = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!target) throw new Error('DATABASE_URL has no database name at the end of the path');

  // Same host/credentials, but connect to the always-present maintenance database.
  const admin = new URL(raw);
  admin.pathname = '/postgres';

  const client = new Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (err: any) {
    if (err?.code === '28P01') throw new Error('Password authentication failed for the Postgres user in DATABASE_URL.');
    if (err?.code === 'ECONNREFUSED') throw new Error(`Nothing is accepting connections at ${url.host}. Is the Postgres service running?`);
    throw err;
  }

  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [target]);
    if (rows.length) {
      console.log(`Database "${target}" already exists — leaving it alone.`);
    } else {
      // The name can't be parameterised in DDL, so quote it as an identifier instead.
      await client.query(`CREATE DATABASE "${target.replace(/"/g, '""')}"`);
      console.log(`Created database "${target}".`);
    }
    const ver = await client.query('SHOW server_version');
    console.log(`Connected to PostgreSQL ${ver.rows[0].server_version} at ${url.host}.`);
  } finally {
    await client.end();
  }

  console.log('\nNext:  npm run db:migrate --workspace=server');
  console.log('       npm run db:seed    --workspace=server');
}

main().catch((err) => {
  console.error(`\n${err.message}\n`);
  process.exit(1);
});
