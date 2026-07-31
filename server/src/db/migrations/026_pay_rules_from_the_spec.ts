import type { Knex } from 'knex';

/**
 * The owner's salary spec becomes the stored Attendance Pay Rules.
 *
 * Five of the seven codes already match. Two move:
 *
 *  • **No Punch pays a FULL day.** The owner: "np is nothing but absent recorded on holiday" — a
 *    day the register could not evidence, not a day the person declined to work. Migration 019
 *    set this to 0 for the opposite reason (a broken fingerprint reader silently paying a whole
 *    property); the business has since decided the other way, and that risk now belongs to the
 *    attendance-coverage gate rather than to a pay rule.
 *  • **Missed Punch pays 0.75, with no free allowance.** The allowance is set to 0 rather than
 *    removed, so it can be switched back on from the admin screen without another migration.
 *
 * Guarded on `updated_by IS NULL` — the same test migration 019 used, and the only signal in the
 * schema that separates a value the system chose from one a person chose. Two refinements on 019:
 * no extra value guard (the job here is "make the defaults equal the spec", and a value guard
 * would silently decline to move a row sitting at some third value), and every row is printed —
 * changed or skipped — because after this deploy the spec and the screen disagree for any row an
 * admin has customised, and somebody has to decide which wins.
 *
 * This migration does NOT switch `salary_calculation_method` to calendar_days. Selecting that
 * re-prices every open month for everyone; it is a policy act and belongs on the Pay Schedule
 * screen with the cost report in hand, not buried in something that also runs on a laptop.
 */
const SPEC: Array<{ code: string; pay_fraction: number; config: Record<string, unknown> }> = [
  { code: 'absent', pay_fraction: 0, config: {} },
  { code: 'present', pay_fraction: 1, config: {} },
  { code: 'half_day', pay_fraction: 0.5, config: {} },
  { code: 'hhd', pay_fraction: 0.5, config: {} },
  { code: 'short_punch', pay_fraction: 0.5, config: {} },
  { code: 'no_punch', pay_fraction: 1, config: {} },
  { code: 'miss_punch', pay_fraction: 0.75, config: { allowance: 0, beyond_pay_fraction: 0.5 } },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_pay_rules'))) return;

  const changed: string[] = [];
  const skipped: string[] = [];

  for (const r of SPEC) {
    const row = await knex('attendance_pay_rules').where('code', r.code).first();
    const patch = {
      pay_fraction: r.pay_fraction,
      config: JSON.stringify(r.config),
      updated_at: knex.fn.now(),
    };

    if (!row) {
      await knex('attendance_pay_rules').insert({ code: r.code, label: r.code, ...patch });
      changed.push(`${r.code}: (was missing) → pays ${r.pay_fraction}`);
    } else if (row.updated_by == null) {
      const before = `${row.pay_fraction}${row.config && row.config !== '{}' ? ` ${row.config}` : ''}`;
      const after = `${r.pay_fraction}${Object.keys(r.config).length ? ` ${JSON.stringify(r.config)}` : ''}`;
      if (before !== after) {
        await knex('attendance_pay_rules').where('id', row.id).update(patch);
        changed.push(`${r.code}: ${before} → ${after}`);
      }
    } else {
      skipped.push(`${r.code}: left at ${row.pay_fraction} — an admin set this (user ${row.updated_by})`);
    }
  }

  if (changed.length) {
    console.log('  attendance pay rules updated from the salary spec:');
    for (const line of changed) console.log(`    ${line}`);
  } else {
    console.log('  attendance pay rules: already match the spec — nothing changed.');
  }
  if (skipped.length) {
    console.log('  NOT changed — somebody chose these deliberately. Review by hand if the spec should win:');
    for (const line of skipped) console.log(`    ${line}`);
  }
}

/** Back to the 017 seed plus the 019 correction, for rows no human has since touched. */
export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_pay_rules'))) return;
  await knex('attendance_pay_rules').where('code', 'no_punch').whereNull('updated_by')
    .update({ pay_fraction: 0, config: '{}', updated_at: knex.fn.now() });
  await knex('attendance_pay_rules').where('code', 'miss_punch').whereNull('updated_by')
    .update({
      pay_fraction: 1,
      config: JSON.stringify({ allowance: 3, beyond_pay_fraction: 0.5 }),
      updated_at: knex.fn.now(),
    });
}
