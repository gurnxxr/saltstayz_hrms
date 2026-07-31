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

// The Add/Edit Property form requires Name, Category, Address, State and City;
// Hotel ID stays optional. This enforces that server-side too (a client can't
// bypass the required attribute). CSV bulk import stays lenient by design.
function requiredField(value: string | null | undefined, label: string): string {
  const s = String(value ?? '').trim();
  if (!s) throw new ValidationError(`${label} is required`);
  return s;
}

export async function listProperties() {
  return db('properties').orderBy('name');
}

/**
 * Two properties may not share a name, case aside.
 *
 * Employees reference their property by NAME, so a second "saltstayz gurgaon" alongside
 * "SaltStayz Gurgaon" makes the lookup ambiguous — and the lookup decides which state's
 * Professional Tax, Labour Welfare Fund and minimum wage a person is paid under. The
 * resolvers use `.first()`, so a tie is broken silently and arbitrarily.
 */
async function assertNameFree(name: string, excludeId?: number): Promise<void> {
  const q = db('properties').whereRaw('lower(name) = lower(?)', [name]);
  if (excludeId) q.whereNot('id', excludeId);
  if (await q.first()) throw new ValidationError(`A property named "${name}" already exists`);
}

export async function createProperty(data: { name: string; hotel_id?: string; city?: string; state?: string; address?: string; category?: string }) {
  await assertNameFree(requiredField(data.name, 'Property name'));
  const [{ id }] = await db('properties').insert({
    name: requiredField(data.name, 'Property name'),
    hotel_id: data.hotel_id?.trim() || null,
    city: requiredField(data.city, 'City'),
    state: validState(data.state),
    address: requiredField(data.address, 'Address'),
    category: requiredField(data.category, 'Category'),
  }).returning('id');
  return db('properties').where('id', id).first();
}

export async function updateProperty(id: number, data: Partial<{ name: string; hotel_id: string; city: string; state: string; address: string; category: string; is_active: boolean }>) {
  const row = await db('properties').where('id', id).first();
  if (!row) throw new NotFoundError('Property');
  const patch: any = { ...data, updated_at: db.fn.now() };
  // Validate whichever of the five mandatory fields are present, so a partial patch
  // (e.g. toggling is_active alone) is left untouched but a full form save is enforced.
  if ('name' in data) patch.name = requiredField(data.name, 'Property name');
  if ('city' in data) patch.city = requiredField(data.city, 'City');
  if ('state' in data) patch.state = validState(data.state);
  if ('address' in data) patch.address = requiredField(data.address, 'Address');
  if ('category' in data) patch.category = requiredField(data.category, 'Category');
  if ('name' in data) await assertNameFree(patch.name, id);

  // The property table is the single source of truth for a work location. Employees carry a
  // free-text branch_name (employees.property_id was dropped in migration 011), so a rename has
  // to cascade or every employee at that property is orphaned the moment it is saved — losing
  // their state holidays and their statutory rates in one edit.
  //
  // `employee_transfers.from_branch` / `.to_branch` are deliberately NOT cascaded. Those record
  // the name AS IT WAS on the transfer date; rewriting them would falsify the audit trail.
  await db.transaction(async (trx) => {
    await trx('properties').where('id', id).update(patch);
    if ('name' in data && row.name !== patch.name) {
      await trx('employees').where('branch_name', row.name)
        .update({ branch_name: patch.name, updated_at: trx.fn.now() });
    }
  });
  return db('properties').where('id', id).first();
}

export async function deleteProperty(id: number) {
  const row = await db('properties').where('id', id).first();
  if (!row) throw new NotFoundError('Property');
  const vacancyCount = await db('vacancies').where('property_id', id).count('* as c').first();
  if (vacancyCount && Number(vacancyCount.c) > 0) throw new ValidationError('Cannot delete property with linked vacancies. Remove them first.');
  // Employees reference a property by free-text branch_name, so deleting one out from under them
  // does not fail loudly — it silently drops them to national holidays only and to the default
  // statutory state. Block it, exactly as deleteDepartment does.
  const empCount = await db('employees').where('branch_name', row.name).count('* as c').first();
  if (empCount && Number(empCount.c) > 0) {
    throw new ValidationError(
      `Cannot delete: ${empCount.c} employee(s) work at this property. Move them to another one first — `
      + 'deleting it would leave them with no work location, and no state for their statutory rates.',
    );
  }
  // Same reasoning as deleteDepartment: holidays scoped to this property alone would cascade
  // away and stop reaching anyone, with nothing on screen saying why.
  const holidayCount = await db('holiday_properties').where('property_id', id).count('* as c').first();
  if (holidayCount && Number(holidayCount.c) > 0) {
    throw new ValidationError(
      `Cannot delete: ${holidayCount.c} holiday(s) are given specifically to this property. Change who those holidays are for first.`,
    );
  }
  await db('properties').where('id', id).delete();
}

export async function bulkCreateProperties(rows: Array<{ name: string; hotel_id?: string; city?: string; state?: string; address?: string; category?: string }>) {
  /*
   * A property's state is a PAYROLL INPUT, not a label — it decides Professional Tax, Labour
   * Welfare Fund and the minimum-wage floor for everyone who works there.
   *
   * This used to derive it: `resolveStatutoryState(row.state || row.city || null)`, whose own
   * fallback is 'Haryana' for anything it doesn't recognise, and whose city list covers only the
   * NCR and Dehradun. So a bulk upload of hotels in Bengaluru, Rishikesh, Mohali and Noida
   * silently stamped every one of them Haryana, and around 88 people have been paid another
   * state's statutory rates ever since. Nothing surfaced it: the value looked deliberate.
   *
   * A guessed state is worse than a missing one, because a missing one is visible. Rows without a
   * state the system actually recognises are now rejected by name, the same way an unknown job
   * title is rejected on the employee import.
   */
  const results = { created: 0, skipped: 0, errors: [] as string[] };
  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) { results.skipped++; results.errors.push('Skipped row with empty name'); continue; }
    const existing = await db('properties').whereRaw('lower(name) = lower(?)', [name]).first();
    if (existing) { results.skipped++; results.errors.push(`"${name}" already exists`); continue; }

    const state = String(row.state ?? '').trim();
    if (!state) {
      results.skipped++;
      results.errors.push(`"${name}": no state given. It decides Professional Tax, Labour Welfare Fund and minimum wage, so it cannot be guessed from the city.`);
      continue;
    }
    if (!INDIAN_STATES.includes(state)) {
      results.skipped++;
      results.errors.push(`"${name}": "${state}" is not a recognised state.`);
      continue;
    }

    await db('properties').insert({
      name,
      hotel_id: row.hotel_id?.trim() || null,
      city: row.city?.trim() || null,
      state,
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

// A department's standard working hours per day (e.g. 8, 8.5, 9) — optional, 0–24.
function validWorkingHours(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const h = Number(v);
  if (!Number.isFinite(h) || h <= 0 || h > 24) throw new ValidationError('Working hours per day must be between 0 and 24');
  return h;
}

export async function createDepartment(data: { name: string; working_hours_per_day?: number | string | null }) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Department name is required');
  const existing = await db('departments').whereRaw('lower(name) = lower(?)', [name]).first();
  if (existing) throw new ValidationError('A department with this name already exists');
  const [{ id }] = await db('departments').insert({ name, working_hours_per_day: validWorkingHours(data.working_hours_per_day) }).returning('id');
  return db('departments').where('id', id).first();
}

export async function updateDepartment(id: number, data: Partial<{ name: string; working_hours_per_day: number | string | null }>) {
  const row = await db('departments').where('id', id).first();
  if (!row) throw new NotFoundError('Department');
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Department name is required');
  const dup = await db('departments').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
  if (dup) throw new ValidationError('A department with this name already exists');

  const patch: any = { name, updated_at: db.fn.now() };
  if ('working_hours_per_day' in data) patch.working_hours_per_day = validWorkingHours(data.working_hours_per_day);

  // The department table is the single source of truth. Two other tables store a department by
  // NAME rather than by id, so a rename has to reach both or they silently detach:
  //
  //   • employees.dept_name — the property convention (employees.department_id was dropped in
  //     migration 011); and
  //   • property_department_workers.department — the per-property sanctioned headcount behind
  //     Admin → Budget Control and Property Configuration.
  //
  // Missing the second one is what made a rename look like it had not applied at all. Budget
  // Control seeds its rows from the departments catalogue and then adds any name found only in
  // property_department_workers, so a rename produced TWO rows: the new name carrying the staff
  // but a sanctioned count of zero, and a ghost of the old name still holding the real number.
  // The department appeared unchanged, or worse, duplicated.
  await db.transaction(async (trx) => {
    await trx('departments').where('id', id).update(patch);
    if (row.name !== name) {
      await trx('employees').where('dept_name', row.name).update({ dept_name: name, updated_at: trx.fn.now() });
      // Guarded against a collision: if the target name already has a sanctioned row at this
      // property, renaming into it would violate the (property_id, department) unique. Drop the
      // stale row in that case — the destination's own figure is the one the admin can see.
      const targetRows = await trx('property_department_workers').where('department', name).pluck('property_id');
      if (targetRows.length) {
        await trx('property_department_workers')
          .where('department', row.name).whereIn('property_id', targetRows).del();
      }
      await trx('property_department_workers').where('department', row.name).update({ department: name });
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
  // Holidays given specifically to this department would cascade away with it and silently stop
  // reaching anyone — a paid day off disappearing with no trace of why.
  const holidayCount = await db('holiday_departments').where('department_id', id).count('* as c').first();
  if (holidayCount && Number(holidayCount.c) > 0) {
    throw new ValidationError(
      `Cannot delete: ${holidayCount.c} holiday(s) are given specifically to this department. Change who those holidays are for first.`,
    );
  }
  // Same name-keyed table the rename has to chase (see updateDepartment). Left behind, a
  // sanctioned-headcount row keeps the deleted department alive on Budget Control forever — the
  // console lists any name it finds here even when the catalogue no longer has it. No employees
  // remain by this point (blocked above), so the count refers to nothing and is safe to drop.
  await db.transaction(async (trx) => {
    await trx('property_department_workers').where('department', row.name).del();
    await trx('departments').where('id', id).delete();
  });
}

// ─── Property Categories (managed pick-list for the property "Category" field) ───

export async function listPropertyCategories() {
  return db('property_categories').orderBy('name');
}

export async function createPropertyCategory(data: { name: string }) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Category name is required');
  const existing = await db('property_categories').whereRaw('lower(name) = lower(?)', [name]).first();
  if (existing) throw new ValidationError('A category with this name already exists');
  const [{ id }] = await db('property_categories').insert({ name }).returning('id');
  return db('property_categories').where('id', id).first();
}

export async function updatePropertyCategory(id: number, data: Partial<{ name: string }>) {
  const row = await db('property_categories').where('id', id).first();
  if (!row) throw new NotFoundError('Property category');
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Category name is required');
  const dup = await db('property_categories').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
  if (dup) throw new ValidationError('A category with this name already exists');

  // Properties carry a free-text category string; cascade the rename so existing
  // properties keep pointing at the renamed category (mirrors the department rename).
  await db.transaction(async (trx) => {
    await trx('property_categories').where('id', id).update({ name, updated_at: trx.fn.now() });
    if (row.name !== name) {
      await trx('properties').where('category', row.name).update({ category: name, updated_at: trx.fn.now() });
    }
  });
  return db('property_categories').where('id', id).first();
}

export async function deletePropertyCategory(id: number) {
  const row = await db('property_categories').where('id', id).first();
  if (!row) throw new NotFoundError('Property category');
  // Properties reference a category by free-text name — block so none is orphaned.
  const inUse = await db('properties').where('category', row.name).count('* as c').first();
  if (inUse && Number(inUse.c) > 0) throw new ValidationError('Cannot delete a category in use by a property. Reassign those properties first.');
  await db('property_categories').where('id', id).delete();
}

// ─── Job Titles ───

export async function listJobTitles() {
  return db('job_titles as jt')
    .leftJoin('departments as d', 'd.id', 'jt.department_id')
    .leftJoin('pay_grades as pg', 'pg.id', 'jt.pay_grade_id')
    .select(
      'jt.*',
      'd.name as department_name',
      // The role's salary band. Carried alongside the name so the Job Titles table can show
      // the actual range without a second round-trip, and so an unassigned role is obvious.
      'pg.name as pay_grade_name',
      'pg.min_salary as pay_grade_min',
      'pg.max_salary as pay_grade_max',
    )
    .orderBy('jt.title');
}

// A blank/absent department means "unassigned" (NULL). A provided id must exist.
async function resolveDeptId(v: number | string | null | undefined): Promise<number | null> {
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid department');
  const dept = await db('departments').where('id', id).first();
  if (!dept) throw new ValidationError('Selected department does not exist');
  return id;
}

// A blank/absent pay grade means "unassigned" (NULL) — and an unassigned role has no approved
// salary ceiling, so offers for it need admin approval. A provided id must exist.
async function resolvePayGradeId(v: number | string | null | undefined): Promise<number | null> {
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError('Invalid pay grade');
  const grade = await db('pay_grades').where('id', id).first();
  if (!grade) throw new ValidationError('Selected pay grade does not exist');
  return id;
}

export async function createJobTitle(data: { title: string; description?: string; department_id?: number | string | null; pay_grade_id?: number | string | null }) {
  if (!data.title?.trim()) throw new ValidationError('Job title is required');
  const department_id = await resolveDeptId(data.department_id);
  const pay_grade_id = await resolvePayGradeId(data.pay_grade_id);
  const [{ id }] = await db('job_titles')
    .insert({ title: data.title.trim(), description: data.description ?? null, department_id, pay_grade_id })
    .returning('id');
  return db('job_titles').where('id', id).first();
}

export async function updateJobTitle(id: number, data: Partial<{ title: string; description: string; department_id: number | string | null; pay_grade_id: number | string | null }>) {
  const row = await db('job_titles').where('id', id).first();
  if (!row) throw new NotFoundError('Job title');
  const patch: Record<string, unknown> = { updated_at: db.fn.now() };
  if (data.title !== undefined) patch.title = String(data.title).trim();
  if (data.description !== undefined) patch.description = data.description;
  if ('department_id' in data) patch.department_id = await resolveDeptId(data.department_id);
  if ('pay_grade_id' in data) patch.pay_grade_id = await resolvePayGradeId(data.pay_grade_id);
  await db('job_titles').where('id', id).update(patch);
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
  const [{ id }] = await db('employee_categories').insert(data).returning('id');
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
  // Carries how many roles sit in each grade, so the Pay Grades screen shows the band ladder
  // AND its usage — a grade nothing is assigned to is visible as such rather than looking live.
  // Ordered by the band itself: reading grades in salary order is how the ladder makes sense.
  return db('pay_grades as pg')
    .leftJoin('job_titles as jt', 'jt.pay_grade_id', 'pg.id')
    .groupBy('pg.id')
    .select('pg.*')
    .count({ role_count: 'jt.id' })
    .orderBy([{ column: 'pg.min_salary' }, { column: 'pg.name' }]);
}

export async function createPayGrade(data: { name: string; min_salary?: number; max_salary?: number }) {
  if (!data.name?.trim()) throw new ValidationError('Pay grade name is required');
  const [{ id }] = await db('pay_grades').insert(data).returning('id');
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
  const [{ id }] = await db('employment_statuses').insert(data).returning('id');
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

// ─── Branches (managed pick-list for the employee "Branch Name" field) ───
//
// A branch is the business unit somebody reports into — Corporate Office, Projects, Sales.
// It is NOT a location: it has no address and no state, and nothing about pay is resolved from
// it. Where a person works, and therefore which state's Professional Tax, Labour Welfare Fund
// and minimum wage apply, comes from their PROPERTY. Keeping the two apart is the point of this
// list existing; one field was previously doing both jobs, and the half it did silently was the
// half that decides payroll.

export async function listBranches() {
  return db('branches').orderBy('name');
}

export async function createBranch(data: { name: string }) {
  const name = data.name?.trim();
  if (!name) throw new ValidationError('Branch name is required');
  const existing = await db('branches').whereRaw('lower(name) = lower(?)', [name]).first();
  if (existing) throw new ValidationError('A branch with this name already exists');
  const [{ id }] = await db('branches').insert({ name }).returning('id');
  return db('branches').where('id', id).first();
}

export async function updateBranch(id: number, data: Partial<{ name: string; is_active: boolean }>) {
  const row = await db('branches').where('id', id).first();
  if (!row) throw new NotFoundError('Branch');
  const patch: any = { updated_at: db.fn.now() };
  if ('is_active' in data) patch.is_active = !!data.is_active;

  if ('name' in data) {
    const name = data.name?.trim();
    if (!name) throw new ValidationError('Branch name is required');
    const dup = await db('branches').whereRaw('lower(name) = lower(?)', [name]).whereNot('id', id).first();
    if (dup) throw new ValidationError('A branch with this name already exists');
    patch.name = name;
  }

  // Employees carry the branch as free text, so a rename has to follow through or everyone in
  // that unit is quietly detached from it — the same cascade departments and property categories
  // already do.
  await db.transaction(async (trx) => {
    await trx('branches').where('id', id).update(patch);
    if (patch.name && row.name !== patch.name) {
      await trx('employees').where('branch_unit', row.name)
        .update({ branch_unit: patch.name, updated_at: trx.fn.now() });
    }
  });
  return db('branches').where('id', id).first();
}

export async function deleteBranch(id: number) {
  const row = await db('branches').where('id', id).first();
  if (!row) throw new NotFoundError('Branch');
  const inUse = await db('employees').where('branch_unit', row.name).count('* as c').first();
  if (inUse && Number(inUse.c) > 0) {
    throw new ValidationError(
      `Cannot delete: ${inUse.c} employee(s) are in this branch. Move them to another one first.`,
    );
  }
  await db('branches').where('id', id).delete();
}
