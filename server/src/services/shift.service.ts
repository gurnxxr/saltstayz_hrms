import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { notifyEmployee } from './notification.service';
import { pickAssignmentFor } from './shiftPattern';

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
  return raw.map((entry: any) => {
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
const todayIso = () => new Date().toISOString().slice(0, 10);

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
    .select('st.*', 'a.effective_from', 'a.id as assignment_id')
    .orderBy('a.effective_from');
  const chosen = pickAssignmentFor(rows as any[], isoDate(date) || todayIso(), todayIso());
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

/** Every employee with the shift they are on today, for the assignment screen. */
export async function listShiftAssignments(filters: { search?: string; property?: string; unassigned?: boolean } = {}) {
  const employees = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .modify((q) => {
      if (filters.search) {
        const term = `%${filters.search.trim()}%`;
        q.where((w) => w
          .where('e.first_name', 'ilike', term)
          .orWhere('e.last_name', 'ilike', term)
          .orWhere('e.employee_code', 'ilike', term));
      }
      if (filters.property) q.where('e.branch_name', filters.property);
    })
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name', 'e.dept_name',
      'jt.title as designation')
    .orderBy(['e.first_name', 'e.last_name']);

  // One query for every assignment, then resolve in memory — avoids a lookup per employee.
  const assignments = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', employees.length ? employees.map((e: any) => e.id) : [-1])
    .select('a.id as assignment_id', 'a.employee_id', 'a.effective_from',
      'st.id as shift_type_id', 'st.name as shift_name', 'st.start_time', 'st.end_time',
      'st.ends_next_day', 'st.weekly_off_days')
    .orderBy(['a.employee_id', 'a.effective_from']);

  const today = todayIso();
  const byEmp = new Map<number, any[]>();
  for (const a of assignments) {
    if (!byEmp.has(a.employee_id)) byEmp.set(a.employee_id, []);
    byEmp.get(a.employee_id)!.push(a);
  }

  const rows = employees.map((e: any) => {
    const list = byEmp.get(e.id) ?? [];
    const current = list.filter((a: any) => isoDate(a.effective_from) <= today).pop() ?? null;
    const upcoming = list.find((a: any) => isoDate(a.effective_from) > today) ?? null;
    return {
      ...e,
      current: current ? { ...current, weekly_off_days: mapShiftType(current).weekly_off_days } : null,
      upcoming: upcoming ? { ...upcoming, weekly_off_days: mapShiftType(upcoming).weekly_off_days } : null,
      history_count: list.length,
    };
  });

  return filters.unassigned ? rows.filter((r: any) => !r.current) : rows;
}

/** Every shift this employee has been on, newest first. */
export async function getEmployeeShiftHistory(employeeId: number) {
  return db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .leftJoin('users as u', 'u.id', 'a.assigned_by')
    .where('a.employee_id', employeeId)
    .select('a.id', 'a.effective_from', 'a.created_at', 'st.id as shift_type_id', 'st.name as shift_name',
      'st.start_time', 'st.end_time', 'st.ends_next_day', 'u.email as assigned_by_email')
    .orderBy('a.effective_from', 'desc');
}

/**
 * Put an employee on a shift from a date. Re-assigning the same start date replaces that
 * entry rather than stacking a second one.
 */
export async function assignShift(
  input: { employee_id: number; shift_type_id: number; effective_from?: string },
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

  // An assignment applies from its date FORWARD, indefinitely — so checking only the month it
  // starts in would let a backdated assignment silently rewrite every locked month after it.
  // (The common case: someone joined before payroll runs began, so their joining month has no
  // run row at all, and a "harmless" backdate reaches straight through the paid months.)
  await assertNoLockedRunFrom(effectiveFrom);

  const existing = await db('employee_shift_assignments')
    .where({ employee_id: employeeId, effective_from: effectiveFrom }).first();
  if (existing) {
    await db('employee_shift_assignments').where('id', existing.id)
      .update({ shift_type_id: shiftTypeId, assigned_by: userId ?? null, updated_at: db.fn.now() });
    return getEmployeeShiftHistory(employeeId);
  }

  await db('employee_shift_assignments').insert({
    employee_id: employeeId,
    shift_type_id: shiftTypeId,
    effective_from: effectiveFrom,
    assigned_by: userId ?? null,
  });
  return getEmployeeShiftHistory(employeeId);
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

export async function getMyShift(employeeId: number | null | undefined) {
  if (!employeeId) return null;
  const shift = await resolveShiftForEmployee(employeeId, todayIso());
  if (!shift) return null;
  return {
    shift_type_id: shift.id,
    name: shift.name,
    start_time: shift.start_time,
    end_time: shift.end_time,
    ends_next_day: shift.ends_next_day,
    weekly_off_days: shift.weekly_off_days,
    office_hour_time: shift.office_hour_time,
  };
}

