import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { notifyEmployee } from './notification.service';

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
  const assigned = await db('employee_shift_assignments').where('shift_type_id', id).count('* as c').first();
  const rostered = await db('shift_rosters').where('shift_type_id', id).count('* as c').first();
  if (Number((assigned as any)?.c || 0) + Number((rostered as any)?.c || 0) > 0) {
    throw new ValidationError('Cannot delete: this shift type is assigned to employees or used in the roster');
  }
  const scheduled = await db('shift_schedules').where('shift_type_id', id).count('* as c').first();
  if (Number((scheduled as any)?.c || 0) > 0) {
    throw new ValidationError('Cannot delete: this shift type is used by a shift schedule');
  }
  await db('shift_types').where('id', id).del();
  return { id };
}

// ─── Shift Roster ───

/**
 * The weekly roster for a property as a grid: each property employee with a
 * `cells` map (date → shift or weekly-off), plus the week's publish status.
 */
export async function getWeeklyRoster(propertyId: number, weekStart: string, weekEnd: string) {
  const property = await db('properties').where('id', propertyId).first();
  if (!property) throw new NotFoundError('Property');

  const employees = await getPropertyEmployees(propertyId);

  const rows = await db('shift_rosters as r')
    .leftJoin('shift_types as st', 'st.id', 'r.shift_type_id')
    .leftJoin('users as pub', 'pub.id', 'r.published_by')
    .leftJoin('employees as pube', 'pube.id', 'pub.employee_id')
    .where('r.property_id', propertyId)
    .whereBetween('r.date', [weekStart, weekEnd])
    .select(
      'r.id', 'r.employee_id', 'r.date', 'r.shift_type_id', 'r.day_type', 'r.is_published', 'r.published_at',
      'st.name as shift_name', 'st.start_time', 'st.end_time',
      db.raw("trim(coalesce(pube.first_name,'') || ' ' || coalesce(pube.last_name,'')) as published_by_name"),
    );

  const cellsByEmp = new Map<number, Record<string, any>>();
  let total = 0, published = 0;
  let publishedAt: string | null = null, publishedByName: string | null = null;
  for (const r of rows) {
    const date = String(r.date).slice(0, 10);
    const map = cellsByEmp.get(r.employee_id) ?? {};
    map[date] = {
      id: r.id,
      day_type: r.day_type,
      shift_type_id: r.shift_type_id,
      shift_name: r.shift_name,
      start_time: r.start_time ? String(r.start_time).slice(0, 5) : null,
      end_time: r.end_time ? String(r.end_time).slice(0, 5) : null,
      is_published: !!r.is_published,
    };
    cellsByEmp.set(r.employee_id, map);
    total += 1;
    if (r.is_published) {
      published += 1;
      if (!publishedAt) { publishedAt = r.published_at; publishedByName = r.published_by_name || null; }
    }
  }

  const status = total === 0 ? 'empty' : published === total ? 'published' : published === 0 ? 'draft' : 'partial';

  // Approved leave overlapping this week, per employee. A day an employee is on
  // leave can't be rostered — the client shows a locked "On Leave" tag there
  // instead of the shift dropdown. One batched query for all property staff;
  // the covered dates are found with the same string-range test payroll uses.
  const leavesByEmp = new Map<number, Record<string, string>>();
  const empIds = employees.map((e: any) => e.id);
  if (empIds.length) {
    const leaveRows = await db('leave_requests as lr')
      .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .whereIn('lr.employee_id', empIds)
      .where('lr.status', 'approved')
      .where('lr.start_date', '<=', weekEnd)
      .where('lr.end_date', '>=', weekStart)
      .select('lr.employee_id', 'lr.start_date', 'lr.end_date', 'lt.name as leave_type');
    const weekDates: string[] = [];
    for (let d = weekStart; d <= weekEnd; d = addDaysStr(d, 1)) weekDates.push(d);
    for (const lr of leaveRows) {
      const s = String(lr.start_date).slice(0, 10);
      const e = String(lr.end_date).slice(0, 10);
      const map = leavesByEmp.get(lr.employee_id) ?? {};
      for (const date of weekDates) if (s <= date && e >= date) map[date] = lr.leave_type;
      leavesByEmp.set(lr.employee_id, map);
    }
  }

  // Department filter options for the roster. The official catalog (departments
  // table) unioned with any department names this property's active staff actually
  // carry — dept_name is free text, so some staff sit in departments the catalog
  // doesn't list, and a freshly-created catalog department has nobody in it yet.
  // Taking both means a department created in Admin shows up here immediately, and
  // off-catalog values already on staff never disappear.
  const catalog: string[] = await db('departments').orderBy('name').pluck('name');
  const deptSet = new Set<string>();
  for (const name of catalog) { const n = (name ?? '').trim(); if (n) deptSet.add(n); }
  for (const e of employees) { const d = (e.dept_name ?? '').trim(); if (d) deptSet.add(d); }
  const departments = [...deptSet].sort((a, b) => a.localeCompare(b));

  return {
    property_id: propertyId,
    property_name: property.name,
    week_start: weekStart,
    week_end: weekEnd,
    status,
    total_cells: total,
    published_cells: published,
    departments,
    published_at: publishedAt,
    published_by_name: publishedByName,
    employees: employees.map((e: any) => ({ ...e, cells: cellsByEmp.get(e.id) ?? {}, leaves: leavesByEmp.get(e.id) ?? {} })),
  };
}

export async function getPropertyEmployees(propertyId?: number) {
  // Employees relate to a property by branch_name (text) = properties.name.
  if (!propertyId) return [];
  const property = await db('properties').where('id', propertyId).first();
  if (!property) return [];
  return db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .where('e.branch_name', property.name)
    // dept_name drives the roster's Department filter. It is free text on the employee,
    // not an FK, so the filter's options are derived from these rows rather than from
    // the departments table — some employees sit in departments that table doesn't have.
    .select('e.id', 'e.first_name', 'e.last_name', 'e.employee_code', 'e.dept_name', 'jt.title as designation')
    .orderBy('e.first_name');
}

// ── Roster editing (draft) + publish lifecycle ──

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Block roster edits/publish for a week whose payroll month is already locked. */
async function assertWeekEditable(weekStart: string, weekEnd: string) {
  const months = new Set<string>();
  for (let d = weekStart; d <= weekEnd; d = addDaysStr(d, 1)) months.add(d.slice(0, 7));
  for (const ym of months) {
    const [year, month] = ym.split('-').map(Number);
    const run = await db('payroll_runs').where({ month, year }).first();
    if (run?.status === 'locked') {
      throw new ValidationError(`Payroll for ${ym} is locked; unlock it before changing that week's roster.`);
    }
  }
}

/** A roster week must be exactly 7 days and start on a Monday. */
function assertWeekShape(weekStart: string, weekEnd: string) {
  if (!ISO_DATE.test(weekStart) || !ISO_DATE.test(weekEnd)) throw new ValidationError('Invalid week');
  if (addDaysStr(weekStart, 6) !== weekEnd) throw new ValidationError('A roster week must be exactly 7 days');
  if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) throw new ValidationError('A roster week must start on Monday');
}

/** Block editing a range that already has published rows — unpublish it first. */
async function assertNotPublished(propertyId: number, from: string, to: string) {
  const pub = await db('shift_rosters')
    .where('property_id', propertyId).where('is_published', true)
    .whereBetween('date', [from, to]).first();
  if (pub) throw new ValidationError('This week is published — unpublish it before editing.');
}

/** Active employees who belong to a property (branch_name = property name). */
async function propertyEmployeeIds(propertyId: number): Promise<Set<number>> {
  const property = await db('properties').where('id', propertyId).first();
  if (!property) throw new NotFoundError('Property');
  const ids = await db('employees').where({ branch_name: property.name, is_active: true }).pluck('id');
  return new Set<number>(ids as number[]);
}

export interface RosterCellInput {
  employee_id: number;
  date: string;
  day_type: 'working' | 'weekly_off' | 'clear';
  shift_type_id?: number | null;
}

/** Upsert/clear a batch of roster cells as DRAFT (unpublished), atomically. */
export async function saveRosterCells(propertyId: number, cells: RosterCellInput[], userId: number) {
  if (!Array.isArray(cells) || cells.length === 0) throw new ValidationError('No cells to save');
  const empIds = await propertyEmployeeIds(propertyId);

  const shiftIds = new Set<number>();
  for (const c of cells) {
    if (!ISO_DATE.test(String(c.date || ''))) throw new ValidationError(`Invalid date: ${c.date}`);
    if (!empIds.has(Number(c.employee_id))) throw new ValidationError('An employee does not belong to this property');
    if (c.day_type === 'working') {
      if (!c.shift_type_id) throw new ValidationError('A working cell needs a shift');
      shiftIds.add(Number(c.shift_type_id));
    } else if (c.day_type !== 'weekly_off' && c.day_type !== 'clear') {
      throw new ValidationError(`Invalid day type: ${c.day_type}`);
    }
  }
  if (shiftIds.size) {
    const found = await db('shift_types').whereIn('id', [...shiftIds]).pluck('id');
    if (found.length !== shiftIds.size) throw new ValidationError('Unknown shift type');
  }

  const sorted = cells.map((c) => c.date).sort();
  await assertWeekEditable(sorted[0], sorted[sorted.length - 1]);
  await assertNotPublished(propertyId, sorted[0], sorted[sorted.length - 1]);

  // A day an employee has approved leave for can't be rostered into a shift or a
  // weekly-off (the grid locks those cells; this is the server-side safety net).
  // Clearing a cell is still allowed, so a stale assignment can be removed.
  const guardCells = cells.filter((c) => c.day_type === 'working' || c.day_type === 'weekly_off');
  if (guardCells.length) {
    const gEmpIds = [...new Set(guardCells.map((c) => Number(c.employee_id)))];
    const gDates = guardCells.map((c) => c.date).sort();
    const leaveRows = await db('leave_requests')
      .whereIn('employee_id', gEmpIds)
      .where('status', 'approved')
      .where('start_date', '<=', gDates[gDates.length - 1])
      .where('end_date', '>=', gDates[0])
      .select('employee_id', 'start_date', 'end_date');
    const onLeave = (empId: number, date: string) =>
      leaveRows.some((l) => l.employee_id === empId
        && String(l.start_date).slice(0, 10) <= date && String(l.end_date).slice(0, 10) >= date);
    for (const c of guardCells) {
      if (onLeave(Number(c.employee_id), c.date)) throw new ValidationError('Cannot schedule a shift on an approved leave day.');
    }
  }

  let saved = 0, cleared = 0;
  await db.transaction(async (trx) => {
    for (const c of cells) {
      const key = { employee_id: Number(c.employee_id), date: c.date };
      if (c.day_type === 'clear') {
        cleared += await trx('shift_rosters').where(key).del();
        continue;
      }
      const payload = {
        shift_type_id: c.day_type === 'working' ? Number(c.shift_type_id) : null,
        day_type: c.day_type,
        property_id: propertyId,
        assigned_by: userId,
        is_published: false,
        published_at: null,
        published_by: null,
        updated_at: trx.fn.now(),
      };
      const existing = await trx('shift_rosters').where(key).first();
      if (existing) await trx('shift_rosters').where('id', existing.id).update(payload);
      else await trx('shift_rosters').insert({ ...key, ...payload });
      saved += 1;
    }
  });
  return { saved, cleared };
}

/** Publish a property's week: stamp its rows published + notify the rostered staff. */
export async function publishRoster(propertyId: number, weekStart: string, weekEnd: string, userId: number) {
  assertWeekShape(weekStart, weekEnd);
  await assertWeekEditable(weekStart, weekEnd);

  // Publish only rows for the property's CURRENT employees, so a row left behind by
  // someone who has since transferred away is not published into their new pay.
  const currentEmp = [...await propertyEmployeeIds(propertyId)];
  const rows = await db('shift_rosters')
    .where('property_id', propertyId).whereBetween('date', [weekStart, weekEnd])
    .whereIn('employee_id', currentEmp)
    .select('employee_id');
  if (rows.length === 0) throw new ValidationError('Nothing to publish — add shifts to the week first');

  const published = await db('shift_rosters')
    .where('property_id', propertyId).whereBetween('date', [weekStart, weekEnd])
    .whereIn('employee_id', currentEmp)
    .update({ is_published: true, published_at: db.fn.now(), published_by: userId, updated_at: db.fn.now() });

  const empIds = [...new Set(rows.map((r: any) => r.employee_id))];
  for (const empId of empIds) {
    await notifyEmployee(empId, {
      type: 'roster_published',
      title: 'Your shifts are published',
      message: `Your roster for the week of ${weekStart} has been published.`,
      link: '/shifts/roster',
    });
  }
  return { published, notified: empIds.length };
}

/** Revert a property's week to draft so it can be edited again. */
export async function unpublishRoster(propertyId: number, weekStart: string, weekEnd: string) {
  assertWeekShape(weekStart, weekEnd);
  await assertWeekEditable(weekStart, weekEnd);
  const unpublished = await db('shift_rosters')
    .where('property_id', propertyId).whereBetween('date', [weekStart, weekEnd])
    .update({ is_published: false, published_at: null, published_by: null, updated_at: db.fn.now() });
  return { unpublished };
}

/**
 * Copy the previous week's cells into this week as a draft (managers rarely start
 * blank). Pass `employeeIds` to copy only those employees' shifts; omit to copy the
 * whole property.
 */
export async function copyPreviousWeek(
  propertyId: number, weekStart: string, weekEnd: string, userId: number, employeeIds?: number[],
) {
  assertWeekShape(weekStart, weekEnd);
  await assertWeekEditable(weekStart, weekEnd);
  await assertNotPublished(propertyId, weekStart, weekEnd);
  const empIds = await propertyEmployeeIds(propertyId);

  // Optional per-employee scope — each must belong to this property.
  let scope: number[] | null = null;
  if (employeeIds && employeeIds.length) {
    for (const id of employeeIds) {
      if (!empIds.has(Number(id))) throw new ValidationError('An employee does not belong to this property');
    }
    scope = [...new Set(employeeIds.map(Number))];
  }

  let prevQuery = db('shift_rosters')
    .where('property_id', propertyId)
    .whereBetween('date', [addDaysStr(weekStart, -7), addDaysStr(weekEnd, -7)]);
  if (scope) prevQuery = prevQuery.whereIn('employee_id', scope);
  const prev = await prevQuery;
  if (prev.length === 0) {
    throw new ValidationError(scope
      ? 'The selected employee has no roster in the previous week to copy'
      : 'The previous week has no roster to copy');
  }

  let copied = 0;
  await db.transaction(async (trx) => {
    for (const r of prev) {
      if (!empIds.has(r.employee_id)) continue; // employee no longer at this property
      const date = addDaysStr(String(r.date).slice(0, 10), 7);
      const key = { employee_id: r.employee_id, date };
      const payload = {
        shift_type_id: r.shift_type_id, day_type: r.day_type,
        property_id: propertyId, assigned_by: userId,
        is_published: false, published_at: null, published_by: null, updated_at: trx.fn.now(),
      };
      const existing = await trx('shift_rosters').where(key).first();
      if (existing) await trx('shift_rosters').where('id', existing.id).update(payload);
      else await trx('shift_rosters').insert({ ...key, ...payload });
      copied += 1;
    }
  });
  return { copied };
}

// ─── Employee self-service: my current shift (dashboard card) ───

export async function getMyShift(employeeId: number | null | undefined) {
  if (!employeeId) return null;
  const row = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('st.id as shift_type_id', 'st.name', 'st.start_time', 'st.end_time')
    .first();
  return row ?? null;
}

