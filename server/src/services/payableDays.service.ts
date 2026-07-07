import db from '../config/database';
import { getPaySchedule } from './paySchedule.service';
import { getEmployeeRegion } from './leave.service';
import type { AttendanceContext } from './payslip.calc';

// ─────────────────────────────────────────────────────────────────────────────
// Payable-days engine (Payroll Phase 3).
//
// For one employee and one salary month, classifies every calendar day using
// the Pay Schedule work week, the employee's regional holidays, attendance
// records, and approved leaves (paid vs unpaid), producing:
//   working days → LOP days → payment days
// plus a day-by-day trace for the review screen.
// ─────────────────────────────────────────────────────────────────────────────

export type DayStatus =
  | 'present' | 'half_day' | 'absent'
  | 'miss_punch' | 'short_punch'
  | 'paid_leave' | 'unpaid_leave'
  | 'unmarked' | 'future';

export interface DayTrace {
  date: string;                                   // YYYY-MM-DD
  kind: 'working' | 'weekly_off' | 'holiday';
  status: DayStatus | null;                       // null on non-working days
  lop: number;                                    // 0 | 0.5 | 1
  holiday_name?: string;
}

export interface PayableDays extends AttendanceContext {
  counts: {
    present: number; half_day: number; absent: number;
    miss_punch: number; short_punch: number;
    paid_leave: number; unpaid_leave: number; unmarked: number; future: number;
  };
  weekly_offs: number;
  holidays: number;
  method: string;            // actual_days | fixed_days
  unmarked_policy: string;   // present | absent
  trace: DayTrace[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Hours between two HH:MM times, overnight-safe (22:00 → 06:00 = 8h). */
function shiftDurationHours(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  let diff = toMin(end) - toMin(start);
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

/**
 * Overtime hours for the month: Σ max(0, worked − shift length) per attendance
 * day — but only when the employee's assigned shift type allows overtime.
 */
export async function getOvertimeHours(employeeId: number, month: number, year: number): Promise<number> {
  const shift = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('st.allow_overtime', 'st.start_time', 'st.end_time')
    .first();
  if (!shift || !shift.allow_overtime) return 0;
  const duration = shiftDurationHours(shift.start_time, shift.end_time);
  if (duration <= 0) return 0;

  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-31`;
  const rows = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .whereNotNull('working_hours')
    .select('working_hours');
  const total = rows.reduce((sum: number, r: any) => sum + Math.max(0, (Number(r.working_hours) || 0) - duration), 0);
  return Math.round(total * 100) / 100;
}

/** Sum of attendance working_hours in the month (hourly-rated pay basis). */
export async function getMonthlyHours(employeeId: number, month: number, year: number): Promise<number> {
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-31`;
  const row = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .sum({ h: 'working_hours' })
    .first();
  return Number((row as any)?.h ?? 0);
}

export async function computePayableDays(employeeId: number, month: number, year: number): Promise<PayableDays> {
  const schedule = await getPaySchedule();
  const workWeek = new Set<number>(schedule.work_week);
  const holidaysPaid = (schedule as any).holidays_paid !== false;
  const unmarkedPolicy = (schedule as any).unmarked_day_policy === 'absent' ? 'absent' : 'present';
  // Attendance policy (Phase 2)
  const missAllowance = schedule.miss_punch_allowance;
  const missLop = schedule.miss_punch_lop;
  const shortLop = schedule.short_punch_lop;
  let missPunchSeen = 0; // counted in date order — first N are free

  const periodDays = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(periodDays)}`;
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Inputs: attendance, approved leaves (paid/unpaid), regional holidays ──
  const records = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .select('date', 'status');
  const statusByDate = new Map<string, string>(records.map((r: any) => [String(r.date).slice(0, 10), r.status]));

  const leaves = await db('leave_requests as lr')
    .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
    .where('lr.employee_id', employeeId)
    .where('lr.status', 'approved')
    .where('lr.start_date', '<=', end)
    .where('lr.end_date', '>=', start)
    .select('lr.start_date', 'lr.end_date', 'lt.is_paid');

  const region = await getEmployeeRegion(employeeId);
  const holidayRows = await db('holidays')
    .whereBetween('date', [start, end])
    .where(function (this: any) {
      this.where('is_national', true);
      if (region?.region_id) this.orWhere('region_id', region.region_id);
    })
    .select('date', 'name');
  const holidayByDate = new Map<string, string>(holidayRows.map((h: any) => [String(h.date).slice(0, 10), h.name]));

  const leaveOn = (date: string): { paid: boolean } | null => {
    for (const l of leaves) {
      if (String(l.start_date).slice(0, 10) <= date && String(l.end_date).slice(0, 10) >= date) {
        return { paid: !!l.is_paid };
      }
    }
    return null;
  };

  // ── Day-by-day classification ──
  const counts = { present: 0, half_day: 0, absent: 0, miss_punch: 0, short_punch: 0, paid_leave: 0, unpaid_leave: 0, unmarked: 0, future: 0 };
  const trace: DayTrace[] = [];
  let workingDays = 0;
  let weeklyOffs = 0;
  let holidayCount = 0;
  let lop = 0;

  for (let d = 1; d <= periodDays; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    const dow = new Date(year, month - 1, d).getDay();

    if (!workWeek.has(dow)) {
      weeklyOffs += 1;
      trace.push({ date, kind: 'weekly_off', status: null, lop: 0 });
      continue;
    }
    const holidayName = holidayByDate.get(date);
    if (holidayName !== undefined) {
      holidayCount += 1;
      // Paid holidays stay inside working days (auto-paid); unpaid ones are
      // excluded from the denominator like weekly offs.
      if (holidaysPaid) workingDays += 1;
      trace.push({ date, kind: 'holiday', status: null, lop: 0, holiday_name: holidayName });
      continue;
    }

    workingDays += 1;
    const leave = leaveOn(date);
    const status = statusByDate.get(date);
    let dayStatus: DayStatus;
    let dayLop = 0;

    if (status === 'present') {
      dayStatus = 'present';
    } else if (status === 'half_day') {
      dayStatus = 'half_day'; dayLop = 0.5;
    } else if (status === 'miss_punch') {
      // An approved leave governs the day even if a stray punch marked it a miss
      // punch (mirrors the absent branch). Otherwise: the first N miss punches a
      // month are regularized (paid); beyond the allowance each costs miss_punch_lop.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else {
        dayStatus = 'miss_punch';
        dayLop = missPunchSeen < missAllowance ? 0 : missLop;
        missPunchSeen += 1; // only genuine miss punches consume the allowance
      }
    } else if (status === 'short_punch') {
      // An approved leave (e.g. a half-day) governs the day before the early-exit penalty.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else {
        dayStatus = 'short_punch'; dayLop = shortLop;
      }
    } else if (status === 'on_leave') {
      if (leave && !leave.paid) { dayStatus = 'unpaid_leave'; dayLop = 1; }
      else dayStatus = 'paid_leave';
    } else if (status === 'absent') {
      // An approved paid leave protects the day even if the register says absent.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else { dayStatus = 'absent'; dayLop = 1; }
    } else {
      // No attendance record.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else if (date > todayStr) {
        dayStatus = 'future'; // month still in progress — not yet payable info
      } else if (unmarkedPolicy === 'absent') {
        dayStatus = 'unmarked'; dayLop = 1;
      } else {
        dayStatus = 'unmarked';
      }
    }

    counts[dayStatus] += 1;
    lop += dayLop;
    trace.push({ date, kind: 'working', status: dayStatus, lop: dayLop });
  }

  // fixed_days: salary divides over a fixed number of days (e.g. 30) regardless
  // of the month's real shape; LOP still comes from actual attendance.
  const method = schedule.salary_calculation_method === 'fixed_days' ? 'fixed_days' : 'actual_days';
  const denominator = method === 'fixed_days' ? Number(schedule.fixed_working_days) || 30 : workingDays;
  const paymentDays = Math.max(0, denominator - lop);

  return {
    period_days: periodDays,
    working_days: denominator,
    lop_days: lop,
    payment_days: paymentDays,
    counts,
    weekly_offs: weeklyOffs,
    holidays: holidayCount,
    method,
    unmarked_policy: unmarkedPolicy,
    trace,
  };
}
