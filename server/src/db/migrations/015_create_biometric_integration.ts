import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('biometric_api_keys', (table) => {
    table.increments('id');
    table.string('name', 100).notNullable();
    table.string('key_hash', 255).notNullable().unique();
    table.string('key_prefix', 8).notNullable();
    table.boolean('is_active').defaultTo(true);
    table.string('allowed_ips', 500).nullable();
    table.timestamp('last_used_at').nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable('biometric_logs', (table) => {
    table.increments('id');
    table.string('employee_code', 20).notNullable();
    table.integer('employee_id').unsigned().nullable().references('id').inTable('employees').onDelete('SET NULL');
    table.datetime('log_datetime').notNullable();
    table.string('log_time', 8).notNullable();
    table.string('device_sn', 100).notNullable();
    table.datetime('downloaded_at').nullable();
    table.string('status', 20).defaultTo('pending');
    table.boolean('is_processed').defaultTo(false);
    table.string('processing_error', 255).nullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable('biometric_devices', (table) => {
    table.increments('id');
    table.string('serial_number', 100).notNullable().unique();
    table.string('name', 100).nullable();
    table.string('location', 200).nullable();
    table.boolean('is_active').defaultTo(true);
    table.datetime('last_seen_at').nullable();
    table.timestamps(true, true);
  });

  await knex.raw(`
    CREATE INDEX idx_bio_logs_emp_date ON biometric_logs(employee_code, log_datetime);
  `);
  await knex.raw(`
    CREATE INDEX idx_bio_logs_unprocessed ON biometric_logs(is_processed) WHERE is_processed = 0;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('biometric_logs');
  await knex.schema.dropTableIfExists('biometric_devices');
  await knex.schema.dropTableIfExists('biometric_api_keys');
}
