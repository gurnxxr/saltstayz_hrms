import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { notifyEmployee } from './notification.service';

// ─── Shift Types (organization-wide) ───

export const ROSTER_COLORS = ['Blue', 'Cyan', 'Fuchsia', 'Green', 'Lime', 'Orange', 'Pink', 'Red', 'Violet', 'Yellow'] as const;
const DETERMINE_OPTS = ['alternating', 'log_type'];
const WORKING_HOURS_OPTS = ['first_last', 'every_valid'];
const SHIFT_TYPE_BOOL_COLS = [
  'is_active', 'enable_auto_attendance', 'mark_auto_attendance_on_holidays',
  'auto_update_last_sync', 'enable_late_entry_marking', 'enable_early_exit_marking', 'allow_overtime',
];

const toBool = (v: any) => v === true || v === 1 || v === '1' || v === 'true';

// SQLite stores booleans as 0/1 — hand the client real booleans for form hydration.
function mapShiftType(row: any) {
  if (!row) return row;
  const out: any = { ...row };
  for (const c of SHIFT_TYPE_BOOL_COLS) {
    if (c in out && out[c] !== null && out[c] !== undefined) out[c] = !!out[c];
  }
  return out;
}

// Pull only the config columns present in `data`, coercing/validating each. Used by
// both create (spread over the row) and update (partial set), so keys absent from the
// payload keep their existing/default value.
function collectShiftTypeConfig(data: any): Record<string, any> {
  const out: Record<string, any> = {};
  const setBool = (k: string) => { if (k in data) out[k] = toBool(data[k]); };
  const setInt = (k: string) => { if (k in data) { const n = Math.trunc(Number(data[k])); out[k] = Number.isFinite(n) && n >= 0 ? n : 0; } };
  const setNum = (k: string) => { if (k in data) { const n = Number(data[k]); out[k] = Number.isFinite(n) && n >= 0 ? n : 0; } };

  setBool('enable_auto_attendance');
  setBool('mark_auto_attendance_on_holidays');
  setBool('auto_update_last_sync');
  setBool('enable_late_entry_marking');
  setBool('enable_early_exit_marking');
  setBool('allow_overtime');

  setInt('begin_checkin_before_mins');
  setInt('allow_checkout_after_mins');
  setInt('late_entry_grace_period');
  setInt('early_exit_grace_period');

  setNum('half_day_threshold');
  setNum('absent_threshold');

  if ('roster_color' in data) out.roster_color = (ROSTER_COLORS as readonly string[]).includes(data.roster_color) ? data.roster_color : 'Blue';
  if ('determine_checkin_checkout' in data) out.determine_checkin_checkout = DETERMINE_OPTS.includes(data.determine_checkin_checkout) ? data.determine_checkin_checkout : 'alternating';
  if ('working_hours_calculation' in data) out.working_hours_calculation = WORKING_HOURS_OPTS.includes(data.working_hours_calculation) ? data.working_hours_calculation : 'first_last';
  if ('holiday_region_id' in data) out.holiday_region_id = data.holiday_region_id ? Number(data.holiday_region_id) : null;
  if ('overtime_type' in data) out.overtime_type = data.overtime_type ? String(data.overtime_type).trim() : null;
  if ('process_attendance_after' in data) out.process_attendance_after = data.process_attendance_after || null;
  if ('last_sync_of_checkin' in data) out.last_sync_of_checkin = data.last_sync_of_checkin || null;

  return out;
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

// Holiday lists are modelled as regions (each region groups a property's holidays).
export async function listHolidayLists() {
  return db('regions').select('id', 'name').orderBy('name');
}

export async function createShiftType(data: any) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Shift name is required');
  if (!data.start_time) throw new ValidationError('Start time is required');
  if (!data.end_time) throw new ValidationError('End time is required');
  const dup = await db('shift_types').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A shift type with this name already exists');

  const config = collectShiftTypeConfig(data);
  if (config.allow_overtime && !config.overtime_type) {
    throw new ValidationError('Overtime Type is required when overtime is allowed');
  }

  // property_id is a vestigial NOT NULL column — set it to any existing property.
  const anyProperty = await db('properties').select('id').first();
  const [id] = await db('shift_types').insert({
    name,
    start_time: data.start_time,
    end_time: data.end_time,
    property_id: anyProperty?.id ?? 1,
    ...config,
  });
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
  if ('start_time' in data) set.start_time = data.start_time;
  if ('end_time' in data) set.end_time = data.end_time;
  if ('is_active' in data) set.is_active = toBool(data.is_active);
  Object.assign(set, collectShiftTypeConfig(data));

  const allowOt = 'allow_overtime' in set ? set.allow_overtime : !!existing.allow_overtime;
  const otType = 'overtime_type' in set ? set.overtime_type : existing.overtime_type;
  if (allowOt && !otType) throw new ValidationError('Overtime Type is required when overtime is allowed');

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

  return {
    property_id: propertyId,
    property_name: property.name,
    week_start: weekStart,
    week_end: weekEnd,
    status,
    total_cells: total,
    published_cells: published,
    published_at: publishedAt,
    published_by_name: publishedByName,
    employees: employees.map((e: any) => ({ ...e, cells: cellsByEmp.get(e.id) ?? {} })),
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

