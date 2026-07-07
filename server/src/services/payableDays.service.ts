import db from '../config/database';
import { getPaySchedule } from './paySchedule.service';
import { getEmployeeRegion } from './leave.service';
import type { AttendanceContext } from './payslip.calc';

// ─────────────────────────────────────────────────────────────────────────────
// Payable-days engine (Payroll Phase 3 — Shifts Drive Payable Days).
//
// Each employee has their own working-day calendar, resolved roster-first:
//   • a date with a shift_rosters entry is a working day; a date without one is
//     that employee's off day (per-employee rotating week off);
//   • when the employee has no roster at all for a month, fall back to the org
//     Pay Schedule work week;
//   • regional/national holidays overlay on top;
//   • days outside the employment span [date_of_joining, last_working_day] are
//     "not employed" — they stay in the denominator but are never paid, so a
//     mid-month joiner/leaver is paid exactly for the days they were employed.
//
// The same calendar powers leave-day counting, so leave balance and payroll LOP
// agree for the same span (one calendar everywhere).
// ─────────────────────────────────────────────────────────────────────────────

export type DayStatus =
  | 'present' | 'half_day' | 'absent'
  | 'miss_punch' | 'short_punch'
  | 'paid_leave' | 'unpaid_leave'
  | 'unmarked' | 'future' | 'not_employed';

export interface DayTrace {
  date: string;                                   // YYYY-MM-DD
  kind: 'working' | 'weekly_off' | 'holiday' | 'not_employed';
  status: DayStatus | null;                       // null on non-working days
  lop: number;                                    // 0 | 0.5 | 1
  holiday_name?: string;
  leave_type?: string;                            // leave category on a leave day
}

export interface PayableDays extends AttendanceContext {
  counts: {
    present: number; half_day: number; absent: number;
    miss_punch: number; short_punch: number;
    paid_leave: number; unpaid_leave: number; unmarked: number; future: number;
    not_employed: number;
  };
  weekly_offs: number;
  holidays: number;
  scheduled_working_days: number; // actual scheduled working days (denominator basis)
  not_employed_days: number; // scheduled working days outside the employment span
  method: string;            // actual_days | fixed_days
  unmarked_policy: string;   // present | absent
  roster_driven: boolean;    // true when the month's calendar came from the roster
  trace: DayTrace[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;

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

const dowOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

interface DayInfo {
  base: 'working' | 'weekly_off' | 'holiday';
  employed: boolean;
  holidayName?: string;
  shiftHours: number;   // rostered shift length (0 when no roster entry)
  allowOt: boolean;     // rostered shift type allows overtime
}

export interface WorkCalendar {
  classify(date: string): DayInfo;
  /** True when this date's month is roster-driven for the employee. */
  rosterMonth(date: string): boolean;
}

/**
 * Builds an employee's working-day calendar for a date range. Roster presence is
 * decided per calendar month (so a leave that spans only off-days still resolves
 * correctly when the rest of the month is rostered).
 *
 * useRoster (default true) drives the retrospective payroll view: a rostered
 * month treats un-rostered dates as off days. Leave counting passes useRoster:
 * false so a not-yet-published future roster does not make ordinary working days
 * read as offs — those fall back to the org work week (weekly-off pattern).
 */
export async function buildWorkCalendar(
  employeeId: number, startDate: string, endDate: string,
  opts: { useRoster?: boolean } = {},
): Promise<WorkCalendar> {
  const useRoster = opts.useRoster !== false;
  const emp = await db('employees').where('id', employeeId)
    .select('date_of_joining', 'last_working_day').first();
  const doj = emp?.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : null;
  const lwd = emp?.last_working_day ? String(emp.last_working_day).slice(0, 10) : null;

  const schedule = await getPaySchedule();
  const workWeek = new Set<number>(schedule.work_week);

  // Widen the roster lookup to whole months so per-month roster-mode is stable.
  const monthStart = `${startDate.slice(0, 7)}-01`;
  const [ey, em] = endDate.split('-').map(Number);
  const monthEnd = `${endDate.slice(0, 7)}-${pad(new Date(ey, em, 0).getDate())}`;

  const rosterRows = await db('shift_rosters as r')
    .join('shift_types as st', 'st.id', 'r.shift_type_id')
    .where('r.employee_id', employeeId)
    .whereBetween('r.date', [monthStart, monthEnd])
    .select('r.date', 'st.start_time', 'st.end_time', 'st.allow_overtime');
  const rosterByDate = new Map<string, { shiftHours: number; allowOt: boolean }>();
  const rosterMonths = new Set<string>();
  for (const r of rosterRows) {
    const key = String(r.date).slice(0, 10);
    rosterByDate.set(key, { shiftHours: shiftDurationHours(r.start_time, r.end_time), allowOt: !!r.allow_overtime });
    rosterMonths.add(key.slice(0, 7));
  }

  const region = await getEmployeeRegion(employeeId);
  const holidayRows = await db('holidays')
    .whereBetween('date', [startDate, endDate])
    .where(function (this: any) {
      this.where('is_national', true);
      if (region?.region_id) this.orWhere('region_id', region.region_id);
    })
    .select('date', 'name');
  const holidayByDate = new Map<string, string>(holidayRows.map((h: any) => [String(h.date).slice(0, 10), h.name]));

  const rosterMonth = (date: string) => rosterMonths.has(date.slice(0, 7));

  const classify = (date: string): DayInfo => {
    const employed = (!doj || date >= doj) && (!lwd || date <= lwd);
    const roster = rosterByDate.get(date);
    const shiftHours = roster?.shiftHours ?? 0;
    const allowOt = roster?.allowOt ?? false;

    const holidayName = holidayByDate.get(date);
    if (holidayName !== undefined) return { base: 'holiday', employed, holidayName, shiftHours, allowOt };

    const isWorking = (useRoster && rosterMonth(date)) ? rosterByDate.has(date) : workWeek.has(dowOf(date));
    return { base: isWorking ? 'working' : 'weekly_off', employed, shiftHours, allowOt };
  };

  return { classify, rosterMonth };
}

/**
 * Count of working days for the employee in [start, end], excluding holidays,
 * weekly offs, and days outside the employment span — on the work-week (weekly-off)
 * pattern, not the dated roster, so a leave applied before its roster is published
 * is sized correctly. Payroll re-derives LOP from the final roster when the month
 * is run; for a normal work-week month the two agree.
 */
export async function countWorkingDaysInRange(employeeId: number, startDate: string, endDate: string): Promise<number> {
  const cal = await buildWorkCalendar(employeeId, startDate, endDate, { useRoster: false });
  let count = 0;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    const date = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
    const info = cal.classify(date);
    if (info.base === 'working' && info.employed) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Overtime hours for the month: Σ max(0, worked − shift length) per attendance
 * day, using the shift rostered on that date (falling back to the employee's
 * standing assignment), and only when that shift type allows overtime.
 */
export async function getOvertimeHours(employeeId: number, month: number, year: number): Promise<number> {
  const periodDays = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(periodDays)}`;

  const cal = await buildWorkCalendar(employeeId, start, end);

  // Standing assignment as the fallback shift when a date has no roster entry.
  const assign = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('st.allow_overtime', 'st.start_time', 'st.end_time')
    .first();
  const assignHours = assign ? shiftDurationHours(assign.start_time, assign.end_time) : 0;
  const assignAllowOt = !!assign?.allow_overtime;

  const rows = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .whereNotNull('working_hours')
    .select('date', 'working_hours');

  let total = 0;
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const info = cal.classify(date);
    if (!info.employed) continue; // no OT for days outside the employment span
    // Per-date rostered shift wins; otherwise the standing assignment.
    const hasRoster = info.shiftHours > 0;
    const shiftHours = hasRoster ? info.shiftHours : assignHours;
    const allowOt = hasRoster ? info.allowOt : assignAllowOt;
    if (!allowOt || shiftHours <= 0) continue;
    total += Math.max(0, (Number(r.working_hours) || 0) - shiftHours);
  }
  return round2(total);
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

  const cal = await buildWorkCalendar(employeeId, start, end);

  // ── Inputs: attendance, approved leaves (paid/unpaid) ──
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
    .select('lr.start_date', 'lr.end_date', 'lt.is_paid', 'lt.name as leave_type');

  const leaveOn = (date: string): { paid: boolean; name: string } | null => {
    for (const l of leaves) {
      if (String(l.start_date).slice(0, 10) <= date && String(l.end_date).slice(0, 10) >= date) {
        return { paid: !!l.is_paid, name: l.leave_type };
      }
    }
    return null;
  };

  // ── Day-by-day classification ──
  const counts = { present: 0, half_day: 0, absent: 0, miss_punch: 0, short_punch: 0, paid_leave: 0, unpaid_leave: 0, unmarked: 0, future: 0, not_employed: 0 };
  const trace: DayTrace[] = [];
  let workingDays = 0;      // scheduled working days (denominator for actual_days)
  let weeklyOffs = 0;
  let holidayCount = 0;
  let notEmployedDays = 0;  // scheduled working days outside the employment span
  let lop = 0;

  for (let d = 1; d <= periodDays; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    const info = cal.classify(date);

    if (info.base === 'weekly_off') {
      if (info.employed) { weeklyOffs += 1; trace.push({ date, kind: 'weekly_off', status: null, lop: 0 }); }
      else { trace.push({ date, kind: 'not_employed', status: null, lop: 0 }); }
      continue;
    }

    if (info.base === 'holiday') {
      holidayCount += 1;
      // Paid holidays stay inside the denominator (auto-paid); unpaid ones are
      // excluded like weekly offs. A holiday outside the employment span is in
      // the denominator but not paid, exactly like a scheduled working day.
      if (holidaysPaid) {
        workingDays += 1;
        if (!info.employed) { notEmployedDays += 1; counts.not_employed += 1; }
      }
      trace.push({ date, kind: 'holiday', status: info.employed ? null : 'not_employed', lop: 0, holiday_name: info.holidayName });
      continue;
    }

    // base === 'working'
    workingDays += 1;
    if (!info.employed) {
      notEmployedDays += 1;
      counts.not_employed += 1;
      trace.push({ date, kind: 'not_employed', status: 'not_employed', lop: 0 });
      continue;
    }

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
    // Name the leave category on leave days so the four categories surface in the trace.
    const leaveName = (dayStatus === 'paid_leave' || dayStatus === 'unpaid_leave') ? leave?.name : undefined;
    trace.push({ date, kind: 'working', status: dayStatus, lop: dayLop, ...(leaveName ? { leave_type: leaveName } : {}) });
  }

  // fixed_days: salary divides over a fixed number of days (e.g. 30) regardless
  // of the month's real shape; LOP still comes from actual attendance.
  const method = schedule.salary_calculation_method === 'fixed_days' ? 'fixed_days' : 'actual_days';
  const denominator = method === 'fixed_days' ? Number(schedule.fixed_working_days) || 30 : workingDays;
  // Employed-and-paid share of the scheduled working days, projected onto the
  // denominator. For actual_days (denominator = workingDays) this reduces to
  // scheduled − not_employed − lop; for fixed_days it scales that ratio onto the
  // fixed base, so a mid-month joiner or a fully-absent month is paid correctly
  // instead of subtracting actual-scale days from a 30-day base.
  const paidRatio = workingDays > 0 ? Math.max(0, workingDays - notEmployedDays - lop) / workingDays : 0;
  const paymentDays = round2(denominator * paidRatio);

  return {
    period_days: periodDays,
    working_days: denominator,
    scheduled_working_days: workingDays,
    lop_days: lop,
    not_employed_days: notEmployedDays,
    payment_days: paymentDays,
    counts,
    weekly_offs: weeklyOffs,
    holidays: holidayCount,
    method,
    unmarked_policy: unmarkedPolicy,
    roster_driven: cal.rosterMonth(start),
    trace,
  };
}
