import type { Knex } from 'knex';

/**
 * Adds dummy employees spread across every property so property-based views
 * (headcount, Property Analytics, attendance-by-property, attrition-by-property)
 * have real multi-location data. Also seeds attendance records and a few exits.
 *
 * Idempotent: dummy employees use the PD-/PX- code prefixes and are skipped if
 * already present; attendance rows respect the (employee, date) unique key.
 */
const ACTIVE_PER_PROPERTY = 8;
const EXITED_PER_PROPERTY = 2;
const DEPARTMENTS = ['Housekeeping', 'Food & Beverage', 'Front Desk', 'Management', 'Security'];
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Diya', 'Aanya', 'Aadhya', 'Ananya', 'Pari', 'Anika', 'Navya', 'Sara', 'Myra', 'Kiara'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Mehta', 'Nair', 'Reddy', 'Iyer', 'Bose', 'Khanna', 'Malhotra', 'Chopra', 'Saxena'];
const EXIT_REASONS = ['resignation', 'terminated', 'contract_end', 'absconded', 'resignation', 'other'];

function pad(n: number) { return String(n).padStart(4, '0'); }

export async function seed(knex: Knex): Promise<void> {
  const properties = await knex('properties').select('name').orderBy('id');
  if (!properties.length) return;
  const jobTitles = await knex('job_titles').select('id').orderBy('id');
  if (!jobTitles.length) return;

  const recentDates: string[] = await knex('attendance_records')
    .distinct('date').orderBy('date', 'desc').limit(12).pluck('date');

  let activeSeq = 0;
  let exitSeq = 0;

  for (let pi = 0; pi < properties.length; pi++) {
    const branch = properties[pi].name;

    // ── Active employees for this property ──
    for (let k = 0; k < ACTIVE_PER_PROPERTY; k++) {
      activeSeq += 1;
      const code = `PD-${pad(activeSeq)}`;
      if (await knex('employees').where('employee_code', code).first()) continue;

      const first = FIRST[(pi * ACTIVE_PER_PROPERTY + k) % FIRST.length];
      const last = LAST[(pi + k) % LAST.length];
      const [{ id: empId }] = await knex('employees').insert({
        employee_code: code,
        first_name: first,
        last_name: last,
        email: `${first}.${last}.${code}`.toLowerCase() + '@saltstayz.com',
        phone: `98${pad(activeSeq)}${pad(pi)}`.slice(0, 12),
        date_of_joining: '2025-07-01',
        job_title_id: jobTitles[(pi + k) % jobTitles.length].id,
        dept_name: DEPARTMENTS[k % DEPARTMENTS.length],
        branch_name: branch,
        is_active: true,
      }).returning('id');

      // Attendance for recent dates → attendance-by-property analytics
      for (let di = 0; di < recentDates.length; di++) {
        const date = recentDates[di];
        const exists = await knex('attendance_records').where({ employee_id: empId, date }).first();
        if (exists) continue;
        const roll = (empId + di) % 10;
        const status = roll < 7 ? 'present' : roll < 9 ? 'half_day' : 'absent';
        const checkIn = status === 'absent' ? null : `${date} 09:00:00`;
        const checkOut = status === 'absent' ? null : status === 'half_day' ? `${date} 13:30:00` : `${date} 18:00:00`;
        const hours = status === 'absent' ? null : status === 'half_day' ? 4.5 : 9;
        await knex('attendance_records').insert({
          employee_id: empId, date, check_in: checkIn, check_out: checkOut, status, working_hours: hours,
        });
      }
    }

    // ── Exited employees for this property (attrition data) ──
    for (let k = 0; k < EXITED_PER_PROPERTY; k++) {
      exitSeq += 1;
      const code = `PX-${pad(exitSeq)}`;
      if (await knex('employees').where('employee_code', code).first()) continue;

      const first = FIRST[(pi + k + 5) % FIRST.length];
      const last = LAST[(pi + k + 3) % LAST.length];
      const [{ id: empId }] = await knex('employees').insert({
        employee_code: code,
        first_name: first,
        last_name: last,
        email: `${first}.${last}.${code}`.toLowerCase() + '@saltstayz.com',
        date_of_joining: '2024-01-15',
        job_title_id: jobTitles[(pi + k) % jobTitles.length].id,
        dept_name: DEPARTMENTS[(pi + k) % DEPARTMENTS.length],
        branch_name: branch,
        is_active: false,
      }).returning('id');

      // exit within the last few months for the attrition trend
      const month = 4 + ((exitSeq) % 3); // Apr/May/Jun 2026
      const exitDate = `2026-${pad(month).slice(2)}-${pad(10 + exitSeq).slice(2)}`;
      if (!(await knex('employee_exits').where('employee_id', empId).first())) {
        await knex('employee_exits').insert({
          employee_id: empId,
          exit_date: exitDate,
          exit_reason: EXIT_REASONS[exitSeq % EXIT_REASONS.length],
          exit_details: 'Auto-generated demo exit',
          tenure_months: 12 + exitSeq,
        });
      }
    }
  }
}
