import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { INDIAN_STATES } from './statutory.service';

// ─── Properties ───

// Work-Location State model: every property carries a mandatory Indian state —
// the payroll engine resolves each employee's statutory rules (LWF/PT/min wage)
// from their property's state.
function validState(state?: string | null): string {
  const s = String(state || '').trim();
  if (!s) throw new ValidationError('State is required — statutory rules are resolved from the property state');
  if (!INDIAN_STATES.includes(s)) throw new ValidationError(`Unknown state "${s}"`);
  return s;
}

export async function listProperties() {
  return db('properties').orderBy('name');
}

export async function createProperty(data: { name: string; hotel_id?: string; city?: string; state?: string; address?: string; category?: string }) {
  if (!data.name?.trim()) throw new ValidationError('Property name is required');
  const [id] = await db('properties').insert({
    name: data.name.trim(),
    hotel_id: data.hotel_id?.trim() || null,
    city: data.city?.trim() || null,
    state: validState(data.state),
    address: data.address?.trim() || null,
    category: data.category?.trim() || null,
  });
  return db('properties').where('id', id).first();
}

export async function updateProperty(id: number, data: Partial<{ name: string; hotel_id: string; city: string; state: string; address: string; category: string; is_active: boolean }>) {
  const row = await db('properties').where('id', id).first();
  if (!row) throw new NotFoundError('Property');
  const patch: any = { ...data, updated_at: db.fn.now() };
  if ('state' in data) patch.state = validState(data.state);
  await db('properties').where('id', id).update(patch);
  return db('properties').where('id', id).first();
}

export async function deleteProperty(id: number) {
  const row = await db('properties').where('id', id).first();
  if (!row) throw new NotFoundError('Property');
  const vacancyCount = await db('vacancies').where('property_id', id).count('* as c').first();
  if (vacancyCount && Number(vacancyCount.c) > 0) throw new ValidationError('Cannot delete property with linked vacancies. Remove them first.');
  await db('properties').where('id', id).delete();
}

export async function bulkCreateProperties(rows: Array<{ name: string; hotel_id?: string; city?: string; state?: string; address?: string; category?: string }>) {
  // CSV rows may lack a state column — derive one from the state/city cell so
  // every property lands with a valid statutory state (editable afterwards).
  const { resolveStatutoryState } = await import('./statutory.service');
  const results = { created: 0, skipped: 0, errors: [] as string[] };
  for (const row of rows) {
    if (!row.name?.trim()) { results.skipped++; results.errors.push('Skipped row with empty name'); continue; }
    const existing = await db('properties').where('name', row.name.trim()).first();
    if (existing) { results.skipped++; results.errors.push(`"${row.name}" already exists`); continue; }
    await db('properties').insert({
      name: row.name.trim(),
      hotel_id: row.hotel_id?.trim() || null,
      city: row.city?.trim() || null,
      state: resolveStatutoryState(row.state?.trim() || row.city?.trim() || null),
      address: row.address?.trim() || null,
      category: row.category?.trim() || null,
    });
    results.created++;
  }
  return results;
}

// ─── Departments (organization-wide, shared across all properties) ───

export async function listDepartments() {
  return db('departments').orderBy('name');
}

export async function createDepartment(data: { name: string }) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Department name is required');
  const existing = await db('departments').whereRaw('lower(name) = lower(?)', [name]).first();
  if (existing) throw new ValidationError('A department with this name already exists');
  const [id] = await db('departments').insert({ name });
  return db('departments').where('id', id).first();
}

export async function updateDepartment(id: number, data: Partial<{ name: string }>) {
  const row = await db('departments').where('id', id).first();
  if (!row) throw new NotFoundError('Department');
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Department name is required');
  const dup = await db('departments').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
  if (dup) throw new ValidationError('A department with this name already exists');

  // The department table is the single source of truth. Employees carry a free-text
  // dept_name (property convention — employees.department_id was dropped in mig 011),
  // so cascade the rename to every employee that referenced the old name, keeping the
  // Manpower console, analytics and every other module in sync.
  await db.transaction(async (trx) => {
    await trx('departments').where('id', id).update({ name, updated_at: trx.fn.now() });
    if (row.name !== name) {
      await trx('employees').where('dept_name', row.name).update({ dept_name: name, updated_at: trx.fn.now() });
    }
  });
  return db('departments').where('id', id).first();
}

export async function deleteDepartment(id: number) {
  const row = await db('departments').where('id', id).first();
  if (!row) throw new NotFoundError('Department');
  const vacancyCount = await db('vacancies').where('department_id', id).count('* as c').first();
  if (vacancyCount && Number(vacancyCount.c) > 0) throw new ValidationError('Cannot delete department with linked vacancies. Remove or reassign them first.');
  // Employees reference departments by free-text dept_name — block so none is orphaned.
  const empCount = await db('employees').where('dept_name', row.name).count('* as c').first();
  if (empCount && Number(empCount.c) > 0) throw new ValidationError('Cannot delete department with employees assigned. Reassign them to another department first.');
  await db('departments').where('id', id).delete();
}

// ─── Job Titles ───

export async function listJobTitles() {
  return db('job_titles').orderBy('title');
}

export async function createJobTitle(data: { title: string; description?: string }) {
  if (!data.title?.trim()) throw new ValidationError('Job title is required');
  const [id] = await db('job_titles').insert(data);
  return db('job_titles').where('id', id).first();
}

export async function updateJobTitle(id: number, data: Partial<{ title: string; description: string }>) {
  const row = await db('job_titles').where('id', id).first();
  if (!row) throw new NotFoundError('Job title');
  await db('job_titles').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return db('job_titles').where('id', id).first();
}

export async function deleteJobTitle(id: number) {
  const row = await db('job_titles').where('id', id).first();
  if (!row) throw new NotFoundError('Job title');
  const empCount = await db('employees').where('job_title_id', id).count('* as c').first();
  if (empCount && Number(empCount.c) > 0) throw new ValidationError('Cannot delete job title with linked employees');
  await db('job_titles').where('id', id).delete();
}

// ─── Employee Categories ───

export async function listCategories() {
  return db('employee_categories').orderBy('name');
}

export async function createCategory(data: { name: string }) {
  if (!data.name?.trim()) throw new ValidationError('Category name is required');
  const [id] = await db('employee_categories').insert(data);
  return db('employee_categories').where('id', id).first();
}

export async function updateCategory(id: number, data: Partial<{ name: string; is_active: boolean }>) {
  const row = await db('employee_categories').where('id', id).first();
  if (!row) throw new NotFoundError('Employee category');
  await db('employee_categories').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return db('employee_categories').where('id', id).first();
}

export async function deleteCategory(id: number) {
  const row = await db('employee_categories').where('id', id).first();
  if (!row) throw new NotFoundError('Employee category');
  const empCount = await db('employees').where('category_id', id).count('* as c').first();
  if (empCount && Number(empCount.c) > 0) throw new ValidationError('Cannot delete category with linked employees');
  await db('employee_categories').where('id', id).delete();
}

// ─── Pay Grades ───

export async function listPayGrades() {
  return db('pay_grades').orderBy('name');
}

export async function createPayGrade(data: { name: string; min_salary?: number; max_salary?: number }) {
  if (!data.name?.trim()) throw new ValidationError('Pay grade name is required');
  const [id] = await db('pay_grades').insert(data);
  return db('pay_grades').where('id', id).first();
}

export async function updatePayGrade(id: number, data: Partial<{ name: string; min_salary: number; max_salary: number }>) {
  const row = await db('pay_grades').where('id', id).first();
  if (!row) throw new NotFoundError('Pay grade');
  await db('pay_grades').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return db('pay_grades').where('id', id).first();
}

export async function deletePayGrade(id: number) {
  const row = await db('pay_grades').where('id', id).first();
  if (!row) throw new NotFoundError('Pay grade');
  await db('pay_grades').where('id', id).delete();
}

// ─── Employment Statuses ───

export async function listStatuses() {
  return db('employment_statuses').orderBy('name');
}

export async function createStatus(data: { name: string }) {
  if (!data.name?.trim()) throw new ValidationError('Status name is required');
  const [id] = await db('employment_statuses').insert(data);
  return db('employment_statuses').where('id', id).first();
}

export async function updateStatus(id: number, data: { name: string }) {
  const row = await db('employment_statuses').where('id', id).first();
  if (!row) throw new NotFoundError('Employment status');
  await db('employment_statuses').where('id', id).update({ ...data, updated_at: db.fn.now() });
  return db('employment_statuses').where('id', id).first();
}

export async function deleteStatus(id: number) {
  const row = await db('employment_statuses').where('id', id).first();
  if (!row) throw new NotFoundError('Employment status');
  const empCount = await db('employees').where('employment_status_id', id).count('* as c').first();
  if (empCount && Number(empCount.c) > 0) throw new ValidationError('Cannot delete status with linked employees');
  await db('employment_statuses').where('id', id).delete();
}
