import type { Knex } from 'knex';

/**
 * Gives the system somewhere to record which days of the week a person does not work.
 *
 * Until now nothing did. Every shift type ships with an empty off-day pattern, so every employee
 * falls through to one organisation-wide setting — and in the live data that setting says all
 * seven days are working days for all 396 people. Nobody chose that; it is a leftover. It means
 * a head-office employee's Sunday is treated as a scheduled working day, so the register marking
 * it "no punch" is about to start costing them a full day's pay once migration 019 lands.
 *
 * The weekly off goes on the LEAVE TEMPLATE, because that is where the business already decides
 * it, and because every piece of plumbing it needs is already built and tested: employees are
 * assigned a template, there is a Default for anyone unassigned, there is a bulk-assign, and
 * there is a screen. Shifts go on meaning timings.
 *
 * THIS MIGRATION MOVES NO MONEY, deliberately. It seeds the Default template's work week FROM the
 * organisation work week currently in force, so the calendar it produces on the morning after
 * deployment is identical to the one it produced the night before. Choosing who actually gets
 * Sundays off is a decision with a signature on it, made once in the UI — not something a
 * migration should do to 2,000 people unprompted.
 *
 * Three columns:
 *
 *  • `leave_templates.off_day_rules` — the pattern itself, in exactly the shape
 *    `shift_types.weekly_off_days` already uses, so `parseOffDayRules` and `isOffDay` read both
 *    with no second parser.
 *
 *  • `pay_schedule_settings.work_pattern_effective_from` — the first date any pattern is allowed
 *    to speak for. Patterns are configured today but evaluated across history, and shift
 *    assignments are projected backwards over dates that pre-date them, so without this a pattern
 *    saved this morning silently re-prices a month that has already been paid. It is a FIXED date
 *    rather than "the newest locked month" on purpose: a moving boundary would suppress patterns
 *    for the very months those patterns had priced.
 *
 *  • `employee_shift_assignments.source` / `.note` — 319 of these rows are about to be written by
 *    a script, and "why is this person on this shift" needs an answer afterwards.
 */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** `year * 12 + month` back to the first day of the FOLLOWING month. */
function firstOfNextMonth(ym: number): string {
  const next = ym + 1;
  const month = ((next - 1) % 12) + 1;
  const year = Math.floor((next - 1) / 12);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export async function up(knex: Knex): Promise<void> {
  // ── Schema ──
  if (!(await knex.schema.hasColumn('leave_templates', 'off_day_rules'))) {
    await knex.schema.alterTable('leave_templates', (t) => {
      // [] means "this template declares no pattern", NOT "works every day" — the reader falls
      // through to the Default template and then the organisation work week. A blank template
      // must never quietly turn someone's rest days into working days.
      t.jsonb('off_day_rules').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    });
  }
  if (!(await knex.schema.hasColumn('pay_schedule_settings', 'work_pattern_effective_from'))) {
    await knex.schema.alterTable('pay_schedule_settings', (t) => {
      // A business date, stored as text like every other business date here. NULL means there is
      // no history to protect — a fresh install, or a test database.
      t.text('work_pattern_effective_from');
    });
  }
  if (!(await knex.schema.hasColumn('employee_shift_assignments', 'source'))) {
    await knex.schema.alterTable('employee_shift_assignments', (t) => {
      t.text('source').notNullable().defaultTo('manual'); // manual | csv | derived | seed
      t.text('note');
    });
  }

  // ── The clamp date ──
  // The first month whose payroll has not started in any sense: after the newest month that holds
  // payslips, and after the newest locked run. Anything at or before it keeps exactly the
  // calendar that priced it.
  const maxOf = async (table: string, where?: (q: Knex.QueryBuilder) => void) => {
    const q = knex(table).select(knex.raw('MAX(year * 12 + month) as ym'));
    if (where) where(q);
    const row: any = await q.first();
    return Number(row?.ym ?? 0) || 0;
  };
  const newestSlips = await maxOf('payslip_history');
  const newestLocked = await maxOf('payroll_runs', (q) => q.where('status', 'locked'));
  const boundary = Math.max(newestSlips, newestLocked);
  const effectiveFrom = boundary > 0 ? firstOfNextMonth(boundary) : null;

  // The settings row is a singleton and may not exist yet — with none, the service falls back to
  // hard-coded defaults, so creating one with column defaults changes nothing.
  let schedule = await knex('pay_schedule_settings').orderBy('id').first();
  if (!schedule) {
    await knex('pay_schedule_settings').insert({});
    schedule = await knex('pay_schedule_settings').orderBy('id').first();
  }
  await knex('pay_schedule_settings').where('id', schedule.id)
    .update({ work_pattern_effective_from: effectiveFrom, updated_at: knex.fn.now() });

  console.log(effectiveFrom
    ? `  work patterns may only decide dates from ${effectiveFrom} — everything before keeps the calendar that priced it`
    : '  no payslips or locked runs found, so work patterns apply throughout (nothing to protect)');

  // ── Seed the Default template from the work week already in force ──
  let workWeek: number[] = [1, 2, 3, 4, 5];
  try {
    const parsed = JSON.parse(String(schedule.work_week ?? '[1,2,3,4,5]'));
    if (Array.isArray(parsed)) {
      workWeek = parsed.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6);
    }
  } catch { /* keep the default */ }

  const offRules = ALL_DAYS.filter((d) => !workWeek.includes(d)).map((day) => ({ day, weeks: null }));
  const defaultTemplate = await knex('leave_templates').where('is_default', true).first();
  if (defaultTemplate) {
    // Only a template that has never been configured. If someone has already set a pattern, that
    // is their decision and this must not overwrite it.
    const existing = JSON.stringify(defaultTemplate.off_day_rules ?? []);
    if (existing === '[]') {
      await knex('leave_templates').where('id', defaultTemplate.id)
        .update({ off_day_rules: JSON.stringify(offRules), updated_at: knex.fn.now() });
    }
  }

  // ── What the operator has to act on ──
  if (!offRules.length) {
    const [{ count: unassigned }]: any = await knex('employees')
      .where('is_active', true).count('id as count');
    console.log('');
    console.log('  ACTION REQUIRED — nobody has a weekly off.');
    console.log(`  The organisation work week is set to all seven days, so all ${unassigned} active`);
    console.log('  employees are treated as working every day of the year. That is almost certainly');
    console.log('  wrong, and it is what makes a Sunday marked "no punch" cost a full day of pay.');
    console.log('');
    console.log('  This migration has NOT guessed a pattern for you — inventing Sundays off for');
    console.log('  2,000 people would change gross pay on the next run with nobody\'s signature on it.');
    console.log('  Set the work week on each leave template, then assign people to them.');
    console.log('');
  } else {
    const summary = offRules.map((r) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.day]).join(' + ');
    console.log(`  Default leave template seeded with the current work week: ${summary} off`);
  }

  // ── A locked month with no payslips behind it ──
  // Nothing here can reconstruct those figures; the point is to stop the run header being the
  // only place that knows, and to leave the finding attached to the run itself.
  if (await knex.schema.hasColumn('payroll_runs', 'failure_report')) {
    const locked = await knex('payroll_runs').where('status', 'locked')
      .select('id', 'month', 'year', 'employee_count', 'total_net', 'failure_report');
    for (const run of locked) {
      const [{ count }]: any = await knex('payslip_history')
        .where({ month: run.month, year: run.year }).count('id as count');
      if (Number(count) > 0 || run.failure_report) continue;
      await knex('payroll_runs').where('id', run.id).update({
        failure_report: JSON.stringify({
          kind: 'no_payslips_stored',
          noted_by: '020_work_week_on_leave_template',
          detail: 'This run was locked and paid, but no per-employee payslip was ever stored. '
            + 'The figures cannot be reproduced; the totals on this run are the only surviving record.',
          employee_count: run.employee_count,
          total_net: run.total_net,
        }),
      });
      console.log(`  NOTE: ${run.month}/${run.year} is locked with no payslips — recorded on the run.`);
    }
  }
}

/**
 * Removes the columns. Their contents cannot be restored — the patterns were entered by hand,
 * and the roster they could once have been derived from was dropped in migration 006.
 */
export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('leave_templates', 'off_day_rules')) {
    await knex.schema.alterTable('leave_templates', (t) => t.dropColumn('off_day_rules'));
  }
  if (await knex.schema.hasColumn('pay_schedule_settings', 'work_pattern_effective_from')) {
    await knex.schema.alterTable('pay_schedule_settings', (t) => t.dropColumn('work_pattern_effective_from'));
  }
  if (await knex.schema.hasColumn('employee_shift_assignments', 'source')) {
    await knex.schema.alterTable('employee_shift_assignments', (t) => {
      t.dropColumn('source');
      t.dropColumn('note');
    });
  }
}
