import db from '../config/database';
import { ValidationError } from '../utils/errors';
import { getPaySchedule } from './paySchedule.service';
import { getAttendancePayRules } from './attendancePayRules.service';
import { resolveHolidayScope } from './leave.service';
import { audienceOf, scopeHolidaysTo } from './holidayScope';
import { getEmployeeLeaveRules, getEmployeeWorkWeek } from './leaveTemplate.service';
import {
  isOffDay, parseOffDayRules, pickAssignmentFor, rulesInForceOn, shiftLengthHours, type OffDayRule,
} from './shiftPattern';
import type { AttendanceContext } from './payslip.calc';

// ─────────────────────────────────────────────────────────────────────────────
// Payable-days engine.
//
// Each employee has their own working-day calendar. Which days they were SCHEDULED to work is
// resolved through named policies, most specific first, so no day is ever decided by an
// anonymous constant:
//   • the shift's own off days, when it declares any — the narrow override, for when the
//     shift itself dictates the pattern;
//   • otherwise the WORK WEEK ON THEIR LEAVE TEMPLATE. This is the main axis: it is where the
//     business decides who is off which day, and it expresses patterns like "every Sunday plus
//     the 2nd and 4th Saturday" directly;
//   • otherwise the Default template's, then the org Pay Schedule work week. An empty pattern
//     always means "not configured", never "works every day" — the difference is somebody's
//     Sunday, and a blank policy must not quietly turn rest days into working days;
//   • regional/national holidays overlay on top, but only on days already scheduled — a
//     holiday landing on a rest day is still a rest day, not a bonus day in the divisor;
//   • days outside the employment span [date_of_joining, last_working_day] are
//     "not employed" — they stay in the denominator but are never paid, so a
//     mid-month joiner/leaver is paid exactly for the days they were employed.
//
// The same calendar powers leave-day counting, so leave balance and payroll LOP
// agree for the same span (one calendar everywhere).
// ─────────────────────────────────────────────────────────────────────────────

export type DayStatus =
  | 'present' | 'half_day' | 'hhd' | 'absent' | 'no_punch'
  | 'miss_punch' | 'short_punch'
  | 'paid_leave' | 'unpaid_leave'
  | 'unmarked' | 'future' | 'not_employed';

/** Which named policy decided a day was, or was not, one the person was scheduled to work. */
export type OffDaySource = 'shift' | 'template' | 'default_template' | 'work_week';
export type DayDecidedBy = OffDaySource | 'holiday' | 'employment_span';

export interface DayTrace {
  date: string;                                   // YYYY-MM-DD
  kind: 'working' | 'weekly_off' | 'holiday' | 'not_employed';
  status: DayStatus | null;                       // null on non-working days
  lop: number;                                    // 0 | 0.5 | 1
  leave_debit?: number;                           // paid-leave fraction the code consumes (e.g. Half Day → 0.5)
  holiday_name?: string;
  leave_type?: string;                            // leave category on a leave day
  // Provenance. Without these, "why was this Sunday paid?" has no answer anywhere in the system,
  // which is exactly how a whole company came to be treated as working seven days a week.
  decided_by?: DayDecidedBy;
  decided_by_name?: string;                       // the shift, the leave template, or the holiday
}

export interface PayableDays extends AttendanceContext {
  counts: {
    present: number; half_day: number; hhd: number; absent: number; no_punch: number;
    miss_punch: number; short_punch: number;
    paid_leave: number; unpaid_leave: number; unmarked: number; future: number;
    not_employed: number;
  };
  weekly_offs: number;
  holidays: number;
  scheduled_working_days: number; // actual scheduled working days (denominator basis)
  not_employed_days: number; // scheduled working days outside the employment span
  /** ALL calendar days outside the span — rest days and holidays too. Used by calendar_days. */
  not_employed_calendar_days: number;
  // Paid-leave days a code's rule consumed (e.g. a Half Day = worked ½ + ½ leave). This is
  // the leave a run should debit from the employee's balance; the engine only measures it,
  // it does not mutate leave_entitlements (there is no leave-type on an attendance-marked day).
  leave_debit_days: number;
  method: string;            // actual_days | fixed_days
  unmarked_policy: string;   // present | absent
  shift_driven: boolean;     // true when the calendar came from a shift's own off days
  /** The policy that decided the working days, for the payslip. 'mixed' if it changed mid-month. */
  calendar_source: OffDaySource | 'mixed';
  calendar_name: string;
  trace: DayTrace[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Statuses that an approved regularisation must NOT pay in full.
 *
 * A regularisation pays the day outright because every status an employee can now ask for
 * describes a day they say they DID work — a missed punch, a short punch, a missing biometric
 * record. "Absent" is not a correction of that kind: it is the employee stating they did not
 * work, so paying it in full would pay for a day they themselves disclaimed.
 *
 * Asking to be marked absent was removed upstream (see regularisation.service), but rows
 * approved before that change still exist and migration 019 deliberately left them alone rather
 * than rewriting history. This is the guard that stops those legacy rows quietly paying out on
 * any month not yet locked. `on_leave` is listed for the same reason: a leave day's pay is the
 * leave module's decision, not a by-product of someone having corrected the record.
 */
const NEVER_PAID_ON_REGULARISATION = new Set(['absent', 'on_leave']);

const dowOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};

interface DayInfo {
  base: 'working' | 'weekly_off' | 'holiday';
  employed: boolean;
  holidayName?: string;
  shiftHours: number;   // length of the shift in effect (0 when the employee has none)
  allowOt: boolean;     // that shift allows overtime
  otAfter: number;      // hours after which overtime starts (0 = the shift's own length)
  source: OffDaySource; // which named policy decided whether this was a scheduled working day
  sourceName: string;
  employmentNote?: string; // why they were not employed on this date, when they weren't
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-06-10' → '10 Jun 2026', for a reason a person reads rather than parses. */
const humanDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};

/**
 * Paid days, from the month's shape and its losses.
 *
 * One formula, two callers: the engine below, and the LOP-override re-projection in
 * payslip.service. Those were two copies of the same arithmetic, which is exactly the pair that
 * silently disagrees — and disagreeing there means the employees Finance corrected by hand get
 * priced by the old rule.
 */
export function projectPaymentDays(a: {
  method: string;
  /** The salary divisor — what appears as `working_days` on the payslip. */
  denominator: number;
  scheduled_days: number;
  /** Scheduled WORKING days outside the employment span. */
  not_employed_days: number;
  /** ALL calendar days outside the span, rest days and holidays included. */
  not_employed_calendar_days: number;
  lop_days: number;
}): number {
  if (a.method === 'calendar_days') {
    // The denominator IS the month, and rest days and holidays are already inside it. So paid
    // days are the month minus what was lost — never the month PLUS the offs and holidays it
    // already contained, which is the spreadsheet formula that printed 35.5 days in a 31-day
    // month. The clamp cannot fire while pay_fraction is validated 0..1, and is here so the
    // invariant is asserted rather than merely reasoned about.
    const paid = a.denominator - a.not_employed_calendar_days - a.lop_days;
    return round2(Math.min(a.denominator, Math.max(0, paid)));
  }
  // Employed-and-paid share of the scheduled working days, projected onto the denominator. For
  // actual_days (denominator = scheduled) this reduces to scheduled − not_employed − lop; for
  // fixed_days it scales that ratio onto the fixed base, so a mid-month joiner or a fully-absent
  // month is paid correctly instead of subtracting actual-scale days from a 30-day base.
  const ratio = a.scheduled_days > 0
    ? Math.max(0, a.scheduled_days - a.not_employed_days - a.lop_days) / a.scheduled_days
    : 0;
  return round2(a.denominator * ratio);
}

export interface WorkCalendar {
  classify(date: string): DayInfo;
  /** True when the shift's own off-day pattern decided this date, not the work week. */
  shiftDriven(date: string): boolean;
}

/**
 * Builds an employee's working-day calendar for a date range, from the shift they are mapped
 * to on each date.
 *
 * The shift declares its own off days, so there is no weekly grid to fill in. A shift that
 * declares none falls back to the company work week — deliberately, since a shift with nothing
 * configured must not quietly turn weekends into working days.
 *
 * Holidays overlay on top, resolved through the employee's property and its state.
 */
export async function buildWorkCalendar(
  employeeId: number, startDate: string, endDate: string,
): Promise<WorkCalendar> {
  const emp = await db('employees').where('id', employeeId)
    .select('date_of_joining', 'last_working_day', 'branch_name').first();
  const doj = emp?.date_of_joining ? String(emp.date_of_joining).slice(0, 10) : null;
  const lwd = emp?.last_working_day ? String(emp.last_working_day).slice(0, 10) : null;

  const schedule = await getPaySchedule();
  const workWeek = new Set<number>(schedule.work_week);
  // The first date any work pattern is allowed to speak for. Patterns are configured today but
  // evaluated across history, so without this a pattern saved this morning would silently
  // re-price a month that has already been paid. See `rulesInForceOn`.
  const patternsFrom = schedule.work_pattern_effective_from ?? null;
  const workWeekPolicy = await getEmployeeWorkWeek(employeeId);

  // Every dated assignment in one query, resolved per date in memory — the alternative is a
  // lookup per day, and this runs for every employee on every payroll run.
  const assignments = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('a.effective_from', 'st.start_time', 'st.end_time', 'st.ends_next_day',
      'st.allow_overtime', 'st.overtime_after_hours', 'st.weekly_off_days', 'st.name')
    .orderBy('a.effective_from');

  const prepared = assignments.map((a: any) => ({
    effective_from: String(a.effective_from).slice(0, 10),
    name: a.name,
    hours: shiftLengthHours(a.start_time, a.end_time),
    allowOt: !!a.allow_overtime,
    otAfter: Number(a.overtime_after_hours) || 0,
    offRules: parseOffDayRules(a.weekly_off_days),
  }));

  const today = new Date().toISOString().slice(0, 10);
  /** The shift in effect on a date — same rule as everywhere else. */
  const shiftOn = (date: string) => pickAssignmentFor(prepared, date, today);

  // One definition of who a holiday reaches, shared with the holiday screen and the attendance
  // calendar. It is pure query-building and reads nothing of its own — see holidayScope.ts for
  // why this is one function rather than three copies.
  const audience = audienceOf(await resolveHolidayScope(employeeId));
  const holidayRows = await scopeHolidaysTo(
    db('holidays').whereBetween('date', [startDate, endDate]),
    audience,
  ).select('date', 'name');
  const holidayByDate = new Map<string, string>(holidayRows.map((h: any) => [String(h.date).slice(0, 10), h.name]));

  /**
   * Which named policy owns this date's off-day pattern, most specific first.
   *
   * Each rung is a thing with a name, so every day can say what decided it. An empty pattern at
   * any rung means "not configured" and falls through — it never means "works every day", because
   * a blank policy quietly turning rest days into working days is the failure this whole change
   * exists to fix.
   */
  const policyFor = (date: string): { rules: OffDayRule[]; source: OffDaySource; name: string } => {
    const shift = shiftOn(date);
    const shiftRules = rulesInForceOn(date, shift?.offRules ?? [], patternsFrom);
    if (shiftRules.length) return { rules: shiftRules, source: 'shift', name: shift!.name };

    const templateRules = rulesInForceOn(date, workWeekPolicy.rules, patternsFrom);
    if (templateRules.length && workWeekPolicy.source !== 'none') {
      return {
        rules: templateRules,
        source: workWeekPolicy.source === 'template' ? 'template' : 'default_template',
        name: workWeekPolicy.name ?? 'Leave template',
      };
    }
    return { rules: [], source: 'work_week', name: 'Company work week' };
  };

  /** True when the shift itself decided this date, rather than a leave template or the work week. */
  const shiftDriven = (date: string) => policyFor(date).source === 'shift';

  const classify = (date: string): DayInfo => {
    const employed = (!doj || date >= doj) && (!lwd || date <= lwd);
    const employmentNote = employed ? undefined
      : (doj && date < doj) ? `Joined ${humanDate(doj)}`
      : (lwd ? `Left ${humanDate(lwd)}` : 'Outside their employment dates');
    const shift = shiftOn(date);
    const shiftHours = shift?.hours ?? 0;
    const allowOt = shift?.allowOt ?? false;
    const otAfter = shift?.otAfter ?? 0;

    const { rules, source, name } = policyFor(date);
    const isOff = rules.length ? isOffDay(date, rules) : !workWeek.has(dowOf(date));
    const holidayName = holidayByDate.get(date);

    // The off-day question is answered BEFORE the holiday overlay, and that order is the whole
    // point. A holiday landing on someone's rest day is still a rest day: they were never
    // scheduled to work it. Tested the other way round, it became a PAID HOLIDAY and added a day
    // to the salary divisor that nobody was rostered for — which quietly changed the price of
    // every lost day in that month. The holiday's name is kept on the day either way; it is
    // still Diwali, it just does not move any money.
    const common = { employed, employmentNote, shiftHours, allowOt, otAfter, source, sourceName: name };
    if (isOff) return { base: 'weekly_off', holidayName, ...common };
    if (holidayName !== undefined) return { base: 'holiday', holidayName, ...common };
    return { base: 'working', ...common };
  };

  return { classify, shiftDriven };
}

/**
 * Count of working days for the employee in [start, end], excluding holidays, off days, and
 * days outside the employment span.
 *
 * Leave sizing and payroll now share one calendar. Previously they could disagree: leave
 * deliberately ignored the roster so an unpublished future week didn't make ordinary working
 * days read as offs, while payroll used it. A shift's off days are known in advance, so there
 * is nothing to opt out of.
 */
export async function countWorkingDaysInRange(employeeId: number, startDate: string, endDate: string): Promise<number> {
  const cal = await buildWorkCalendar(employeeId, startDate, endDate);
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
 * The dates a leave request actually covers — the single answer both the balance and the
 * attendance calendar must use.
 *
 * They used to disagree. The debit counted working days while the calendar was marked for every
 * date in the range, so a Friday-to-Monday leave took 2 days off the balance and wrote 4 "on
 * leave" days, two of them on a weekend nobody had asked for. That was harmless only for as long
 * as payroll ignored rest days entirely; once a six-day week makes Saturday a working day, an
 * unpaid-leave mark sitting on it costs a full day of pay the employee never requested.
 *
 * `countSandwich` is the leave type's sandwich rule: when on, the rest days and holidays bridging
 * a leave are consumed too, so they are BOTH debited and marked. When off, neither.
 */
export async function leaveDatesFor(
  employeeId: number, startDate: string, endDate: string, countSandwich: boolean,
): Promise<string[]> {
  const cal = await buildWorkCalendar(employeeId, startDate, endDate);
  const out: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  // The same 400-day ceiling the old walker used, but explicit: silently truncating a range is
  // how the count and the marks came to differ in the first place.
  while (cur <= last) {
    if (out.length >= 400) {
      throw new ValidationError('A leave request cannot span more than 400 days.');
    }
    const date = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
    const info = cal.classify(date);
    if (countSandwich || (info.base === 'working' && info.employed)) out.push(date);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/**
 * Overtime hours for the month: Σ max(0, worked − the threshold) per attendance day, using
 * the shift in effect on that date, and only when that shift allows overtime.
 *
 * The threshold is the shift's own "overtime after hours" when set, otherwise its length —
 * which is what this did before the figure existed, so nothing moves for a shift that hasn't
 * set one.
 */
export async function getOvertimeHours(employeeId: number, month: number, year: number): Promise<number> {
  const periodDays = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(periodDays)}`;

  const cal = await buildWorkCalendar(employeeId, start, end);

  const rows = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .whereNotNull('working_hours')
    .select('date', 'working_hours');

  let total = 0;
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const info = cal.classify(date);
    if (!info.employed) continue;          // no OT outside the employment span
    if (info.base !== 'working') continue; // no OT on a rest day or holiday
    if (!info.allowOt) continue;
    const threshold = info.otAfter > 0 ? info.otAfter : info.shiftHours;
    if (threshold <= 0) continue;
    total += Math.max(0, (Number(r.working_hours) || 0) - threshold);
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
  // Per-code pay rules (Admin → Payroll → Attendance Pay Rules). lopFor(code) = 1 − pay_fraction.
  const payRules = await getAttendancePayRules();
  const lopFor = (code: string): number => {
    const r = payRules.get(code);
    return Math.round((1 - (r ? r.pay_fraction : 1)) * 100) / 100;
  };
  let missPunchSeen = 0; // miss punches counted in date order — first N are within allowance

  const periodDays = new Date(year, month, 0).getDate();
  const start = `${year}-${pad(month)}-01`;
  const end = `${year}-${pad(month)}-${pad(periodDays)}`;
  const todayStr = new Date().toISOString().slice(0, 10);

  const cal = await buildWorkCalendar(employeeId, start, end);

  // ── Inputs: attendance, approved leaves (paid/unpaid) ──
  const records = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [start, end])
    .select('date', 'status', 'is_regularised');
  const statusByDate = new Map<string, string>(records.map((r: any) => [String(r.date).slice(0, 10), r.status]));
  // An APPROVED regularisation pays the day in full, ahead of the code's rule and any leave.
  const regularisedByDate = new Map<string, boolean>(records.map((r: any) => [String(r.date).slice(0, 10), !!r.is_regularised]));

  // Paid vs unpaid (Loss of Pay) now comes from the employee's assigned leave template,
  // not the global leave type — so two employees on different plans can classify the
  // same leave type differently. Falls back to the type's own flag if the template omits it.
  const leaveRules = await getEmployeeLeaveRules(employeeId);
  const leaves = await db('leave_requests as lr')
    .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
    .where('lr.employee_id', employeeId)
    .where('lr.status', 'approved')
    .where('lr.start_date', '<=', end)
    .where('lr.end_date', '>=', start)
    .select('lr.start_date', 'lr.end_date', 'lr.leave_type_id', 'lt.is_paid', 'lt.name as leave_type');

  const leaveOn = (date: string): { paid: boolean; name: string } | null => {
    for (const l of leaves) {
      if (String(l.start_date).slice(0, 10) <= date && String(l.end_date).slice(0, 10) >= date) {
        const rule = leaveRules.get(l.leave_type_id);
        return { paid: rule ? rule.is_paid : !!l.is_paid, name: l.leave_type };
      }
    }
    return null;
  };

  // ── Day-by-day classification ──
  const counts = { present: 0, half_day: 0, hhd: 0, absent: 0, no_punch: 0, miss_punch: 0, short_punch: 0, paid_leave: 0, unpaid_leave: 0, unmarked: 0, future: 0, not_employed: 0 };
  const trace: DayTrace[] = [];
  let workingDays = 0;      // scheduled working days (denominator for actual_days)
  let weeklyOffs = 0;
  let holidayCount = 0;
  let notEmployedDays = 0;  // scheduled WORKING days outside the employment span
  // EVERY calendar day outside the span — rest days and holidays too. Deliberately a separate
  // counter: `notEmployedDays` above is the unpaid-share numerator for actual_days and
  // fixed_days, whose base is working days, and feeding rest days into it would subtract rest
  // days from a working-days denominator and cut every mid-month joiner's pay on those methods.
  let notEmployedCalendarDays = 0;
  let lop = 0;
  let leaveDebit = 0;       // paid-leave fraction codes consume (Half Day → ½), measured not mutated
  let shiftDriven = false; // true once any day in the month was decided by a shift's own off days
  // Which named policy set the working days. Collected across the month so the payslip can say
  // it in one line, and so a mid-month change reads as 'mixed' rather than silently as the last
  // one seen.
  const sourcesSeen = new Map<OffDaySource, string>();

  for (let d = 1; d <= periodDays; d++) {
    const date = `${year}-${pad(month)}-${pad(d)}`;
    const info = cal.classify(date);
    if (cal.shiftDriven(date)) shiftDriven = true;
    sourcesSeen.set(info.source, info.sourceName);
    const decided = { decided_by: info.source, decided_by_name: info.sourceName };

    // Counted before the three branches below, because under calendar_days a rest day before
    // somebody joined must not be paid — and the weekly-off branch returns early.
    if (!info.employed) notEmployedCalendarDays += 1;

    if (info.base === 'weekly_off') {
      // A holiday can coincide with a rest day. It stays named on the day — it is still Diwali —
      // but it is the rest day that decided nothing was owed, so that is what is recorded.
      const alsoHoliday = info.holidayName ? { holiday_name: info.holidayName } : {};
      if (info.employed) {
        weeklyOffs += 1;
        trace.push({ date, kind: 'weekly_off', status: null, lop: 0, ...alsoHoliday, ...decided });
      } else {
        trace.push({
          date, kind: 'not_employed', status: null, lop: 0,
          decided_by: 'employment_span', decided_by_name: info.employmentNote ?? 'Outside their employment dates',
        });
      }
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
      trace.push({
        date, kind: 'holiday', status: info.employed ? null : 'not_employed', lop: 0,
        holiday_name: info.holidayName, decided_by: 'holiday', decided_by_name: info.holidayName ?? 'Holiday',
      });
      continue;
    }

    // base === 'working'
    workingDays += 1;
    if (!info.employed) {
      notEmployedDays += 1;
      counts.not_employed += 1;
      trace.push({
        date, kind: 'not_employed', status: 'not_employed', lop: 0,
        decided_by: 'employment_span', decided_by_name: info.employmentNote ?? 'Outside their employment dates',
      });
      continue;
    }

    const leave = leaveOn(date);
    const status = statusByDate.get(date);
    const regularised = regularisedByDate.get(date) === true;
    let dayStatus: DayStatus;
    let dayLop = 0;

    if (regularised && !NEVER_PAID_ON_REGULARISATION.has(status ?? '')) {
      // Approved regularisation → full pay, overriding the code's rule and any overlapping leave.
      dayStatus = 'present';
    } else if (status === 'present') {
      dayStatus = 'present'; dayLop = lopFor('present');
    } else if (status === 'half_day') {
      dayStatus = 'half_day'; dayLop = lopFor('half_day');
    } else if (status === 'hhd') {
      // Half-day holiday — pay per its configured rule (default half).
      dayStatus = 'hhd'; dayLop = lopFor('hhd');
    } else if (status === 'no_punch') {
      // No biometric record — its own configurable code, distinct from Absent. Leave still wins.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else { dayStatus = 'no_punch'; dayLop = lopFor('no_punch'); }
    } else if (status === 'miss_punch') {
      // An approved leave governs the day even if a stray punch marked it a miss
      // punch (mirrors the absent branch). Otherwise: the first N miss punches a
      // month are regularized (paid); beyond the allowance each costs miss_punch_lop.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else {
        dayStatus = 'miss_punch';
        // First N a month are within allowance (pay per rule); beyond earns beyond_pay_fraction.
        //
        // An allowance of zero — or none configured — means there is no allowance TIER, not that
        // everybody is already past it. Read the other way, `pay_fraction` becomes dead the moment
        // the allowance is switched off, and the Attendance Pay Rules screen goes on displaying it
        // as though it decided something. For any allowance of 1 or more this is unchanged.
        const mp = payRules.get('miss_punch');
        const allowanceRaw = Number(mp?.config?.allowance);
        const allowance = Number.isFinite(allowanceRaw) && allowanceRaw > 0 ? Math.trunc(allowanceRaw) : 0;
        if (allowance === 0 || missPunchSeen < allowance) {
          dayLop = lopFor('miss_punch');
        } else {
          const beyondPay = Number(mp?.config?.beyond_pay_fraction ?? 0.5);
          dayLop = Math.round((1 - beyondPay) * 100) / 100;
        }
        missPunchSeen += 1; // only genuine miss punches consume the allowance
      }
    } else if (status === 'short_punch') {
      // An approved leave (e.g. a half-day) governs the day before the early-exit penalty.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else {
        dayStatus = 'short_punch'; dayLop = lopFor('short_punch');
      }
    } else if (status === 'on_leave') {
      if (leave && !leave.paid) { dayStatus = 'unpaid_leave'; dayLop = 1; }
      else dayStatus = 'paid_leave';
    } else if (status === 'absent') {
      // An approved paid leave protects the day even if the register says absent.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else { dayStatus = 'absent'; dayLop = lopFor('absent'); }
    } else {
      // No attendance record.
      if (leave) {
        if (leave.paid) dayStatus = 'paid_leave';
        else { dayStatus = 'unpaid_leave'; dayLop = 1; }
      } else if (date > todayStr) {
        dayStatus = 'future'; // month still in progress — not yet payable info
      } else if (unmarkedPolicy === 'absent') {
        dayStatus = 'unmarked'; dayLop = lopFor('absent');
      } else {
        dayStatus = 'unmarked';
      }
    }

    counts[dayStatus] += 1;
    lop += dayLop;
    // A code that "uses up" part of a paid leave (default: Half Day → ½). Only when the code's
    // own rule governed the day — an approved regularisation or an overlapping leave takes over
    // the day and no code-driven leave is consumed.
    let dayLeaveDebit = 0;
    if (!regularised && !leave) {
      const rule = payRules.get(dayStatus);
      if (rule && rule.deducts_leave_fraction > 0) { dayLeaveDebit = rule.deducts_leave_fraction; leaveDebit += dayLeaveDebit; }
    }
    // Name the leave category on leave days so the four categories surface in the trace.
    const leaveName = (dayStatus === 'paid_leave' || dayStatus === 'unpaid_leave') ? leave?.name : undefined;
    trace.push({
      date, kind: 'working', status: dayStatus, lop: dayLop,
      ...(dayLeaveDebit > 0 ? { leave_debit: dayLeaveDebit } : {}),
      ...(leaveName ? { leave_type: leaveName } : {}),
      decided_by: info.source, decided_by_name: info.sourceName,
    });
  }

  // Which shape of month the salary divides over.
  //   calendar_days — the days in this month (28/29/30/31). Weekly offs and holidays are PAID
  //                   days sitting inside that total, so they cost nothing and a lost day costs
  //                   1/31 of a 31-day month rather than 1/26 of its working days.
  //   fixed_days    — a fixed number (e.g. 30) regardless of the month's real shape.
  //   actual_days   — the days the employee was actually scheduled to work.
  const rawMethod = schedule.salary_calculation_method;
  const method = rawMethod === 'fixed_days' ? 'fixed_days'
    : rawMethod === 'calendar_days' ? 'calendar_days'
    : 'actual_days';
  const denominator = method === 'calendar_days' ? periodDays
    : method === 'fixed_days' ? (Number(schedule.fixed_working_days) || 30)
    : workingDays;
  const paymentDays = projectPaymentDays({
    method,
    denominator,
    scheduled_days: workingDays,
    not_employed_days: notEmployedDays,
    not_employed_calendar_days: notEmployedCalendarDays,
    lop_days: lop,
  });

  // One line for the payslip: which named policy set this month's working days. More than one
  // means the person moved between policies mid-month, and saying 'mixed' is honest where naming
  // whichever happened to be seen last would not be.
  const [onlySource, onlyName] = sourcesSeen.size === 1 ? [...sourcesSeen.entries()][0] : [null, null];
  const calendarSource: OffDaySource | 'mixed' = onlySource ?? 'mixed';
  const calendarName = onlyName ?? [...sourcesSeen.values()].join(' + ');

  return {
    period_days: periodDays,
    working_days: denominator,
    scheduled_working_days: workingDays,
    lop_days: lop,
    not_employed_days: notEmployedDays,
    not_employed_calendar_days: notEmployedCalendarDays,
    leave_debit_days: round2(leaveDebit),
    payment_days: paymentDays,
    counts,
    weekly_offs: weeklyOffs,
    holidays: holidayCount,
    method,
    unmarked_policy: unmarkedPolicy,
    shift_driven: shiftDriven,
    calendar_source: calendarSource,
    calendar_name: calendarName || 'Company work week',
    trace,
  };
}
