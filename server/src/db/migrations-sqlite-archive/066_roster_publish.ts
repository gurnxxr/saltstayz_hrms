import type { Knex } from 'knex';

// Shift Rebuild Phase 1 — Roster + publish lifecycle.
//
// The dated roster (shift_rosters) is payroll's source of truth but was never
// writable from the UI and had no publish state, so it stayed empty and every
// employee fell back to the org Mon-Fri work week. This makes the roster a real,
// publishable weekly plan:
//   • shift_type_id becomes nullable so a cell can be an explicit Weekly Off
//     (day_type='weekly_off', no shift) rather than merely a missing row;
//   • is_published / published_at / published_by gate the roster — payroll reads
//     only PUBLISHED rows, so an in-progress draft never contaminates pay.
//
// Any pre-existing roster rows are stamped published so current behaviour is
// unchanged (in practice the table is empty today).

export async function up(knex: Knex): Promise<void> {
  // shift_type_id must allow NULL for weekly-off cells.
  await knex.schema.alterTable('shift_rosters', (t) => {
    t.setNullable('shift_type_id');
  });

  const has = async (c: string) => knex.schema.hasColumn('shift_rosters', c);
  if (!(await has('day_type'))) {
    await knex.schema.alterTable('shift_rosters', (t) => t.string('day_type', 16).notNullable().defaultTo('working'));
  }
  if (!(await has('is_published'))) {
    await knex.schema.alterTable('shift_rosters', (t) => t.boolean('is_published').notNullable().defaultTo(false));
  }
  if (!(await has('published_at'))) {
    await knex.schema.alterTable('shift_rosters', (t) => t.timestamp('published_at'));
  }
  if (!(await has('published_by'))) {
    await knex.schema.alterTable('shift_rosters', (t) => t.integer('published_by').unsigned().references('id').inTable('users').onDelete('SET NULL'));
  }

  // Preserve current behaviour for any rows that already exist.
  await knex('shift_rosters').update({ is_published: true });
}

export async function down(knex: Knex): Promise<void> {
  for (const col of ['published_by', 'published_at', 'is_published', 'day_type']) {
    if (await knex.schema.hasColumn('shift_rosters', col)) {
      await knex.schema.alterTable('shift_rosters', (t) => t.dropColumn(col));
    }
  }
  // Leave shift_type_id nullable on rollback (SQLite dropNullable rebuild is lossy);
  // acceptable given the forward-only posture.
}
