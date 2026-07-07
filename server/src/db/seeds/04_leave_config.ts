import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('holidays').del();
  await knex('leave_entitlements').del();
  await knex('leave_requests').del();
  await knex('leave_periods').del();
  await knex('leave_types').del();

  // The four everyday categories (Phase 4) + statutory Maternity/Paternity.
  await knex('leave_types').insert([
    { name: 'Casual Leave', default_days: 12, is_paid: true, is_encashable: false },
    { name: 'Sick Leave', default_days: 12, is_paid: true, is_encashable: false },
    { name: 'Privilege Leave', default_days: 15, is_paid: true, is_encashable: true },
    { name: 'Maternity Leave', default_days: 182, is_paid: true, is_encashable: false },
    { name: 'Paternity Leave', default_days: 15, is_paid: true, is_encashable: false },
    { name: 'Loss of Pay', default_days: 365, is_paid: false, is_encashable: false },
  ]);

  await knex('leave_periods').insert([
    { name: '2025-2026', start_date: '2025-04-01', end_date: '2026-03-31', is_current: false },
    { name: '2026-2027', start_date: '2026-04-01', end_date: '2027-03-31', is_current: true },
  ]);

  await knex('holidays').insert([
    { name: 'Republic Day', date: '2026-01-26', is_recurring: true },
    { name: 'Holi', date: '2026-03-10', is_recurring: false },
    { name: 'Independence Day', date: '2026-08-15', is_recurring: true },
    { name: 'Gandhi Jayanti', date: '2026-10-02', is_recurring: true },
    { name: 'Diwali', date: '2026-10-20', is_recurring: false },
    { name: 'Christmas', date: '2026-12-25', is_recurring: true },
  ]);

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
}
