import type { Knex } from 'knex';

/**
 * Drops the biometric tables and the weekly roster, now that nothing reads or writes them.
 *
 * This destroys data and cannot be undone by rolling back — `down()` can recreate the shapes
 * but not their contents. Restoring anything means restoring from a database backup.
 *
 * The roster drop is GUARDED. `patterns:report` derives each shift's off days by reading the
 * roster, and that is the only place that information exists. Dropping the table before those
 * patterns have been worked out and applied would leave every employee falling back to the
 * company Monday-to-Friday week with no way to reconstruct what they actually worked — so this
 * refuses to run in that situation rather than quietly destroying it.
 */

const BIOMETRIC_TABLES = ['biometric_logs', 'biometric_devices', 'biometric_api_keys'];

async function rowCount(knex: Knex, table: string): Promise<number | null> {
  const exists = await knex.schema.hasTable(table);
  if (!exists) return null;
  const row = await knex(table).count('* as c').first();
  return Number((row as any)?.c ?? 0);
}

export async function up(knex: Knex): Promise<void> {
  // ── Biometric: the service, routes and API-key middleware were removed. ──
  for (const table of BIOMETRIC_TABLES) {
    const n = await rowCount(knex, table);
    if (n === null) { console.log(`  ${table}: already gone`); continue; }
    console.log(`  dropping ${table} (${n} row${n === 1 ? '' : 's'})`);
    await knex.schema.dropTableIfExists(table);
  }

  // ── The weekly roster ──
  const rosterRows = await rowCount(knex, 'shift_rosters');
  if (rosterRows === null) {
    console.log('  shift_rosters: already gone');
    return;
  }

  if (rosterRows > 0) {
    // jsonb_array_length errors on a non-array, so only count rows that are one.
    const { rows } = await knex.raw(`
      SELECT count(*)::int AS c
        FROM shift_types
       WHERE jsonb_typeof(weekly_off_days) = 'array'
         AND jsonb_array_length(weekly_off_days) > 0
    `);
    const patterned = Number(rows?.[0]?.c ?? 0);

    if (patterned === 0) {
      throw new Error(
        `Refusing to drop shift_rosters: it still holds ${rosterRows} row(s), and no shift has ` +
        `any off-day pattern set.\n\n` +
        `Those roster rows are the only record of which days each employee had off. Dropping ` +
        `them now would leave everyone on the company Monday-to-Friday week with no way to work ` +
        `out what they actually worked.\n\n` +
        `Run this first, review it, then apply it:\n` +
        `  npm run baseline:capture --workspace=server\n` +
        `  npm run patterns:report  --workspace=server\n` +
        `  npm run patterns:report  --workspace=server -- --apply\n\n` +
        `Then re-run this migration.`,
      );
    }
    console.log(`  ${patterned} shift(s) have an off-day pattern; the roster's job is done`);
  }

  console.log(`  dropping shift_rosters (${rosterRows} row${rosterRows === 1 ? '' : 's'})`);
  await knex.schema.dropTableIfExists('shift_rosters');
}

/**
 * Recreates the table shapes so the schema matches again. The data is NOT restored — that only
 * comes from a database backup.
 */
export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('biometric_api_keys'))) {
    await knex.schema.createTable('biometric_api_keys', (t) => {
      t.increments('id');
      t.string('name', 100).notNullable();
      t.string('key_hash', 255).notNullable();
      t.boolean('is_active').defaultTo(true);
      t.text('last_used_at');
      t.integer('created_by');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('biometric_devices'))) {
    await knex.schema.createTable('biometric_devices', (t) => {
      t.increments('id');
      t.string('serial_number', 100).notNullable().unique();
      t.string('name', 100);
      t.string('location', 150);
      t.boolean('is_active').defaultTo(true);
      t.text('last_seen_at');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }
  if (!(await knex.schema.hasTable('biometric_logs'))) {
    await knex.schema.createTable('biometric_logs', (t) => {
      t.increments('id');
      t.string('employee_code', 20).notNullable();
      t.integer('employee_id');
      t.text('log_datetime').notNullable();
      t.string('device_sn', 100);
      t.string('punch_type', 20);
      t.boolean('is_processed').notNullable().defaultTo(false);
      t.string('status', 20).notNullable().defaultTo('pending');
      t.text('error_message');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['employee_code', 'log_datetime', 'device_sn']);
      t.index(['is_processed']);
    });
  }
  if (!(await knex.schema.hasTable('shift_rosters'))) {
    await knex.schema.createTable('shift_rosters', (t) => {
      t.increments('id');
      t.integer('employee_id').notNullable();
      t.integer('shift_type_id');
      t.text('date').notNullable();
      t.integer('property_id').notNullable();
      t.integer('assigned_by').notNullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.string('day_type', 16).notNullable().defaultTo('working');
      t.boolean('is_published').notNullable().defaultTo(false);
      t.text('published_at');
      t.integer('published_by');
      t.index(['property_id', 'date']);
      t.unique(['employee_id', 'date']);
    });
    console.log('  shift_rosters recreated EMPTY — its contents are only recoverable from a backup');
  }
}
