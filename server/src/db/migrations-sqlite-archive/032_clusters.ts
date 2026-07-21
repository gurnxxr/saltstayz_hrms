import type { Knex } from 'knex';

// Properties belong to a cluster (a regional grouping). Cluster HR users are scoped
// to one or more clusters via user_clusters, so they can only act on properties in
// their cluster(s). Cluster also drives the roll-up views in Property Analytics.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('clusters'))) {
    await knex.schema.createTable('clusters', (t) => {
      t.increments('id').primary();
      t.string('name', 100).notNullable().unique();
      t.text('description');
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasColumn('properties', 'cluster_id'))) {
    // Plain column (no inline FK): adding an FK column to an existing SQLite table
    // forces a full table rebuild, which fails because other tables reference
    // properties. The cluster link is enforced in app code.
    await knex.schema.alterTable('properties', (t) => {
      t.integer('cluster_id').unsigned();
    });
  }

  if (!(await knex.schema.hasTable('user_clusters'))) {
    await knex.schema.createTable('user_clusters', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable()
        .references('id').inTable('users').onDelete('CASCADE');
      t.integer('cluster_id').unsigned().notNullable()
        .references('id').inTable('clusters').onDelete('CASCADE');
      t.unique(['user_id', 'cluster_id']);
      t.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_clusters');
  if (await knex.schema.hasColumn('properties', 'cluster_id')) {
    await knex.schema.alterTable('properties', (t) => { t.dropColumn('cluster_id'); });
  }
  await knex.schema.dropTableIfExists('clusters');
}
