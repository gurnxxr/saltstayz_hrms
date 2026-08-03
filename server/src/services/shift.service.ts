import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { pickAssignmentFor, parseOffDayRules } from './shiftPattern';
import { buildCsv, parseCsv } from '../utils/csv';
import { businessToday } from '../utils/businessDate';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Sun, Sat(2,4)" — a shift's off days as text, for the CSV export. */
function offDaySummary(raw: unknown): string {
  const rules = parseOffDayRules(raw);
  if (!rules.length) return 'Company work week';
  return rules.slice().sort((a, b) => a.day - b.day)
    .map((r) => (r.weeks && r.weeks.length ? `${DAYS_SHORT[r.day]}(${r.weeks.join(',')})` : DAYS_SHORT[r.day]))
    .join(', ');
}

// ─── Shift Types (organization-wide) ───

export const ROSTER_COLORS = ['Blue', 'Cyan', 'Fuchsia', 'Green', 'Lime', 'Orange', 'Pink', 'Red', 'Violet', 'Yellow'] as const;

/** How the day's in and out are picked from the punches. */
export const ATTENDANCE_BASIS = ['first_last', 'every_valid'] as const;
/** What a day with no attendance record counts as. Null defers to the company setting. */
export const CONSIDER_NA = ['present', 'absent'] as const;

const SHIFT_TYPE_BOOL_COLS = [
  'is_active', 'enable_auto_attendance', 'allow_overtime', 'ends_next_day', 'grace_enabled',
];

const toBool = (v: any) => v === true || v === 1 || v === '1' || v === 'true';
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hand the client real booleans and a parsed off-day pattern for form hydration. */
function mapShiftType(row: any) {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of SHIFT_TYPE_BOOL_COLS) {
    if (c in out && out[c] !== null && out[c] !== undefined) out[c] = !!out[c];
  }
  // jsonb comes back parsed from pg, but a legacy text value would not.
  if (typeof out.weekly_off_days === 'string') {
    try { out.weekly_off_days = JSON.parse(out.weekly_off_days); } catch { out.weekly_off_days = []; }
  }
  out.weekly_off_days = Array.isArray(out.weekly_off_days) ? out.weekly_off_days : [];
  return out;
}

/**
 * The off-day pattern: which weekdays this shift doesn't work, and in which weeks.
 * `{ day: 0-6, weeks: null }` is every week; `{ day: 6, weeks: [2, 4] }` is the 2nd and 4th
 * Saturday of the month — the common Indian arrangement.
 */
function parseWeeklyOffDays(raw: any): Array<{ day: number; weeks: number[] | null }> {
  if (!Array.isArray(raw)) throw new ValidationError('Weekly off days must be a list');
  const seen = new Set<number>();
  const out = raw.map((entry: any) => {
    const day = Math.trunc(Number(entry?.day));
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new ValidationError('Each weekly off day must be a weekday from 0 (Sunday) to 6 (Saturday)');
    }
    if (seen.has(day)) throw new ValidationError('The same weekday is listed twice in the off-day pattern');
    seen.add(day);

    if (entry.weeks === null || entry.weeks === undefined || entry.weeks === '') return { day, weeks: null };
    if (!Array.isArray(entry.weeks)) throw new ValidationError('Weeks must be a list, or empty for every week');
    const weeks = entry.weeks.map((w: any) => Math.trunc(Number(w))).filter((w: number) => Number.isInteger(w));
    if (weeks.some((w: number) => w < 1 || w > 5)) {
      throw new ValidationError('Weeks must be between 1 and 5 (the 1st to 5th occurrence in the month)');
    }
    return { day, weeks: weeks.length ? [...new Set<number>(weeks)].sort() : null };
  });

  // Every weekday off leaves no working day to divide the salary by: the month's scheduled days
  // fall to 0, so `payment_days` is 0 and everyone on the shift nets zero — silently, because
  // zero is arithmetically valid and nothing downstream objects. The hiring guard doesn't catch
  // it either: `assertHasWeeklyOff` correctly reports that a rest day exists. The write is the
  // hole, so it closes here, where both create and update pass through.
  //
  // Only unrestricted entries count. Seven days each limited to specific weeks (`{day, weeks}`)
  // still leaves working days in the weeks not named, so that stays legal.
  if (out.length >= 7 && out.every((r: { weeks: number[] | null }) => r.weeks === null)) {
    throw new ValidationError('A shift cannot have every day off — that would leave no working days to pay.');
  }
  return out;
}

/**
 * Pull only the columns present in `data`, coercing and validating each. Used by both create
 * (spread over the row) and update (partial set), so a key absent from the payload keeps its
 * existing value.
 */
function collectShiftTypeConfig(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  const setBool = (k: string) => { if (k in data) out[k] = toBool(data[k]); };
  const setInt = (k: string) => { if (k in data) { const n = Math.trunc(Number(data[k])); out[k] = Number.isFinite(n) && n >= 0 ? n : 0; } };
  const setNum = (k: string) => { if (k in data) { const n = Number(data[k]); out[k] = Number.isFinite(n) && n >= 0 ? n : 0; } };
  const setTime = (k: string, label: string) => {
    if (!(k in data)) return;
    const v = String(data[k] ?? '').trim();
    if (!v) { out[k] = null; return; }
    if (!HHMM.test(v)) throw new ValidationError(`${label} must be a time like 08:30`);
    out[k] = v;
  };

  setBool('enable_auto_attendance');
  setBool('allow_overtime');
  setBool('ends_next_day');
  setBool('grace_enabled');

  setInt('max_early_in_mins');
  setInt('max_late_out_mins');
  setInt('late_in_grace_mins');
  setInt('early_out_grace_mins');
  setInt('grace_occurrences_per_month');

  setNum('absent_hours');
  setNum('half_day_hours');
  setNum('full_day_hours');
  setNum('overtime_after_hours');

  setTime('office_hour_time', 'Office hour time');
  setTime('force_time_out', 'Force time out');

  if ('monthly_adjustment' in data) {
    const v = String(data.monthly_adjustment ?? '').trim();
    if (!v) out.monthly_adjustment = null;
    else {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new ValidationError('Monthly adjustment must be a number');
      out.monthly_adjustment = n;
    }
  }

  if ('roster_color' in data) {
    out.roster_color = (ROSTER_COLORS as readonly string[]).includes(data.roster_color) ? data.roster_color : 'Blue';
  }
  if ('attendance_basis' in data) {
    out.attendance_basis = (ATTENDANCE_BASIS as readonly string[]).includes(data.attendance_basis)
      ? data.attendance_basis : 'first_last';
  }
  if ('consider_na' in data) {
    const v = String(data.consider_na ?? '').trim();
    out.consider_na = (CONSIDER_NA as readonly string[]).includes(v) ? v : null;
  }
  if ('effective_from' in data) out.effective_from = data.effective_from || null;
  if ('weekly_off_days' in data) out.weekly_off_days = JSON.stringify(parseWeeklyOffDays(data.weekly_off_days));

  return out;
}

/**
 * Absent, half-day and full-day are a ladder: work less than the absent figure and the day
 * doesn't count, less than the half-day figure and it's half. A configuration where they
 * aren't in order can't be applied sensibly, so it's rejected rather than silently ignored.
 */
function assertHourLadder(absent: number, half: number, full: number) {
  if (absent > 0 && half > 0 && absent >= half) {
    throw new ValidationError('Absent hours must be less than half-day hours');
  }
  if (half > 0 && full > 0 && half >= full) {
    throw new ValidationError('Half-day hours must be less than full-day hours');
  }
}

export async function listShiftTypes() {
  const rows = await db('shift_types').select('*').orderBy('start_time');
  return rows.map(mapShiftType);
}

export async function getShiftType(id: number) {
  const row = await db('shift_types').where('id', id).first();
  if (!row) throw new NotFoundError('Shift type');
  return mapShiftType(row);
}

export async function createShiftType(data: any) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Shift name is required');
  if (!data.start_time) throw new ValidationError('Start time is required');
  if (!data.end_time) throw new ValidationError('End time is required');
  if (!HHMM.test(String(data.start_time))) throw new ValidationError('Start time must be a time like 09:00');
  if (!HHMM.test(String(data.end_time))) throw new ValidationError('End time must be a time like 18:00');
  const dup = await db('shift_types').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A shift type with this name already exists');

  const config = collectShiftTypeConfig(data);
  assertHourLadder(config.absent_hours ?? 0, config.half_day_hours ?? 0, config.full_day_hours ?? 0);

  // A shift whose end is at or before its start must cross midnight; don't let the form say
  // otherwise, since that decides which day the hours belong to.
  const endsNextDay = 'ends_next_day' in config
    ? config.ends_next_day
    : String(data.end_time) <= String(data.start_time);
  if (!endsNextDay && String(data.end_time) <= String(data.start_time)) {
    throw new ValidationError('This shift ends at or before it starts, so "ends next day" must be on');
  }

  const [{ id }] = await db('shift_types').insert({
    name,
    start_time: data.start_time,
    end_time: data.end_time,
    ...config,
    ends_next_day: endsNextDay,
  }).returning('id');
  return getShiftType(id);
}

export async function updateShiftType(id: number, data: any) {
  const existing = await db('shift_types').where('id', id).first();
  if (!existing) throw new NotFoundError('Shift type');

  const set: Record<string, any> = {};
  if ('name' in data) {
    const name = String(data.name || '').trim();
    if (!name) throw new ValidationError('Shift name is required');
    const dup = await db('shift_types').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
    if (dup) throw new ValidationError('A shift type with this name already exists');
    set.name = name;
  }
  if ('start_time' in data) {
    if (!HHMM.test(String(data.start_time))) throw new ValidationError('Start time must be a time like 09:00');
    set.start_time = data.start_time;
  }
  if ('end_time' in data) {
    if (!HHMM.test(String(data.end_time))) throw new ValidationError('End time must be a time like 18:00');
    set.end_time = data.end_time;
  }
  if ('is_active' in data) set.is_active = toBool(data.is_active);
  Object.assign(set, collectShiftTypeConfig(data));

  // Validate the resulting shift, not just the fields that happen to be in this payload.
  const merged = { ...existing, ...set };
  assertHourLadder(Number(merged.absent_hours) || 0, Number(merged.half_day_hours) || 0, Number(merged.full_day_hours) || 0);
  if (!toBool(merged.ends_next_day) && String(merged.end_time) <= String(merged.start_time)) {
    throw new ValidationError('This shift ends at or before it starts, so "ends next day" must be on');
  }

  // A shift type carries no effective date, so editing one reaches every month it has ever
  // governed — `pickAssignmentFor` projects a shift backwards over dates that pre-date the
  // mapping itself. `assignShift` has always been guarded against that; this write never was,
  // even though these fields are the ones that move money: the timings set the overtime
  // threshold, and the hour ladder decides the auto-marked verdict for a day.
  //
  // `weekly_off_days` IS in this list, and the reasoning that previously excluded it was wrong.
  // The old comment argued that `rulesInForceOn` already clamps a pattern so it cannot speak for
  // a month priced before patterns existed. That clamp is real, but it only bounds how far BACK a
  // pattern reaches — it does nothing for a month that was locked AFTER the clamp date. Such a
  // month re-prices freely: measured on a real absent day, moving a shift from 26 scheduled days
  // to 17 raised the cost of that one day from 1.15 to 1.76 salary-days, a 53% jump, backwards,
  // from a single save. Stored payslips are snapshots and survive, but the payroll register, the
  // day-by-day trace and any unlock-and-rerun all read the live calendar.
  //
  // The pattern does NOT become uneditable: the dated escape hatch is the same one the message
  // below already recommends — make a new shift type and move people onto it from a date.
  const REPRICES_HISTORY = [
    'start_time', 'end_time', 'ends_next_day',
    'allow_overtime', 'overtime_after_hours', 'enable_auto_attendance',
    'absent_hours', 'half_day_hours', 'full_day_hours', 'office_hour_time',
    'weekly_off_days',
  ];
  // `weekly_off_days` needs shape-aware comparison. `set` carries it as a JSON string (that is what
  // gets written to the jsonb column) while `existing` comes back from pg already parsed, so a bare
  // String() gives '[object Object]' for the stored side and never matches. Without this, resaving
  // an UNCHANGED pattern would read as changed and block every shift-type edit — including a pure
  // rename — the moment any month is locked.
  const norm = (k: string, v: any) => (k === 'weekly_off_days'
    ? JSON.stringify(typeof v === 'string' ? (() => { try { return JSON.parse(v || '[]'); } catch { return []; } })() : (v ?? []))
    : String(v ?? ''));
  const changed = REPRICES_HISTORY.filter(
    (k) => k in set && norm(k, set[k]) !== norm(k, (existing as any)[k]),
  );
  if (changed.length) {
    const locked = await db('payroll_runs').where('status', 'locked').orderBy(['year', 'month']).first();
    if (locked) {
      throw new ValidationError(
        `Payroll for ${locked.month}/${locked.year} is locked, and this shift has no effective date — ` +
        `changing its ${changed.includes('weekly_off_days') ? 'off days' : 'hours'} would re-price every ` +
        `month it has ever covered, including that one. Create a new shift type with the change and ` +
        `move people onto it from a date instead.`,
      );
    }
  }

  await db('shift_types').where('id', id).update({ ...set, updated_at: db.fn.now() });
  return getShiftType(id);
}

export async function deleteShiftType(id: number) {
  const row = await db('shift_types').where('id', id).first();
  if (!row) throw new NotFoundError('Shift type');
  // Any assignment counts, including a historical one — deleting the shift would leave a past
  // month unable to resolve which shift somebody was on.
  const assigned = await db('employee_shift_assignments').where('shift_type_id', id).count('* as c').first();
  if (Number((assigned as any)?.c || 0) > 0) {
    throw new ValidationError('Cannot delete: this shift is assigned to employees. Deactivate it instead — past months still need to resolve which shift someone was on.');
  }
  const requested = await db('employee_shift_change_requests')
    .where((q) => q.where('from_shift_type_id', id).orWhere('to_shift_type_id', id))
    .count('* as c').first();
  if (Number((requested as any)?.c || 0) > 0) {
    throw new ValidationError('Cannot delete: this shift appears in a shift-change request. Deactivate it instead.');
  }
  await db('shift_types').where('id', id).del();
  return { id };
}

// ─── Employee self-service: my current shift (dashboard card) ───

// ─── Employee → shift mapping ───

const isoDate = (v: any) => String(v ?? '').slice(0, 10);
/**
 * The business's date, not UTC's. The assignment form writes the browser's local date, so a
 * shift assigned before 05:30 IST used to read as future-dated here and vanish from the
 * employee's screen until mid-morning. See utils/businessDate.ts.
 */
const todayIso = () => businessToday();

/**
 * Which shift a person was on, on a date — for one employee at a time.
 *
 * The rule itself lives in `pickAssignmentFor`. The batch paths (the attendance upload, the
 * daily re-check) fetch every assignment in one query and apply the same function in memory
 * rather than calling this per row, so they share the rule without an N+1.
 */
export async function resolveShiftForEmployee(employeeId: number, date: string) {
  const rows = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    // The assignment's dates are aliased out of the way. `st.*` already emits an
    // `effective_from` of its own — migration 003 renamed `process_attendance_after` to that —
    // so selecting `a.effective_from` beside it puts TWO columns of the same name in one row and
    // which survives is down to driver ordering. It happens to be the assignment's today, which
    // is why this works; reorder the select and the shift TYPE's date would silently start
    // deciding which assignment applies, and that feeds payable days. attendance.service.ts:71
    // avoids the same clash by naming the shift's copy `shift_effective_from`.
    .select(
      'st.*',
      'a.effective_from as assignment_effective_from',
      'a.effective_to as assignment_effective_to',
      'a.id as assignment_id',
    )
    .orderBy('a.effective_from');

  // pickAssignmentFor reads `effective_from`/`effective_to`. Hand it the ASSIGNMENT's, by name.
  const dated = (rows as any[]).map((r) => ({
    ...r,
    shift_effective_from: r.effective_from,
    effective_from: r.assignment_effective_from,
    effective_to: r.assignment_effective_to,
  }));

  const chosen = pickAssignmentFor(dated, isoDate(date) || todayIso(), todayIso());
  return chosen ? mapShiftType(chosen) : null;
}

/**
 * Refuses when a locked payroll month would be affected.
 *
 * `from` is the earliest date the change reaches; null means "reaches all the way back", which
 * is the case when the assignment being removed is the employee's earliest and the historical
 * fallback moves with it.
 *
 * Compares on `year * 12 + month` so the December-to-January boundary isn't a special case.
 */
async function assertNoLockedRunFrom(from: string | null): Promise<void> {
  const q = db('payroll_runs').where('status', 'locked');
  if (from) {
    const [y, m] = from.split('-').map(Number);
    q.whereRaw('(year * 12 + month) >= ?', [y * 12 + m]);
  }
  const locked = await q.orderBy(['year', 'month']).first();
  if (locked) {
    throw new ValidationError(
      `Payroll for ${locked.month}/${locked.year} is locked, and this change would reach it — ` +
      `unlock that month first, or use a later effective date.`,
    );
  }
}

export interface ShiftAssignmentFilters {
  search?: string;
  property?: string;
  unassigned?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Shared WHERE builder for the assignment list, its count and its CSV export, so all three
 * select the same people. `unassigned` ("no shift as of today") is pushed into SQL as a
 * whereNotExists rather than filtered in memory, so it composes correctly with offset paging —
 * an in-memory post-filter would make page counts wrong.
 */
function applyAssignmentFilters(q: any, filters: ShiftAssignmentFilters, today: string) {
  q.where('e.is_active', true);
  if (filters.search) {
    const term = `%${filters.search.trim()}%`;
    q.where((w: any) => w
      .where('e.first_name', 'ilike', term)
      .orWhere('e.last_name', 'ilike', term)
      .orWhere('e.employee_code', 'ilike', term));
  }
  if (filters.property) q.where('e.branch_name', filters.property);
  if (filters.unassigned) {
    // "In force today" means started AND not ended. Without the second half, somebody whose
    // assignment ran out last week counts as assigned and is missing from the one list HR uses
    // to find people who need a shift — while their own screen correctly says they have none.
    // End dates only became possible with migration 031, so this had no teeth until now.
    q.whereNotExists(function (this: any) {
      this.select(db.raw('1')).from('employee_shift_assignments as a2')
        .whereRaw('a2.employee_id = e.id')
        .where('a2.effective_from', '<=', today)
        .where((w: any) => w.whereNull('a2.effective_to').orWhere('a2.effective_to', '>=', today));
    });
  }
  return q;
}

/** Resolve each employee's current/upcoming shift from one assignments query. */
async function resolveAssignmentRows(employees: any[], today: string) {
  if (!employees.length) return [];
  const assignments = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', employees.map((e: any) => e.id))
    .select('a.id as assignment_id', 'a.employee_id', 'a.effective_from', 'a.effective_to',
      'st.id as shift_type_id', 'st.name as shift_name', 'st.start_time', 'st.end_time',
      'st.ends_next_day', 'st.weekly_off_days')
    // Ascending within each employee — pickAssignmentFor requires it.
    .orderBy(['a.employee_id', 'a.effective_from']);

  const byEmp = new Map<number, any[]>();
  for (const a of assignments) {
    if (!byEmp.has(a.employee_id)) byEmp.set(a.employee_id, []);
    byEmp.get(a.employee_id)!.push(a);
  }

  return employees.map((e: any) => {
    const list = byEmp.get(e.id) ?? [];
    // THE SAME RULE the employee's own screen uses. This used to be
    // `list.filter(a => a.effective_from <= today).pop()`, which ignored the end date entirely —
    // so an assignment that had run out still showed here as the employee's current shift while
    // their My Shift card correctly said they had none. Two rules over one table, opposite
    // answers, and HR with no way to see why the employee was complaining.
    const current = pickAssignmentFor(list, today, today);
    const upcoming = list.find((a: any) => isoDate(a.effective_from) > today) ?? null;
    return {
      ...e,
      current: current ? { ...current, weekly_off_days: mapShiftType(current).weekly_off_days } : null,
      upcoming: upcoming ? { ...upcoming, weekly_off_days: mapShiftType(upcoming).weekly_off_days } : null,
      history_count: list.length,
    };
  });
}

const ASSIGNMENT_SELECT = ['e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
  'e.branch_name', 'e.dept_name', 'jt.title as designation'];

/**
 * Every employee with the shift they are on today, for the assignment screen.
 *
 * Returns a plain array when no `page` is given (unchanged for any existing caller), or
 * `{ data, total, page, pageSize, totalPages }` when paginated — mirroring listEmployees.
 */
export async function listShiftAssignments(filters: ShiftAssignmentFilters = {}) {
  const today = todayIso();
  const base = () => db('employees as e').leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id');

  if (!filters.page) {
    const employees = await applyAssignmentFilters(base(), filters, today)
      .select(...ASSIGNMENT_SELECT).orderBy(['e.first_name', 'e.last_name']);
    return resolveAssignmentRows(employees, today);
  }

  const page = Math.max(1, filters.page);
  const pageSize = Math.min(Math.max(1, filters.pageSize || 10), 100);
  const offset = (page - 1) * pageSize;

  const countRow = await applyAssignmentFilters(db('employees as e'), filters, today)
    .count('e.id as total').first();
  const total = Number((countRow as any)?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const employees = await applyAssignmentFilters(base(), filters, today)
    .select(...ASSIGNMENT_SELECT).orderBy(['e.first_name', 'e.last_name'])
    .limit(pageSize).offset(offset);

  return { data: await resolveAssignmentRows(employees, today), total, page, pageSize, totalPages };
}

/** Every shift this employee has been on, newest first. */
export async function getEmployeeShiftHistory(employeeId: number) {
  return db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .leftJoin('users as u', 'u.id', 'a.assigned_by')
    .where('a.employee_id', employeeId)
    .select('a.id', 'a.effective_from', 'a.effective_to', 'a.created_at', 'st.id as shift_type_id',
      'st.name as shift_name', 'st.start_time', 'st.end_time', 'st.ends_next_day',
      'u.email as assigned_by_email')
    .orderBy('a.effective_from', 'desc');
}

/**
 * Put an employee on a shift from a date. Re-assigning the same start date replaces that
 * entry rather than stacking a second one.
 */
export async function assignShift(
  input: { employee_id: number; shift_type_id: number; effective_from?: string; effective_to?: string | null },
  userId?: number | null,
) {
  const employeeId = Number(input.employee_id);
  const shiftTypeId = Number(input.shift_type_id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw new ValidationError('Select an employee');
  if (!Number.isInteger(shiftTypeId) || shiftTypeId <= 0) throw new ValidationError('Select a shift');

  const employee = await db('employees').where('id', employeeId).first();
  if (!employee) throw new NotFoundError('Employee');
  const shiftType = await db('shift_types').where('id', shiftTypeId).first();
  if (!shiftType) throw new NotFoundError('Shift type');
  if (!shiftType.is_active) throw new ValidationError('That shift is inactive — reactivate it before assigning anyone to it');

  const effectiveFrom = isoDate(input.effective_from) || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new ValidationError('Effective date must be a date like 2026-08-01');

  // Don't let a mapping start before the shift's own rules do — the shift wouldn't apply.
  if (shiftType.effective_from && effectiveFrom < isoDate(shiftType.effective_from)) {
    throw new ValidationError(`${shiftType.name} only takes effect from ${isoDate(shiftType.effective_from)}`);
  }

  // Optional, and blank means open-ended — the shift runs until something replaces it, which is
  // how every assignment behaved before this existed. Inclusive: an assignment ending on the 14th
  // still governs the 14th.
  const rawTo = input.effective_to == null ? '' : String(input.effective_to).trim();
  const effectiveTo = rawTo ? isoDate(rawTo) : null;
  if (rawTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo || '')) {
    throw new ValidationError('End date must be a date like 2026-08-31');
  }
  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new ValidationError('The end date cannot be before the start date');
  }

  // An assignment applies from its date FORWARD — indefinitely when open-ended — so checking only
  // the month it starts in would let a backdated assignment silently rewrite every locked month
  // after it. (The common case: someone joined before payroll runs began, so their joining month
  // has no run row at all, and a "harmless" backdate reaches straight through the paid months.)
  //
  // The guard still runs from the START date even when an end date is given. Ending an assignment
  // does not narrow what it can disturb — it changes which shift governs the days AFTER the end
  // too, by handing them back to whatever comes next, so every month from the start onwards is
  // still in play.
  await assertNoLockedRunFrom(effectiveFrom);

  const existing = await db('employee_shift_assignments')
    .where({ employee_id: employeeId, effective_from: effectiveFrom }).first();
  if (existing) {
    // effective_to is written unconditionally, including back to null: re-saving the same start
    // date is how an admin CLEARS an end date, and treating a blank field as "leave it alone"
    // would make the end date impossible to remove.
    await db('employee_shift_assignments').where('id', existing.id).update({
      shift_type_id: shiftTypeId,
      effective_to: effectiveTo,
      assigned_by: userId ?? null,
      updated_at: db.fn.now(),
    });
    return getEmployeeShiftHistory(employeeId);
  }

  await db('employee_shift_assignments').insert({
    employee_id: employeeId,
    shift_type_id: shiftTypeId,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    assigned_by: userId ?? null,
  });
  return getEmployeeShiftHistory(employeeId);
}

// ─── CSV export / import of assignments ───

/**
 * The assignment list as CSV — one row per active employee with the shift they are on today,
 * honouring the screen's filters so the file matches what's shown. Unassigned employees export
 * with blank shift/date columns, so the file doubles as a fill-in template for the importer.
 *
 * The columns the importer reads are `employee_code`, `shift_name` and `effective_from`; the
 * rest (name, property, off days) are there for a human to read.
 */
export async function exportShiftAssignmentsCsv(filters: ShiftAssignmentFilters): Promise<string> {
  // Reuse the list (unpaginated) so export selects exactly the same people as the screen.
  const rows = await listShiftAssignments({ ...filters, page: undefined, pageSize: undefined }) as any[];

  const header = ['employee_code', 'employee_name', 'property', 'shift_name', 'effective_from', 'off_days'];
  return buildCsv(header, rows.map((r) => [
    r.employee_code,
    `${r.first_name} ${r.last_name}`.trim(),
    r.branch_name,
    r.current?.shift_name ?? '',
    r.current ? isoDate(r.current.effective_from) : '',
    r.current ? offDaySummary(r.current.weekly_off_days) : '',
  ]));
}

const SHIFT_HEADER_ALIASES: Record<string, string> = {
  employee_code: 'employee_code', emp_code: 'employee_code', code: 'employee_code',
  shift_name: 'shift_name', shift: 'shift_name',
  effective_from: 'effective_from', from: 'effective_from', effective_date: 'effective_from', date: 'effective_from',
};

/**
 * Bulk-assign employees to shifts from a CSV of employee_code, shift_name, effective_from.
 *
 * Every row is written through `assignShift`, never by a raw insert — so the locked-payroll
 * guard, the active-shift check, the shift's own effective-date rule and the
 * (employee_id, effective_from) upsert all apply. A row that would reach a locked month, or is
 * otherwise refused, is skipped and reported; the table is never touched directly.
 */
export async function bulkUploadShiftAssignments(csvContent: string, userId?: number | null) {
  const grid = parseCsv(csvContent);
  if (grid.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row'), { status: 400 });

  const header = grid[0].map((h) => {
    const key = h.trim().toLowerCase().replace(/\s+/g, '_');
    return SHIFT_HEADER_ALIASES[key] || key;
  });
  const col = (name: string) => header.indexOf(name);
  const codeIdx = col('employee_code'), shiftIdx = col('shift_name'), fromIdx = col('effective_from');
  if (codeIdx === -1) throw Object.assign(new Error('CSV must have an "Employee Code" column'), { status: 400 });
  if (shiftIdx === -1) throw Object.assign(new Error('CSV must have a "Shift" column'), { status: 400 });
  if (fromIdx === -1) throw Object.assign(new Error('CSV must have an "Effective From" column'), { status: 400 });

  // Case-insensitive shift lookup by name (names are unique lower-cased). Only active shifts can
  // be assigned; an inactive one resolves to no id and the row is reported as unknown.
  const shiftRows = await db('shift_types').where('is_active', true).select('id', 'name');
  const shiftByName = new Map<string, number>(shiftRows.map((s: any) => [String(s.name).trim().toLowerCase(), s.id]));

  const results = { total: 0, created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const employee_code = (cells[codeIdx] ?? '').trim();
    const shift_name = (cells[shiftIdx] ?? '').trim();
    const effective_from = (cells[fromIdx] ?? '').trim();
    results.total++;
    const rowNo = i + 1;

    if (!employee_code || !shift_name || !effective_from) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: employee code, shift and effective-from date are all required`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effective_from)) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: "${effective_from}" is not a date like 2026-08-01`);
      continue;
    }

    const employee = await db('employees').where('employee_code', employee_code).first();
    if (!employee) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: no employee with code "${employee_code}"`);
      continue;
    }
    const shiftTypeId = shiftByName.get(shift_name.toLowerCase());
    if (!shiftTypeId) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: no active shift named "${shift_name}"`);
      continue;
    }

    // Did this exact (employee, date) row already exist? — so we can report created vs updated,
    // since assignShift upserts and doesn't tell us which happened.
    const existing = await db('employee_shift_assignments')
      .where({ employee_id: employee.id, effective_from }).first();

    try {
      // The one safe write path — carries the locked-month guard and every other rule.
      await assignShift({ employee_id: employee.id, shift_type_id: shiftTypeId, effective_from }, userId);
      if (existing) results.updated++; else results.created++;
    } catch (err: any) {
      results.skipped++;
      results.errors.push(`Row ${rowNo} (${employee_code}): ${err.message || 'could not assign'}`);
    }
  }

  return results;
}

/** Remove one dated assignment. The employee keeps whatever earlier one remains. */
export async function removeShiftAssignment(id: number) {
  const row = await db('employee_shift_assignments').where('id', id).first();
  if (!row) throw new NotFoundError('Shift assignment');

  // Deleting shifts the dates this assignment covered onto whichever one remains. If it is the
  // employee's earliest, the fallback moves too and dates before it are affected as well — so
  // that case has to be clear of every locked run, not just the ones after its own date.
  const earliest = await db('employee_shift_assignments')
    .where('employee_id', row.employee_id).orderBy('effective_from').first();
  const from = earliest && earliest.id === row.id ? null : isoDate(row.effective_from);
  await assertNoLockedRunFrom(from);

  await db('employee_shift_assignments').where('id', id).del();
  return { id, employee_id: row.employee_id };
}

const hhmm = (t: any) => (t ? String(t).slice(0, 5) : null);

/**
 * The one description of "the shift I am on today", shared by both endpoints that answer that
 * question — `/shifts/me` (the dashboard card) and `/shifts/me/shift` (the My Shift page).
 *
 * It exists because those two used to describe the same thing differently: one returned the shift
 * bare, the other wrapped it in `current`, and the two spelled the times differently as well.
 * Both replies are cached in the browser under a key derived from the question, so a screen that
 * received the other one's answer found no `current` in it and told the employee they had no
 * shift — while the database held two assignments and the server resolved them correctly.
 *
 * One builder, one shape. A screen handed the wrong reply now still finds the shift in it.
 */
export function currentShiftView(shift: any) {
  if (!shift) return null;
  return {
    shift_type_id: shift.id,
    name: shift.name,
    start_time: hhmm(shift.start_time),
    end_time: hhmm(shift.end_time),
    ends_next_day: !!shift.ends_next_day,
    office_hour_time: hhmm(shift.office_hour_time),
    weekly_off_days: shift.weekly_off_days,
    effective_from: String(shift.effective_from ?? '').slice(0, 10) || null,
  };
}

/**
 * The dashboard card's shift. Same envelope as getMyShiftOverview — `current` is null when the
 * employee genuinely has none, which is a different thing from the request having failed.
 */
export async function getMyShift(employeeId: number | null | undefined) {
  if (!employeeId) return { current: null };
  return { current: currentShiftView(await resolveShiftForEmployee(employeeId, todayIso())) };
}

