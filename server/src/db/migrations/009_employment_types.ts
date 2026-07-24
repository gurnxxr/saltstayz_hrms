import type { Knex } from 'knex';

/**
 * Employment Types master (Admin → Employment Types). A catalogue of the ways a
 * person can be employed — Confirmed, Probation, Intern, Trainee, Contract — each
 * carrying the variables HR configures per type:
 *   • is_confirmed          — does this type represent a confirmed employee?
 *   • prefix                — short code (C, P, I, T, CON)
 *   • probation_period_months / notice_period_days
 *   • restrictions          — other employment types this one restricts, held in
 *                             the self-referential employment_type_restrictions join
 *
 * This is master/config data only in this migration — it is NOT yet attached to
 * employees or to payroll. Wiring an employee to a type (and letting the flags drive
 * statutory eligibility) is a deliberate later step.
 *
 * The five rows below are seeded ONLY when the table is empty, so the screen is
 * populated on a fresh install without clobbering anything an admin later edits.
 */

interface SeedType {
  name: string; is_confirmed: boolean; prefix: string;
  probation_period_months: number | null; notice_period_days: number;
  restricts: string[];
}
const SEED: SeedType[] = [
  { name: 'Confirmed', is_confirmed: true, prefix: 'C', probation_period_months: null, notice_period_days: 30, restricts: ['Contract', 'Trainee'] },
  { name: 'Probation', is_confirmed: false, prefix: 'P', probation_period_months: 6, notice_period_days: 30, restricts: ['Contract', 'Trainee'] },
  { name: 'Intern', is_confirmed: false, prefix: 'I', probation_period_months: null, notice_period_days: 15, restricts: [] },
  { name: 'Trainee', is_confirmed: false, prefix: 'T', probation_period_months: null, notice_period_days: 15, restricts: [] },
  { name: 'Contract', is_confirmed: false, prefix: 'CON', probation_period_months: null, notice_period_days: 0, restricts: [] },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('employment_types'))) {
    await knex.schema.createTable('employment_types', (t) => {
      t.increments('id');
      t.string('name', 60).notNullable();
      t.boolean('is_confirmed').notNullable().defaultTo(false);
      t.string('prefix', 10);
      t.integer('probation_period_months'); // nullable — not every type has probation
      t.integer('notice_period_days').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['name']);
    });
    console.log('  created employment_types');
  }

  if (!(await knex.schema.hasTable('employment_type_restrictions'))) {
    await knex.schema.createTable('employment_type_restrictions', (t) => {
      t.increments('id');
      t.integer('employment_type_id').notNullable().references('id').inTable('employment_types').onDelete('CASCADE');
      t.integer('restricted_type_id').notNullable().references('id').inTable('employment_types').onDelete('CASCADE');
      t.unique(['employment_type_id', 'restricted_type_id']);
    });
    console.log('  created employment_type_restrictions');
  }

  // Seed only an empty table.
  const [{ count }] = await knex('employment_types').count('id as count');
  if (Number(count) === 0) {
    const idByName = new Map<string, number>();
    for (const s of SEED) {
      const [{ id }] = await knex('employment_types').insert({
        name: s.name, is_confirmed: s.is_confirmed, prefix: s.prefix,
        probation_period_months: s.probation_period_months, notice_period_days: s.notice_period_days,
      }).returning('id');
      idByName.set(s.name, id);
    }
    const links: Array<{ employment_type_id: number; restricted_type_id: number }> = [];
    for (const s of SEED) {
      const fromId = idByName.get(s.name)!;
      for (const r of s.restricts) {
        const toId = idByName.get(r);
        if (toId) links.push({ employment_type_id: fromId, restricted_type_id: toId });
      }
    }
    if (links.length) await knex('employment_type_restrictions').insert(links);
    console.log(`  seeded ${SEED.length} employment types`);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employment_type_restrictions');
  await knex.schema.dropTableIfExists('employment_types');
}
