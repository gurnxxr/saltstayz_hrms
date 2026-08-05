import type { Knex } from 'knex';
import { ensureDefaultTemplate } from '../../services/leaveTemplate.service';

export async function seed(knex: Knex): Promise<void> {
  await knex('holidays').del();
  await knex('leave_entitlements').del();
  await knex('leave_requests').del();
  await knex('leave_periods').del();
  await knex('leave_types').del();

  // The four everyday categories (Phase 4) + statutory Maternity/Paternity.
  await knex('leave_types').insert([
    { name: 'Casual Leave', default_days: 12, is_paid: true },
    { name: 'Sick Leave', default_days: 12, is_paid: true },
    { name: 'Privilege Leave', default_days: 15, is_paid: true },
    // Gender-restricted: eligibility is matched strictly against employees.gender,
    // so an employee with no gender recorded can take neither.
    { name: 'Maternity Leave', default_days: 182, is_paid: true, eligibility: 'female' },
    { name: 'Paternity Leave', default_days: 15, is_paid: true, eligibility: 'male' },
    { name: 'Loss of Pay', default_days: 365, is_paid: false },
  ]);

  await knex('leave_periods').insert([
    { name: '2025-2026', start_date: '2025-04-01', end_date: '2026-03-31', is_current: false },
    { name: '2026-2027', start_date: '2026-04-01', end_date: '2027-03-31', is_current: true },
  ]);

  // Holidays are seeded by 14_regions_holidays, which is the file that knows about national vs
  // state scope. This one used to insert its own set with no `is_national` — and because 14 skips
  // any name+date that already exists, those rows blocked the properly-scoped ones from ever
  // landing. The result was a database where NO holiday matched ANY employee: the resolver looks
  // for `is_national = true OR state = <the employee's state>`, and these rows were neither.
  // Republic Day, Diwali and Christmas were all being priced as ordinary working days.
  // Two seeds writing one table WAS the bug, so this one no longer does.

  // Leave entitlements for all employees in current period
  const employees = await knex('employees').select('id');
  const leaveTypes = await knex('leave_types').select('id', 'default_days').where('name', '!=', 'Maternity Leave').andWhere('name', '!=', 'Paternity Leave');
  const currentPeriod = await knex('leave_periods').where('is_current', true).first();

  if (currentPeriod) {
    const entitlements: any[] = [];
    for (const emp of employees) {
      for (const lt of leaveTypes) {
        entitlements.push({
          employee_id: emp.id,
          leave_type_id: lt.id,
          leave_period_id: currentPeriod.id,
          total_days: lt.default_days,
          used_days: 0,
        });
      }
    }
    await knex('leave_entitlements').insert(entitlements);
  }

  // Migrations run before seeds, so migration 012 built the Default leave template from a
  // still-empty leave_types table (zero rows). And deleting leave_types above cascades away
  // any rows it did have. Reconcile now that the real types exist: give Default a row for
  // every active type and put every employee on it — otherwise all leave reads resolve to an
  // empty plan and the whole module is dead on a freshly seeded database.
  await ensureDefaultTemplate(knex);
}
