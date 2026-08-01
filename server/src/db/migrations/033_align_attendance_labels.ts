import type { Knex } from 'knex';

/**
 * One name per attendance code.
 *
 * The pay-rules screen renders the stored label, so `short_punch` read "Short Present" there while
 * the calendar, the admin attendance page and the employee's own dashboard all said "Short Punch"
 * — same day, same code, two different words depending which screen you were on. Same for
 * `miss_punch`: "Missed Punch" stored, "Miss Punch" everywhere else.
 *
 * The client's display vocabulary now lives in one file (client/src/lib/attendanceCodes.ts); this
 * brings the stored labels into line with it so the admin screen agrees too.
 *
 * Guarded on `updated_by IS NULL`, the same test migrations 019 and 026 used and the only signal in
 * the schema separating a value the system chose from one a person chose. A label an admin has
 * edited is theirs; we print it and leave it.
 *
 * Labels only. No pay_fraction, no config, no attendance data — nothing here can move money.
 */

const LABELS: Array<{ code: string; label: string }> = [
  { code: 'short_punch', label: 'Short Punch' },
  { code: 'miss_punch', label: 'Miss Punch' },
];

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_pay_rules'))) return;

  const changed: string[] = [];
  const skipped: string[] = [];

  for (const r of LABELS) {
    const row = await knex('attendance_pay_rules').where('code', r.code).first();
    if (!row) continue;
    if (row.updated_by != null) {
      skipped.push(`${r.code}: left as "${row.label}" — an admin set this (user ${row.updated_by})`);
      continue;
    }
    if (row.label === r.label) continue;
    await knex('attendance_pay_rules').where('id', row.id)
      .update({ label: r.label, updated_at: knex.fn.now() });
    changed.push(`${r.code}: "${row.label}" → "${r.label}"`);
  }

  if (changed.length) {
    console.log('  attendance pay rule labels aligned with the screens:');
    for (const line of changed) console.log(`    ${line}`);
  }
  if (skipped.length) {
    console.log('  NOT renamed — somebody chose these deliberately:');
    for (const line of skipped) console.log(`    ${line}`);
  }
}

/** Back to the 017 seed wording, for rows no human has since touched. */
export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('attendance_pay_rules'))) return;
  await knex('attendance_pay_rules').where('code', 'short_punch').whereNull('updated_by')
    .update({ label: 'Short Present', updated_at: knex.fn.now() });
  await knex('attendance_pay_rules').where('code', 'miss_punch').whereNull('updated_by')
    .update({ label: 'Missed Punch', updated_at: knex.fn.now() });
}
