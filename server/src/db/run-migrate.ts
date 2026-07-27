import knex from 'knex';
import config from './knexfile';

async function run() {
  const db = knex(config);
  const command = process.argv[2];

  try {
    if (command === 'rollback') {
      const [batch, log] = await db.migrate.rollback(undefined, true);
      console.log(`Rolled back batch ${batch}: ${log.length} migrations`);
    } else if (command === 'up') {
      // ONE migration, then stop. When a migration changes what people are paid, running it on
      // its own is the difference between "this figure moved because of that change" and a batch
      // of four where nobody can say which one did it.
      const [batch, log] = await db.migrate.up();
      console.log(log.length
        ? `Applied ${log.length} migration(s) in batch ${batch}:`
        : 'Nothing pending.');
      log.forEach((f: string) => console.log(`  - ${f}`));
    } else if (command === 'down') {
      // Undo exactly one. `db:rollback` passes all=true, so it unwinds the ENTIRE history —
      // useful for a reset, useless for checking that one migration's down() actually works.
      const [batch, log] = await db.migrate.down();
      console.log(log.length
        ? `Rolled back ${log.length} migration(s) from batch ${batch}:`
        : 'Nothing to roll back.');
      log.forEach((f: string) => console.log(`  - ${f}`));
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
