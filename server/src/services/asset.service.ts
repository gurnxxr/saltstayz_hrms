import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Company Assets: an admin-managed catalog of issuable item types, plus a
// per-employee assignment register (who holds what, since when, returned or not).
// Assets issued during employment are collected back at exit; the Exit Interview
// completion flow marks the returns via markAssetsReturned().
// ─────────────────────────────────────────────────────────────────────────────

export const ASSET_CATEGORIES = ['IT Equipment', 'Uniform', 'Access & Keys', 'Vehicle', 'Finance', 'Other'];

const clean = (v: any) => (v === undefined || v === null ? '' : String(v).trim());
const todayISO = () => new Date().toISOString().slice(0, 10);
const category = (v: any) => (ASSET_CATEGORIES.includes(clean(v)) ? clean(v) : 'Other');

// ─── Catalog (item types) ───

export async function listAssetTypes(includeInactive = false) {
  const q = db('asset_types').select('*').orderBy('category').orderBy('name');
  if (!includeInactive) q.where('is_active', true);
  return q;
}

export async function createAssetType(data: { name: string; category?: string }) {
  const name = clean(data.name);
  if (!name) throw new ValidationError('Item name is required');
  const dupe = await db('asset_types').whereRaw('lower(name) = ?', [name.toLowerCase()]).first();
  if (dupe) throw new ValidationError('An item with this name already exists');
  const [id] = await db('asset_types').insert({ name, category: category(data.category) });
  return db('asset_types').where('id', id).first();
}

export async function updateAssetType(
  id: number,
  data: { name?: string; category?: string; is_active?: boolean },
) {
  const row = await db('asset_types').where('id', id).first();
  if (!row) throw new NotFoundError('Item');

  const patch: any = { updated_at: db.fn.now() };
  if (data.name !== undefined) {
    const name = clean(data.name);
    if (!name) throw new ValidationError('Item name is required');
    const dupe = await db('asset_types').whereRaw('lower(name) = ?', [name.toLowerCase()]).whereNot('id', id).first();
    if (dupe) throw new ValidationError('An item with this name already exists');
    patch.name = name;
  }
  if (data.category !== undefined) patch.category = category(data.category);
  if (data.is_active !== undefined) patch.is_active = data.is_active ? 1 : 0;

  await db('asset_types').where('id', id).update(patch);
  return db('asset_types').where('id', id).first();
}

// ─── Assignment register ───

const assignmentSelect = () =>
  db('asset_assignments as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .join('asset_types as at', 'at.id', 'a.asset_type_id')
    .leftJoin('users as ab', 'ab.id', 'a.assigned_by')
    .leftJoin('users as rb', 'rb.id', 'a.returned_collected_by')
    .select(
      'a.*',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name',
      'at.name as asset_name', 'at.category as asset_category',
      'ab.email as assigned_by_email', 'rb.email as returned_by_email',
    );

export async function listAssignments(filters: { employee_id?: number; status?: string } = {}) {
  const q = assignmentSelect().orderBy('a.assigned_date', 'desc').orderBy('a.id', 'desc');
  if (filters.employee_id) q.where('a.employee_id', Number(filters.employee_id));
  if (filters.status) q.where('a.status', filters.status);
  return q;
}

/** Items an employee still holds (status = assigned) — powers the exit checklist. */
export async function getOutstandingAssets(employeeId: number) {
  return assignmentSelect()
    .where('a.employee_id', Number(employeeId))
    .where('a.status', 'assigned')
    .orderBy('a.assigned_date');
}

export async function createAssignment(
  data: { employee_id: number; asset_type_id: number; identifier?: string; assigned_date: string; note?: string },
  userId?: number | null,
) {
  const emp = await db('employees').where('id', Number(data.employee_id)).first();
  if (!emp) throw new NotFoundError('Employee');
  const type = await db('asset_types').where('id', Number(data.asset_type_id)).first();
  if (!type) throw new NotFoundError('Item');
  if (!type.is_active) throw new ValidationError('This item is inactive — reactivate it in the catalog first');
  if (!data.assigned_date) throw new ValidationError('Assigned date is required');

  const [id] = await db('asset_assignments').insert({
    employee_id: emp.id,
    asset_type_id: type.id,
    identifier: clean(data.identifier) || null,
    assigned_date: data.assigned_date,
    assigned_by: userId ?? null,
    status: 'assigned',
    note: clean(data.note) || null,
  });
  return assignmentSelect().where('a.id', id).first();
}

export async function updateAssignment(
  id: number,
  data: { asset_type_id?: number; identifier?: string; assigned_date?: string; note?: string },
) {
  const row = await db('asset_assignments').where('id', id).first();
  if (!row) throw new NotFoundError('Assignment');

  const patch: any = { updated_at: db.fn.now() };
  if (data.asset_type_id !== undefined) {
    const type = await db('asset_types').where('id', Number(data.asset_type_id)).first();
    if (!type) throw new NotFoundError('Item');
    patch.asset_type_id = type.id;
  }
  if (data.identifier !== undefined) patch.identifier = clean(data.identifier) || null;
  if (data.assigned_date !== undefined) {
    if (!data.assigned_date) throw new ValidationError('Assigned date is required');
    patch.assigned_date = data.assigned_date;
  }
  if (data.note !== undefined) patch.note = clean(data.note) || null;

  await db('asset_assignments').where('id', id).update(patch);
  return assignmentSelect().where('a.id', id).first();
}

/** Close out a single assignment as returned (collected) or lost. */
export async function returnAssignment(
  id: number,
  data: { status?: string; returned_date?: string; condition_note?: string },
  userId?: number | null,
) {
  const row = await db('asset_assignments').where('id', id).first();
  if (!row) throw new NotFoundError('Assignment');
  if (row.status !== 'assigned') throw new ValidationError('This item has already been closed out');

  await db('asset_assignments').where('id', id).update({
    status: data.status === 'lost' ? 'lost' : 'returned',
    returned_date: clean(data.returned_date) || todayISO(),
    returned_collected_by: userId ?? null,
    condition_note: clean(data.condition_note) || null,
    updated_at: db.fn.now(),
  });
  return assignmentSelect().where('a.id', id).first();
}

/**
 * Bulk-mark the given outstanding assignments as returned — used by the Exit
 * Interview checklist. Guards to the given employee and to still-assigned rows,
 * so stale ids from the client can never close out someone else's item.
 * Returns how many were actually marked.
 */
export async function markAssetsReturned(
  ids: number[],
  employeeId: number,
  meta: { exit_interview_id?: number | null; returned_date?: string } = {},
  userId?: number | null,
): Promise<number> {
  const cleanIds = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!cleanIds.length) return 0;

  const targets = await db('asset_assignments')
    .whereIn('id', cleanIds)
    .where('employee_id', Number(employeeId))
    .where('status', 'assigned')
    .pluck('id');
  if (!targets.length) return 0;

  await db('asset_assignments').whereIn('id', targets).update({
    status: 'returned',
    returned_date: clean(meta.returned_date) || todayISO(),
    returned_collected_by: userId ?? null,
    exit_interview_id: meta.exit_interview_id ?? null,
    updated_at: db.fn.now(),
  });
  return targets.length;
}

export async function deleteAssignment(id: number) {
  const row = await db('asset_assignments').where('id', id).first();
  if (!row) throw new NotFoundError('Assignment');
  await db('asset_assignments').where('id', id).del();
}
