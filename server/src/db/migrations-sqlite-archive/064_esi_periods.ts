import type { Knex } from 'knex';

// Payroll v2 Phase 5 (completion):
//  1. employee_esi_periods — per-employee ESI contribution-period coverage
//     decision (Apr–Sep = H1, Oct–Mar = H2). Once decided at period start,
//     coverage is fixed for the period even if a mid-period raise crosses the
//     ceiling (ESI Act contribution-period rule).
//  2. Normalize employer-in-CTC: the engine now honours epf/esi
//     includeEmployerInCtc, which the code previously ignored (employer PF/ESI
//     were always in CTC). Set the stored flags to true so CTC is unchanged;
//     admins can now toggle them off deliberately.

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasTable('employee_esi_periods');
  if (!has) {
    await knex.schema.createTable('employee_esi_periods', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
      t.string('period_key', 12).notNullable(); // e.g. "2026-H1" / "2026-H2"
      t.boolean('covered').notNullable();
      t.timestamps(true, true);
      t.unique(['employee_id', 'period_key']);
    });
  }

  for (const component of ['epf', 'esi']) {
    const row = await knex('statutory_settings').where({ component }).whereNull('state').first();
    if (!row) continue;
    let cfg: any = {};
    try { cfg = JSON.parse(row.config || '{}'); } catch { cfg = {}; }
    cfg.includeEmployerInCtc = true;
    await knex('statutory_settings').where({ id: row.id }).update({ config: JSON.stringify(cfg) });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_esi_periods');
}
