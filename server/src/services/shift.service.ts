import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

// ─── Shift Types (organization-wide) ───

export async function listShiftTypes() {
  return db('shift_types').select('*').orderBy('start_time');
}

export async function getShiftType(id: number) {
  const row = await db('shift_types').where('id', id).first();
  if (!row) throw new NotFoundError('Shift type');
  return row;
}

export async function createShiftType(data: {
  name: string;
  start_time: string;
  end_time: string;
}) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Shift name is required');
  const dup = await db('shift_types').whereRaw('lower(name) = lower(?)', [name]).first();
  if (dup) throw new ValidationError('A shift type with this name already exists');

  // property_id is a vestigial NOT NULL column — set it to any existing property.
  const anyProperty = await db('properties').select('id').first();
  const [id] = await db('shift_types').insert({
    name,
    start_time: data.start_time,
    end_time: data.end_time,
    property_id: anyProperty?.id ?? 1,
  });
  return getShiftType(id);
}

export async function updateShiftType(id: number, data: Partial<{
  name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}>) {
  await db('shift_types').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return getShiftType(id);
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
