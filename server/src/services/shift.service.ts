import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

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

// ─── Shift Schedules (recurring pattern: shift type × weekdays × frequency) ───

// Validate + normalise the child weekday list: integers 0–6, de-duplicated, at least one.
function normalizeDays(days: any): number[] {
  if (!Array.isArray(days)) throw new ValidationError('Add at least one weekday under Repeat On Days');
  const set = new Set<number>();
  for (const d of days) {
    const n = Math.trunc(Number(d));
    if (!Number.isFinite(n) || n < 0 || n > 6) throw new ValidationError('Invalid weekday');
    set.add(n);
  }
  if (set.size === 0) throw new ValidationError('Add at least one weekday under Repeat On Days');
  return [...set].sort((a, b) => a - b);
}

async function validateScheduleInput(data: any): Promise<{ name: string; shift_type_id: number; frequency_weeks: number; days: number[] }> {
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Name is required');
  const shift_type_id = Number(data.shift_type_id);
  if (!shift_type_id) throw new ValidationError('Shift Type is required');
  const shift = await db('shift_types').where('id', shift_type_id).first();
  if (!shift) throw new NotFoundError('Shift type');
  const frequency_weeks = Math.trunc(Number(data.frequency_weeks));
  if (![1, 2, 3, 4].includes(frequency_weeks)) throw new ValidationError('Frequency must be Every 1–4 Weeks');
  const days = normalizeDays(data.days);
  return { name, shift_type_id, frequency_weeks, days };
}

export async function listShiftSchedules(shiftTypeId?: number) {
  const query = db('shift_schedules as ss')
    .leftJoin('shift_types as st', 'st.id', 'ss.shift_type_id')
    .select('ss.id', 'ss.name', 'ss.shift_type_id', 'ss.frequency_weeks', 'st.name as shift_name')
    .orderBy('ss.name');
  if (shiftTypeId) query.where('ss.shift_type_id', shiftTypeId);
  const schedules = await query;
  for (const s of schedules) {
    const days = await db('shift_schedule_days').where('shift_schedule_id', s.id).orderBy('day_of_week');
    s.days = days.map((d: any) => d.day_of_week);
  }
  return schedules;
}

export async function getShiftSchedule(id: number) {
  const row = await db('shift_schedules as ss')
    .leftJoin('shift_types as st', 'st.id', 'ss.shift_type_id')
    .where('ss.id', id)
    .select('ss.id', 'ss.name', 'ss.shift_type_id', 'ss.frequency_weeks', 'st.name as shift_name')
    .first();
  if (!row) throw new NotFoundError('Shift schedule');
  const days = await db('shift_schedule_days').where('shift_schedule_id', id).orderBy('day_of_week');
  row.days = days.map((d: any) => d.day_of_week);
  return row;
}

export async function createShiftSchedule(data: any) {
  const { name, shift_type_id, frequency_weeks, days } = await validateScheduleInput(data);
  const dup = await db('shift_schedules').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A shift schedule with this name already exists');

  const id = await db.transaction(async (trx) => {
    const [newId] = await trx('shift_schedules').insert({ name, shift_type_id, frequency_weeks });
    await trx('shift_schedule_days').insert(days.map((d) => ({ shift_schedule_id: newId, day_of_week: d })));
    return newId;
  });
  return getShiftSchedule(id);
}

export async function updateShiftSchedule(id: number, data: any) {
  const existing = await db('shift_schedules').where('id', id).first();
  if (!existing) throw new NotFoundError('Shift schedule');
  const { name, shift_type_id, frequency_weeks, days } = await validateScheduleInput(data);
  const dup = await db('shift_schedules').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
  if (dup) throw new ValidationError('A shift schedule with this name already exists');

  await db.transaction(async (trx) => {
    await trx('shift_schedules').where('id', id).update({ name, shift_type_id, frequency_weeks, updated_at: db.fn.now() });
    await trx('shift_schedule_days').where('shift_schedule_id', id).del();
    await trx('shift_schedule_days').insert(days.map((d) => ({ shift_schedule_id: id, day_of_week: d })));
  });
  return getShiftSchedule(id);
}

export async function deleteShiftSchedule(id: number) {
  const row = await db('shift_schedules').where('id', id).first();
  if (!row) throw new NotFoundError('Shift schedule');
  await db('shift_schedules').where('id', id).del(); // days cascade
  return { id };
}

// ─── Shift Locations (master list) ───

export async function listShiftLocations() {
  return db('shift_locations').select('id', 'name').orderBy('name');
}

export async function createShiftLocation(data: { name: string }) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Location name is required');
  const dup = await db('shift_locations').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A shift location with this name already exists');
  const [id] = await db('shift_locations').insert({ name });
  return db('shift_locations').where('id', id).first();
}

export async function updateShiftLocation(id: number, data: { name: string }) {
  const row = await db('shift_locations').where('id', id).first();
  if (!row) throw new NotFoundError('Shift location');
  const name = String(data.name || '').trim();
  if (!name) throw new ValidationError('Location name is required');
  const dup = await db('shift_locations').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
  if (dup) throw new ValidationError('A shift location with this name already exists');
  await db('shift_locations').where('id', id).update({ name, updated_at: db.fn.now() });
  return db('shift_locations').where('id', id).first();
}

export async function deleteShiftLocation(id: number) {
  const row = await db('shift_locations').where('id', id).first();
  if (!row) throw new NotFoundError('Shift location');
  await db('shift_locations').where('id', id).del();
  return { id };
}

// ─── Shift Roster ───

export async function getWeeklyRoster(propertyId: number, weekStart: string, weekEnd: string) {
  const roster = await db('shift_rosters')
    .join('employees', 'employees.id', 'shift_rosters.employee_id')
    .join('shift_types', 'shift_types.id', 'shift_rosters.shift_type_id')
    .where('shift_rosters.property_id', propertyId)
    .whereBetween('shift_rosters.date', [weekStart, weekEnd])
    .select(
      'shift_rosters.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'shift_types.name as shift_name',
      'shift_types.start_time',
      'shift_types.end_time'
    )
    .orderBy(['employees.first_name', 'shift_rosters.date']);

  return roster;
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
    .select('e.id', 'e.first_name', 'e.last_name', 'e.employee_code', 'jt.title as designation')
    .orderBy('e.first_name');
}

// ─── Per-employee shift assignment (property-agnostic) ───

export async function listEmployeeShifts(q?: string) {
  const query = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('employee_shift_assignments as esa', 'esa.employee_id', 'e.id')
    .leftJoin('shift_types as st', 'st.id', 'esa.shift_type_id')
    .where('e.is_active', true)
    .select(
      'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.dept_name', 'e.branch_name', 'jt.title as designation',
      'esa.shift_type_id',
      'st.name as shift_name', 'st.start_time', 'st.end_time',
    )
    .orderBy('e.first_name')
    .limit(50);

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query.where(function (this: any) {
      this.where('e.first_name', 'like', term)
        .orWhere('e.last_name', 'like', term)
        .orWhere('e.employee_code', 'like', term)
        .orWhere('jt.title', 'like', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) like ?", [term]);
    });
  }
  return query;
}

export async function assignEmployeeShift(employeeId: number, shiftTypeId: number, assignedBy?: number | null) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');
  const shift = await db('shift_types').where('id', shiftTypeId).first();
  if (!shift) throw new NotFoundError('Shift type');

  const existing = await db('employee_shift_assignments').where('employee_id', employeeId).first();
  if (existing) {
    await db('employee_shift_assignments').where('employee_id', employeeId)
      .update({ shift_type_id: shiftTypeId, assigned_by: assignedBy ?? null, updated_at: db.fn.now() });
  } else {
    await db('employee_shift_assignments').insert({ employee_id: employeeId, shift_type_id: shiftTypeId, assigned_by: assignedBy ?? null });
  }
  return { employee_id: employeeId, shift_type_id: shiftTypeId };
}

export async function removeEmployeeShift(employeeId: number) {
  await db('employee_shift_assignments').where('employee_id', employeeId).del();
  return { employee_id: employeeId, shift_type_id: null };
}

export async function assignShift(data: {
  employee_id: number;
  shift_type_id: number;
  date: string;
  property_id: number;
  assigned_by: number;
}) {
  const existing = await db('shift_rosters')
    .where({ employee_id: data.employee_id, date: data.date })
    .first();

  if (existing) {
    await db('shift_rosters')
      .where('id', existing.id)
      .update({
        shift_type_id: data.shift_type_id,
        assigned_by: data.assigned_by,
        updated_at: db.fn.now(),
      });
    return db('shift_rosters').where('id', existing.id).first();
  }

  const [id] = await db('shift_rosters').insert(data);
  return db('shift_rosters').where('id', id).first();
}

export async function bulkAssignShifts(assignments: Array<{
  employee_id: number;
  shift_type_id: number;
  date: string;
  property_id: number;
  assigned_by: number;
}>) {
  const results = [];
  for (const a of assignments) {
    results.push(await assignShift(a));
  }
  return results;
}

export async function removeShift(id: number) {
  const row = await db('shift_rosters').where('id', id).first();
  if (!row) throw new NotFoundError('Shift assignment');
  await db('shift_rosters').where('id', id).delete();
  return row;
}

// ─── Shift Change Requests ───

export async function listChangeRequests(filters: { status?: string; property_id?: number }) {
  const query = db('shift_change_requests')
    .join('shift_types', 'shift_types.id', 'shift_change_requests.shift_type_id')
    .join('users as requester', 'requester.id', 'shift_change_requests.requested_by')
    .leftJoin('employees as remp', 'remp.id', 'requester.employee_id')
    .leftJoin('users as approver', 'approver.id', 'shift_change_requests.approved_by')
    .select(
      'shift_change_requests.*',
      'shift_types.name as shift_name',
      'shift_types.property_id',
      'requester.email as requested_by_email',
      db.raw("trim(coalesce(remp.first_name,'') || ' ' || coalesce(remp.last_name,'')) as requested_by_name"),
      'approver.email as approved_by_email'
    )
    .orderBy('shift_change_requests.created_at', 'desc');

  if (filters.status) query.where('shift_change_requests.status', filters.status);
  if (filters.property_id) query.where('shift_types.property_id', filters.property_id);
  return query;
}

export async function createChangeRequest(data: {
  shift_type_id: number;
  requested_by: number;
  field_changed: string;
  old_value: string;
  new_value: string;
  reason?: string;
}) {
  const [id] = await db('shift_change_requests').insert(data);
  return db('shift_change_requests').where('id', id).first();
}

export async function approveChangeRequest(id: number, approvedBy: number, approved: boolean) {
  const request = await db('shift_change_requests').where('id', id).first();
  if (!request) throw new NotFoundError('Change request');
  if (request.status !== 'pending') throw new ValidationError('Request already processed');

  const newStatus = approved ? 'approved' : 'rejected';

  await db('shift_change_requests')
    .where('id', id)
    .update({ status: newStatus, approved_by: approvedBy, updated_at: db.fn.now() });

  if (approved) {
    if (request.field_changed === 'shift_assignment') {
      // Employee shift-change request → move the requester onto the requested shift.
      const requester = await db('users').where('id', request.requested_by).first();
      if (requester?.employee_id) {
        await assignEmployeeShift(requester.employee_id, request.shift_type_id, approvedBy);
      }
    } else {
      // Legacy shift-type definition edit.
      await db('shift_types')
        .where('id', request.shift_type_id)
        .update({ [request.field_changed]: request.new_value, updated_at: db.fn.now() });
    }
  }

  return db('shift_change_requests').where('id', id).first();
}

// ─── Employee self-service: my shift + request a change ───

export async function getMyShift(employeeId: number | null | undefined) {
  if (!employeeId) return null;
  const row = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .where('a.employee_id', employeeId)
    .select('st.id as shift_type_id', 'st.name', 'st.start_time', 'st.end_time')
    .first();
  return row ?? null;
}

export async function getMyShiftChangeRequests(userId: number) {
  return db('shift_change_requests as r')
    .join('shift_types as st', 'st.id', 'r.shift_type_id')
    .where('r.requested_by', userId)
    .where('r.field_changed', 'shift_assignment')
    .select('r.id', 'r.status', 'r.old_value', 'r.new_value', 'r.reason', 'r.created_at', 'st.name as requested_shift')
    .orderBy('r.created_at', 'desc');
}

export async function createMyShiftChangeRequest(userId: number, employeeId: number | null | undefined, requestedShiftTypeId: number, reason?: string) {
  if (!employeeId) throw new ValidationError('No employee profile linked to this account');
  const shift = await db('shift_types').where('id', requestedShiftTypeId).first();
  if (!shift) throw new NotFoundError('Shift type');

  const pending = await db('shift_change_requests')
    .where({ requested_by: userId, field_changed: 'shift_assignment', status: 'pending' })
    .first();
  if (pending) throw new ValidationError('You already have a pending shift-change request');

  const current = await getMyShift(employeeId);
  const [id] = await db('shift_change_requests').insert({
    shift_type_id: requestedShiftTypeId,
    requested_by: userId,
    field_changed: 'shift_assignment',
    old_value: current?.name ?? '—',
    new_value: shift.name,
    reason: reason ?? null,
    status: 'pending',
  });
  return db('shift_change_requests').where('id', id).first();
}
