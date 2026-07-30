import type { Knex } from 'knex';

/**
 * Populates the Leave & Attendance module for demos:
 *  - leave entitlements (the balance cards)
 *  - reporting managers (so manager-based approvals have something to show)
 *  - leave requests with a spread of statuses (My Requests + Approvals tabs)
 *  - a fuller holiday list
 *
 * Deterministic + idempotent: re-running won't duplicate (entitlements use the
 * unique key, requests skip employees who already have one, holidays skip
 * existing name+date).
 */
const ENTITLEMENT_TYPES = [1, 2, 3, 6]; // Casual, Sick, Earned, Unpaid
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'approved', 'pending'];
const REASONS = ['Personal work', 'Not feeling well', 'Family function', 'Planned vacation', 'Medical appointment', 'Out of town'];
const HOLIDAYS_2026 = [
  { name: 'Republic Day', date: '2026-01-26' },
  { name: 'Holi', date: '2026-03-04' },
  { name: 'Good Friday', date: '2026-04-03' },
  { name: 'Eid-ul-Fitr', date: '2026-03-21' },
  { name: 'Independence Day', date: '2026-08-15' },
  { name: 'Gandhi Jayanti', date: '2026-10-02' },
  { name: 'Dussehra', date: '2026-10-20' },
  { name: 'Diwali', date: '2026-11-08' },
  { name: 'Christmas', date: '2026-12-25' },
];

export async function seed(knex: Knex): Promise<void> {
  const period = await knex('leave_periods').where('is_current', true).first();
  if (!period) return;

  const types = await knex('leave_types').select('id', 'default_days');
  const defaultDays: Record<number, number> = {};
  types.forEach((t: any) => { defaultDays[t.id] = t.default_days; });

  const employees = await knex('employees').where('is_active', true).select('id').orderBy('id');

  // 1. Entitlements (balance cards)
  for (const e of employees) {
    for (const tid of ENTITLEMENT_TYPES) {
      if (!defaultDays[tid]) continue;
      const exists = await knex('leave_entitlements')
        .where({ employee_id: e.id, leave_type_id: tid, leave_period_id: period.id }).first();
      if (exists) continue;
      const cap = Math.min(defaultDays[tid], 8);
      const used = tid === 6 ? 0 : (e.id * (tid + 1)) % (cap + 1);
      await knex('leave_entitlements').insert({
        employee_id: e.id, leave_type_id: tid, leave_period_id: period.id,
        total_days: defaultDays[tid], used_days: used,
      });
    }
  }

  // 2. Reporting managers — point a batch at the Property Manager (fo@) so the
  //    manager approvals view isn't empty. Only set where currently unset.
  const manager = (await knex('employees as e').join('users as u', 'u.employee_id', 'e.id')
    .where('u.email', 'fo@saltstayz.com').select('e.id').first())
    ?? (await knex('employees').where('employee_code', 'SS-0004').select('id').first());
  if (manager) {
    const reports = employees.filter((e: any) => e.id !== manager.id).slice(0, 12);
    for (const r of reports) {
      const emp = await knex('employees').where('id', r.id).first();
      if (!emp.reporting_manager_id) {
        await knex('employees').where('id', r.id).update({ reporting_manager_id: manager.id });
      }
    }
  }

  // 3. Leave requests (My Requests + Approvals). Cover every employee that has a
  //    login (so each demo account sees their own) plus a few more.
  const linkedEmpIds: number[] = await knex('users').whereNotNull('employee_id').pluck('employee_id');
  const chosenIds = Array.from(new Set([...linkedEmpIds, ...employees.slice(0, 18).map((e: any) => e.id)]));
  const haveReqs = new Set<number>(await knex('leave_requests').distinct('employee_id').pluck('employee_id'));

  let idx = 0;
  for (const empId of chosenIds) {
    if (!haveReqs.has(empId)) {
      const count = 1 + (idx % 3);
      for (let j = 0; j < count; j++) {
        const tid = [1, 2, 3][(idx + j) % 3];
        const month = ((idx * 2 + j * 3) % 9) + 1;
        const day = ((idx + j * 5) % 24) + 1;
        const dur = 1 + ((idx + j) % 3);
        const mm = String(month).padStart(2, '0');
        const start = `2026-${mm}-${String(day).padStart(2, '0')}`;
        const end = `2026-${mm}-${String(day + dur - 1).padStart(2, '0')}`;
        const status = STATUSES[(idx + j) % STATUSES.length];
        const decided = status === 'approved' || status === 'rejected';
        await knex('leave_requests').insert({
          employee_id: empId,
          leave_type_id: tid,
          start_date: start,
          end_date: end,
          days: dur,
          reason: REASONS[(idx + j) % REASONS.length],
          status,
          approved_by: decided ? (idx % 2 ? 3 : 4) : null,
          rejection_reason: status === 'rejected' ? 'Insufficient balance / staffing constraints' : null,
        });
      }
    }
    idx += 1;
  }

  // 4. Holidays.
  //
  // `is_national` is NOT optional here. An employee only ever sees a holiday that is either
  // national or carries their own state (leave.service.getMyHolidays, and the same predicate in
  // the payroll and attendance calendars). A row with neither matches nobody — it sits in the
  // table looking published while every employee's holiday list stays empty, and the payroll
  // calendar never treats it as a holiday either.
  // `all_departments` / `all_properties` are as load-bearing as `is_national`: a holiday reaches
  // nobody until it says who it is for (migration 025). Left off, these demo holidays would
  // exist in the table and appear on no calendar.
  for (const h of HOLIDAYS_2026) {
    const exists = await knex('holidays').where({ name: h.name, date: h.date }).first();
    if (!exists) {
      await knex('holidays').insert({
        name: h.name, date: h.date, is_national: true, state: null, is_recurring: false,
        all_departments: true, all_properties: true,
      });
    }
  }
}
