import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { parseCsv } from '../utils/csv';

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
  const [{ id }] = await db('asset_types').insert({ name, category: category(data.category) }).returning('id');
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
  if (data.is_active !== undefined) patch.is_active = data.is_active ? true : false;

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

  const [{ id }] = await db('asset_assignments').insert({
    employee_id: emp.id,
    asset_type_id: type.id,
    identifier: clean(data.identifier) || null,
    assigned_date: data.assigned_date,
    assigned_by: userId ?? null,
    status: 'assigned',
    note: clean(data.note) || null,
  }).returning('id');
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

// ─── Bulk upload of the assignment register (CSV) ───

const ASSET_STATUSES = ['assigned', 'returned', 'lost'];

// CSV header cell → canonical field. The expected sheet is Employee Name / EmpCode /
// Property Name / Item / Serial-Tag / Assigned Date / Assigned By(Email) / Status.
const ASSET_HEADER_ALIASES: Record<string, string> = {
  employee_name: 'employee_name', name: 'employee_name', employee: 'employee_name',
  empcode: 'employee_code', emp_code: 'employee_code', employee_code: 'employee_code', code: 'employee_code',
  property_name: 'property', property: 'property', branch: 'property', location: 'property',
  item: 'item', item_name: 'item', asset: 'item', asset_name: 'item', asset_type: 'item',
  serial_tag: 'identifier', serial: 'identifier', tag: 'identifier', serial_no: 'identifier',
  serial_number: 'identifier', asset_tag: 'identifier', identifier: 'identifier',
  assigned_date: 'assigned_date', assign_date: 'assigned_date', date_assigned: 'assigned_date', date: 'assigned_date',
  assigned_by_email: 'assigned_by', assigned_by: 'assigned_by', issued_by: 'assigned_by',
  status: 'status',
};

// Accept yyyy-mm-dd, dd-mm-yyyy and dd/mm/yyyy (Indian convention); else fall back to Date.
function normalizeAssetDate(v: string): string | null {
  const s = clean(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Import an asset-assignment register from CSV. Each row is resolved to an employee by
 * EmpCode and to a catalog item by name (created if new), and inserted as an assignment.
 * A row with Status = returned/lost lands straight in History (returned as of the import,
 * since the sheet carries no return date). Property Name is accepted but not stored — it
 * is derived from the employee's branch. Re-uploading the same sheet is safe: an identical
 * active assignment (same employee + item + serial) is skipped, not duplicated.
 */
export async function bulkUploadAssetAssignments(csvContent: string, userId?: number | null) {
  const rows = parseCsv(csvContent);
  if (rows.length < 2) throw new ValidationError('CSV must have a header row and at least one asset row');

  const header = rows[0].map((h) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return ASSET_HEADER_ALIASES[key] || key;
  });
  if (!header.includes('employee_code')) throw new ValidationError('CSV must have an "EmpCode" column');
  if (!header.includes('item')) throw new ValidationError('CSV must have an "Item" column');

  const results = { total: 0, created: 0, skipped: 0, errors: [] as string[] };
  const seen = new Set<string>();                     // in-file dedupe of active assignments
  const typeCache = new Map<string, number>();        // lower(name) → asset_type_id (incl. created this run)
  const userCache = new Map<string, number | null>(); // lower(email) → user id

  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    results.total++;
    const rowNo = r + 1;

    if (cols.length !== header.length) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: expected ${header.length} columns, found ${cols.length}`);
      continue;
    }

    // First non-empty value wins when two header columns map to the same field.
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { if (!row[h]) row[h] = cols[idx] ?? ''; });

    const code = clean(row.employee_code);
    if (!code) { results.skipped++; results.errors.push(`Row ${rowNo}: missing EmpCode`); continue; }
    const emp = await db('employees').where('employee_code', code).first();
    if (!emp) { results.skipped++; results.errors.push(`Row ${rowNo}: no employee with code "${code}"`); continue; }

    const itemName = clean(row.item);
    if (!itemName) { results.skipped++; results.errors.push(`Row ${rowNo}: missing Item`); continue; }

    const assignedDate = normalizeAssetDate(row.assigned_date);
    if (!assignedDate) { results.skipped++; results.errors.push(`Row ${rowNo}: missing or invalid Assigned Date`); continue; }

    const statusRaw = clean(row.status).toLowerCase();
    const status = ASSET_STATUSES.includes(statusRaw) ? statusRaw : 'assigned';
    const identifier = clean(row.identifier) || null;

    // Resolve (or create) the catalog item — a register import shouldn't fail just because
    // a laptop model isn't catalogued yet.
    const typeKey = itemName.toLowerCase();
    let assetTypeId = typeCache.get(typeKey);
    if (assetTypeId === undefined) {
      const existing = await db('asset_types').whereRaw('lower(name) = ?', [typeKey]).first();
      if (existing) assetTypeId = existing.id;
      else { const [{ id }] = await db('asset_types').insert({ name: itemName, category: 'Other' }).returning('id'); assetTypeId = id; }
      typeCache.set(typeKey, assetTypeId!);
    }

    // Resolve "Assigned By (Email)" to a user; a blank cell falls back to the uploader,
    // an unknown email is left unset rather than misattributed.
    let assignedBy: number | null = userId ?? null;
    const byEmail = clean(row.assigned_by).toLowerCase();
    if (byEmail) {
      if (!userCache.has(byEmail)) {
        const u = await db('users').whereRaw('lower(email) = ?', [byEmail]).first();
        userCache.set(byEmail, u ? u.id : null);
      }
      assignedBy = userCache.get(byEmail) ?? null;
    }

    // De-dupe an identical active assignment (employee + item + serial), in-file and in
    // the register, so re-uploading the same sheet doesn't double it.
    if (status === 'assigned') {
      const dupKey = `${emp.id}:${assetTypeId}:${(identifier || '').toLowerCase()}`;
      if (seen.has(dupKey)) { results.skipped++; results.errors.push(`Row ${rowNo}: duplicate of an earlier row in this file`); continue; }
      const dup = await db('asset_assignments')
        .where({ employee_id: emp.id, asset_type_id: assetTypeId, status: 'assigned' })
        .where((q) => { if (identifier) q.whereRaw('lower(identifier) = ?', [identifier.toLowerCase()]); else q.whereNull('identifier'); })
        .first();
      if (dup) { results.skipped++; results.errors.push(`Row ${rowNo}: ${emp.employee_code} already holds this item`); continue; }
      seen.add(dupKey);
    }

    try {
      await db('asset_assignments').insert({
        employee_id: emp.id,
        asset_type_id: assetTypeId,
        identifier,
        assigned_date: assignedDate,
        assigned_by: assignedBy,
        status,
        returned_date: status === 'assigned' ? null : todayISO(),
        returned_collected_by: status === 'assigned' ? null : (userId ?? null),
      });
      results.created++;
    } catch {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: could not be saved`);
    }
  }

  return results;
}
