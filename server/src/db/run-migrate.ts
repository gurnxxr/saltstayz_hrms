import knex from 'knex';
import config from './knexfile';

async function run() {
  const db = knex(config);
  const command = process.argv[2];

  try {
    if (command === 'rollback') {
      const [batch, log] = await db.migrate.rollback(undefined, true);
      console.log(`Rolled back batch ${batch}: ${log.length} migrations`);
    } else if (command === 'seed') {
      const [log] = await db.seed.run();
      console.log(`Ran ${log.length} seed files`);
    } else {
      const [batch, log] = await db.migrate.latest();
      console.log(`Ran batch ${batch}: ${log.length} migrations`);
      log.forEach((f: string) => console.log(`  - ${f}`));
    }
  } catch (err) {
    console.error('Database operation failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

run();
