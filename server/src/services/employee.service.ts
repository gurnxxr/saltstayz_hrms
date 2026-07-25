import type { Knex } from 'knex';
import db from '../config/database';
import { nextJobId } from '../utils/jobId';
import { ValidationError } from '../utils/errors';
import { getDefaultTemplateId } from './leaveTemplate.service';
import { computePropertyBudget } from './manpower.service';
import { advisoryXactLock, LOCK } from '../utils/locks';
import { buildCsv } from '../utils/csv';

// createEmployee/updateEmployee write the payload straight through, so gender is
// normalised here — leave eligibility compares it verbatim against 'female'/'male',
// and a stray 'M' or 'Male' would silently fail every gender-restricted leave check.
//
// ValidationError, not the `Object.assign(new Error(), { status })` used elsewhere in
// this file: errorHandler only maps AppError subclasses to a status code, so those
// throws surface as a generic 500.
const GENDERS = ['male', 'female', 'other'];

function normalizeGender(data: any) {
  if (!('gender' in data)) return;
  const raw = String(data.gender ?? '').trim().toLowerCase();
  if (!raw) { data.gender = null; return; } // blank clears it
  if (!GENDERS.includes(raw)) throw new ValidationError(`Gender must be one of: ${GENDERS.join(', ')}`);
  data.gender = raw;
}

/** Five letters, four digits, one letter — e.g. ABCDE1234F. Same shape finance validates. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Uppercases and checks a PAN. A wrong one is worse than a missing one: it looks verified and
 * follows the employee into anything that reads the HR record.
 */
function normalizePan(data: any) {
  if (!('pan_number' in data)) return;
  const raw = String(data.pan_number ?? '').trim().toUpperCase();
  if (!raw) { data.pan_number = null; return; } // blank clears it
  if (!PAN_PATTERN.test(raw)) {
    throw new ValidationError(`"${raw}" is not a valid PAN — it should look like ABCDE1234F`);
  }
  data.pan_number = raw;
}

export interface EmployeeFilters {
  search?: string;
  status?: string;
  branch?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Shared WHERE builder so the count, the page and the CSV export all select the same people.
 * If the export filtered differently from the table it sits above, it would quietly hand over
 * a different set of employees than the one on screen.
 */
const applyEmployeeFilters = (q: any, filters: EmployeeFilters) => {
  if (filters.search) {
    q.where(function (this: any) {
      this.where('e.first_name', 'ilike', `%${filters.search}%`)
        .orWhere('e.last_name', 'ilike', `%${filters.search}%`)
        .orWhere('e.employee_code', 'ilike', `%${filters.search}%`)
        .orWhere('e.email', 'ilike', `%${filters.search}%`);
    });
  }
  if (filters.status === 'active') q.where('e.is_active', true);
  else if (filters.status === 'inactive') q.where('e.is_active', false);
  // Property filter: branch_name is the plain-text property this employee belongs to.
  if (filters.branch) q.where('e.branch_name', filters.branch);
  return q;
};

export async function listEmployees(filters: EmployeeFilters) {
  const applyFilters = (q: any) => applyEmployeeFilters(q, filters);

  // State is DERIVED from the employee's property, never stored on the employee —
  // it decides Professional Tax, LWF, minimum wage and per-state holidays, and one
  // source of truth for that is the point (see getEmployeeState in statutory.service).
  const baseQuery = () =>
    db('employees as e')
      .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
      .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
      .leftJoin('properties as p', 'p.name', 'e.branch_name')
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'e.email', 'e.phone', 'e.date_of_birth', 'e.date_of_joining',
        'e.father_name', 'e.aadhaar_number', 'e.pan_number', 'e.dept_name', 'e.branch_name',
        'e.is_active',
        'j.title as designation_name',
        'p.state as state',
        'mgr.first_name as manager_first_name',
        'mgr.last_name as manager_last_name',
      )
      .orderBy('e.first_name');

  // No page requested → return the full array (backward compatible)
  if (!filters.page) {
    return applyFilters(baseQuery());
  }

  const page = Math.max(1, filters.page);
  const pageSize = Math.min(Math.max(1, filters.pageSize || 10), 100);
  const offset = (page - 1) * pageSize;

  const countRow = await applyFilters(db('employees as e'))
    .count('e.id as total')
    .first();
  const total = Number(countRow?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const data = await applyFilters(baseQuery()).limit(pageSize).offset(offset);

  return { data, total, page, pageSize, totalPages };
}

/**
 * The whole directory as CSV — every stored field, not just the columns the table shows.
 *
 * Honours the screen's filters, so the file matches the list the person is looking at rather
 * than silently handing over everyone.
 *
 * The headers are the ones the bulk uploader accepts, and the reporting manager is written as
 * their employee CODE rather than their name, so an export can be edited and uploaded straight
 * back. A name would not resolve on the way in.
 *
 * Pay is deliberately NOT included. CTC and offer figures live behind the salary module's own
 * permissions, and folding them in here would hand them to everyone who can manage the
 * directory — a wider audience than the one allowed to see them.
 */
export async function exportEmployeesCsv(filters: EmployeeFilters): Promise<string> {
  const rows = await applyEmployeeFilters(
    db('employees as e')
      .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
      .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
      .leftJoin('properties as p', 'p.name', 'e.branch_name')
      .select(
        'e.employee_code', 'e.first_name', 'e.last_name', 'e.email', 'e.phone', 'e.gender',
        'e.date_of_birth', 'e.date_of_joining', 'e.probation_end_date', 'e.last_working_day',
        'e.father_name', 'e.aadhaar_number', 'e.pan_number', 'e.dept_name', 'e.branch_name',
        'e.employment_status', 'e.is_active', 'e.job_id',
        'j.title as job_title',
        'p.state as state',
        'mgr.employee_code as reporting_manager_code',
      )
      .orderBy('e.employee_code'),
    filters,
  );

  const header = [
    'employee_code', 'first_name', 'last_name', 'email', 'phone', 'gender',
    'date_of_birth', 'date_of_joining', 'probation_end_date', 'last_working_day',
    'father_name', 'aadhaar_number', 'pan_number', 'department', 'branch_name', 'job_title',
    'reporting_manager_code', 'state', 'employment_status', 'status', 'job_id',
  ];

  return buildCsv(header, rows.map((r: any) => [
    r.employee_code, r.first_name, r.last_name, r.email, r.phone, r.gender,
    r.date_of_birth, r.date_of_joining, r.probation_end_date, r.last_working_day,
    r.father_name, r.aadhaar_number, r.pan_number, r.dept_name, r.branch_name, r.job_title,
    r.reporting_manager_code,
    // Derived from the property rather than stored, so it is informational — the uploader
    // ignores it, and editing it in the file changes nothing on the way back in.
    r.state,
    r.employment_status,
    r.is_active ? 'active' : 'inactive',
    r.job_id,
  ]));
}

export async function getEmployee(id: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
    .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .where('e.id', id)
    .select(
      'e.*',
      'j.title as designation_name',
      'p.state as state', // derived from the property; see listEmployees
      'mgr.first_name as manager_first_name',
      'mgr.last_name as manager_last_name',
    )
    .first();

  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  return emp;
}

/**
 * The signed-in user's own direct reports, for the "My Team" card on their dashboard.
 *
 * Self-scoped on purpose, and NOT behind DIRECTORY_ROLES: being someone's reporting manager is
 * the entitlement here, so a property manager or a plain employee who happens to have reports
 * can see their own team without opening the employee directory to them. It stays strictly
 * narrower than that directory — only presentational fields are selected, never phone, email,
 * Aadhaar, or anything about pay. Inactive reports are excluded so an exited team member doesn't
 * linger on the card.
 */
export async function getMyReportees(managerId: number) {
  return db('employees as e')
    .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
    .where('e.reporting_manager_id', managerId)
    .where('e.is_active', true)
    .select(
      'e.id',
      'e.employee_code',
      'e.first_name',
      'e.last_name',
      'e.dept_name',
      'e.branch_name',
      'j.title as designation_name',
    )
    .orderBy([{ column: 'e.first_name' }, { column: 'e.last_name' }]);
}

/**
 * Directly creating an employee (single or bulk CSV) skips the recruitment funnel where the
 * sanctioned cap is normally enforced, so it must re-check the cap itself — otherwise it is the
 * widest way to over-hire or over-pay. This mirrors `assertHireAllowed` on the offer path but is
 * deliberately softer at the edges suited to an import:
 *   • an inactive body doesn't occupy a live slot → skip;
 *   • an unknown/blank branch can't be measured (it lands in the "unassigned" bucket) → skip;
 *   • a property with NO sanctioned limit set has nothing to enforce (admin bootstrapping) → skip.
 * Where a limit IS set, a new active body must fit the sanctioned headcount, its CTC (if given) must
 * fit the free budget, and — when the role has an approved max — must not exceed it. A breach throws
 * ValidationError, which the single-create controller surfaces as 400 and the bulk loop reports per row.
 */
async function assertImportWithinCap(trx: Knex.Transaction, data: any): Promise<void> {
  if (data.is_active === false) return;                 // not a live headcount
  const branch = (data.branch_name || '').trim();
  if (!branch) return;                                  // no property to measure against
  const prop = await trx('properties').where('name', branch).first();
  if (!prop) return;                                    // branch text doesn't map to a property
  // Serialise this property's read-decide-insert against every other hiring path (recruitment,
  // Add-Hire, and other imports), which take the SAME lock. Without it two concurrent imports each
  // read the same free slot/budget and both insert past the cap — the one MVCC hole in the wall.
  await advisoryXactLock(trx, LOCK.HIRE_BUDGET, prop.id);
  const pb = await computePropertyBudget(prop.id, trx);
  if (!pb.configured) return;                           // no sanctioned limit → nothing to enforce

  if (pb.remaining_slots <= 0) {
    throw new ValidationError(
      `${prop.name} is at its sanctioned headcount (${pb.filled_headcount}/${pb.sanctioned_headcount} filled, pending offers included). Raise the limit in Admin → Budget Control before adding staff here.`,
    );
  }

  const ctc = Number(data.monthly_ctc) || 0;
  if (ctc > 0) {
    if (ctc > pb.remaining_budget) {
      throw new ValidationError(
        `₹${ctc.toLocaleString('en-IN')}/month is above ${prop.name}'s free budget of ₹${pb.remaining_budget.toLocaleString('en-IN')}. Raise the sanctioned budget in Admin → Budget Control first.`,
      );
    }
    if (data.job_title_id) {
      const rs = await trx('manpower_sanctions').where({ property_id: prop.id, job_title_id: data.job_title_id }).first();
      const bandMax = rs ? Number(rs.band_max) : 0;
      if (bandMax > 0 && ctc > bandMax) {
        throw new ValidationError(
          `₹${ctc.toLocaleString('en-IN')}/month is above the approved maximum of ₹${bandMax.toLocaleString('en-IN')} for that role at ${prop.name}.`,
        );
      }
    }
  }
}

export async function createEmployee(data: any) {
  const existing = await db('employees').where('employee_code', data.employee_code).first();
  if (existing) throw Object.assign(new Error('Employee code already exists'), { status: 409 });

  if (data.email) {
    const emailExists = await db('employees').where('email', data.email).first();
    if (emailExists) throw Object.assign(new Error('Email already in use'), { status: 409 });
  }

  // A garbage monthly_ctc must not slip the budget check by coercing to 0 (the bulk path already
  // rejects this); a valid absent CTC stays absent (headcount-only gating).
  if (data.monthly_ctc != null && data.monthly_ctc !== '' && !(Number.isFinite(Number(data.monthly_ctc)) && Number(data.monthly_ctc) >= 0)) {
    throw new ValidationError('Monthly CTC must be a non-negative number.');
  }

  normalizeGender(data);
  normalizePan(data);
  if (!data.job_id) data.job_id = await nextJobId(db);
  if (data.leave_template_id == null) data.leave_template_id = await getDefaultTemplateId(); // land on Default
  // The sanctioned-cap check and the insert share one advisory-locked transaction, so a concurrent
  // create can't read the same free slot and race past the wall (direct create bypasses recruitment).
  const id = await db.transaction(async (trx) => {
    await assertImportWithinCap(trx, data);
    const [{ id }] = await trx('employees').insert(data).returning('id');
    return id;
  });
  return getEmployee(id);
}

// ─── Bulk CSV upload ───

// Normalises a date cell to YYYY-MM-DD. Accepts YYYY-MM-DD, dd-mm-yyyy, dd/mm/yyyy.
function normalizeDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.replace(/\//g, '-').match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    const d = m[1].padStart(2, '0');
    const mo = m[2].padStart(2, '0');
    let y = m[3];
    if (y.length === 2) y = (Number(y) > 50 ? '19' : '20') + y;
    return `${y}-${mo}-${d}`;
  }
  return s; // pass through; DB stores text
}

const HEADER_ALIASES: Record<string, string> = {
  emp_code: 'employee_code', employee_code: 'employee_code', code: 'employee_code',
  first_name: 'first_name', firstname: 'first_name',
  last_name: 'last_name', lastname: 'last_name',
  email: 'email', phone: 'phone', mobile: 'phone',
  date_of_joining: 'date_of_joining', doj: 'date_of_joining', joining_date: 'date_of_joining',
  date_of_birth: 'date_of_birth', dob: 'date_of_birth',
  father_name: 'father_name', fathers_name: 'father_name',
  aadhaar_number: 'aadhaar_number', aadhaar: 'aadhaar_number', aadhar: 'aadhaar_number',
  pan_number: 'pan_number', pan: 'pan_number', pan_card: 'pan_number', pan_card_no: 'pan_number',
  department: 'dept_name', dept_name: 'dept_name', dept: 'dept_name',
  branch: 'branch_name', branch_name: 'branch_name', property: 'branch_name', location: 'branch_name',
  designation: 'job_title', job_title: 'job_title', title: 'job_title', role: 'job_title',
  reporting_manager_code: 'reporting_manager_code', manager_code: 'reporting_manager_code',
  is_active: 'is_active', status: 'is_active', active: 'is_active',
  monthly_ctc: 'monthly_ctc', ctc: 'monthly_ctc', salary: 'monthly_ctc', monthly_salary: 'monthly_ctc',
};

export async function bulkUploadEmployees(csvContent: string) {
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row'), { status: 400 });

  const rawHeader = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const header = rawHeader.map(h => HEADER_ALIASES[h] || h);
  if (!header.includes('employee_code')) throw Object.assign(new Error('CSV must have an "Employee Code" column'), { status: 400 });
  if (!header.includes('first_name')) throw Object.assign(new Error('CSV must have a "First Name" column'), { status: 400 });

  // Lookups
  const jobTitles = await db('job_titles').select('id', 'title');
  const jtMap = new Map<string, number>(jobTitles.map((j: any) => [String(j.title).trim().toLowerCase(), j.id]));

  const results = { total: 0, created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, idx) => { row[h] = cols[idx] ?? ''; });
    results.total++;
    const rowNo = i + 1;

    const employee_code = row.employee_code?.trim();
    const first_name = row.first_name?.trim();
    if (!employee_code || !first_name) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: missing employee_code or first_name`);
      continue;
    }

    // Build the patch from provided columns only
    const data: any = { employee_code, first_name };
    if (row.last_name !== undefined) data.last_name = row.last_name?.trim() || '';
    if (row.email) data.email = row.email.trim();
    if (row.phone) data.phone = row.phone.trim();
    if (row.dept_name) data.dept_name = row.dept_name.trim();
    if (row.branch_name) data.branch_name = row.branch_name.trim();
    if (row.father_name) data.father_name = row.father_name.trim();
    if (row.aadhaar_number) data.aadhaar_number = row.aadhaar_number.trim();
    if (row.pan_number) {
      const pan = row.pan_number.trim().toUpperCase();
      if (!PAN_PATTERN.test(pan)) {
        results.skipped++;
        results.errors.push(`Row ${rowNo}: "${pan}" is not a valid PAN — it should look like ABCDE1234F`);
        continue;
      }
      data.pan_number = pan;
    }
    const doj = normalizeDate(row.date_of_joining);
    if (doj) data.date_of_joining = doj;
    const dob = normalizeDate(row.date_of_birth);
    if (dob) data.date_of_birth = dob;
    if (row.is_active !== undefined && row.is_active !== '') {
      data.is_active = /^(1|true|active|yes|y)$/i.test(row.is_active.trim());
    }
    if (row.monthly_ctc) {
      const ctc = Number(row.monthly_ctc.replace(/[,₹\s]/g, ''));
      if (!Number.isFinite(ctc) || ctc < 0) {
        results.skipped++;
        results.errors.push(`Row ${rowNo}: "${row.monthly_ctc}" is not a valid monthly CTC`);
        continue;
      }
      data.monthly_ctc = ctc;
    }
    if (row.job_title) {
      const jtId = jtMap.get(row.job_title.trim().toLowerCase());
      if (!jtId) { results.skipped++; results.errors.push(`Row ${rowNo}: unknown job title "${row.job_title}"`); continue; }
      data.job_title_id = jtId;
    }
    if (row.reporting_manager_code) {
      const mgr = await db('employees').where('employee_code', row.reporting_manager_code.trim()).first();
      if (mgr) data.reporting_manager_id = mgr.id;
    }

    try {
      const existing = await db('employees').where('employee_code', employee_code).first();
      if (data.email) {
        const emailOwner = await db('employees').where('email', data.email)
          .modify((q: any) => { if (existing) q.whereNot('id', existing.id); }).first();
        if (emailOwner) { results.skipped++; results.errors.push(`Row ${rowNo}: email "${data.email}" already in use`); continue; }
      }

      if (existing) {
        await db('employees').where('id', existing.id).update({ ...data, updated_at: db.fn.now() });
        results.updated++;
      } else {
        if (!data.date_of_joining) data.date_of_joining = new Date().toISOString().split('T')[0];
        if (data.is_active === undefined) data.is_active = true;
        data.job_id = await nextJobId(db);
        if (data.leave_template_id == null) data.leave_template_id = await getDefaultTemplateId(); // land on Default
        // Cap check + insert in one advisory-locked transaction (see createEmployee). A breach throws,
        // rolling back this row's insert; the catch below records it as skipped + reports the reason.
        await db.transaction(async (trx) => {
          await assertImportWithinCap(trx, data);
          await trx('employees').insert(data);
        });
        results.created++;
      }
    } catch (e: any) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Identity facts that are captured once, from documents, and never edited afterwards.
 *
 * Name, father's name, date of birth, gender and PAN come off the UID/PAN card during
 * onboarding — correcting them later means the record no longer matches the document it was
 * verified against. Date of joining is set by the hire itself, at the end of recruitment, and
 * changing it silently moves someone's payable days and their leave accrual.
 *
 * Stripped on the SERVER, not just hidden in the form. Hiding a field in the UI stops nobody
 * from sending it — the edit screen is one `PUT` away from anything a browser can post.
 *
 * They are still settable at CREATE, and by the bulk uploader, which is how they get in.
 */
const FIXED_AT_ONBOARDING = [
  'father_name', 'date_of_birth', 'gender', 'pan_number', 'date_of_joining',
] as const;

export async function updateEmployee(id: number, data: any) {
  await db('employees').where('id', id).first().then(e => {
    if (!e) throw Object.assign(new Error('Employee not found'), { status: 404 });
  });

  if (data.email) {
    const emailExists = await db('employees').where('email', data.email).whereNot('id', id).first();
    if (emailExists) throw Object.assign(new Error('Email already in use'), { status: 409 });
  }

  // Drop rather than reject: the edit form posts the whole record back, so these arrive on
  // every save even when untouched. Rejecting would fail ordinary edits.
  const patch: any = { ...data };
  for (const f of FIXED_AT_ONBOARDING) delete patch[f];

  normalizeGender(patch);
  await db('employees').where('id', id).update({ ...patch, updated_at: db.fn.now() });
  return getEmployee(id);
}

export async function updateMyProfile(employeeId: number, data: any) {
  const allowed = ['phone', 'father_name', 'aadhaar_number'];
  const filtered: any = {};
  for (const key of allowed) {
    if (data[key] !== undefined) filtered[key] = data[key];
  }

  if (Object.keys(filtered).length === 0) {
    throw Object.assign(new Error('No updatable fields provided'), { status: 400 });
  }

  await db('employees').where('id', employeeId).update({ ...filtered, updated_at: db.fn.now() });
  return getEmployee(employeeId);
}

export async function deleteEmployee(id: number) {
  const emp = await db('employees').where('id', id).first();
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  await db('employees').where('id', id).update({ is_active: false, updated_at: db.fn.now() });
  return { message: 'Employee deactivated' };
}

export async function getManagers() {
  return db('employees')
    .where('is_active', true)
    .select('id', 'first_name', 'last_name', 'employee_code')
    .orderBy('first_name');
}

// ─── Bulk upload history (persisted so HR can act on skipped rows later) ───

export interface EmployeeUploadLogEntry {
  uploaded_by?: number | null;
  uploaded_by_email?: string | null;
  file_name?: string | null;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  errors?: string[];
  status: 'success' | 'partial' | 'failed';
  error_note?: string | null;
}

/** Records one bulk-upload run. Fire-and-forget — never throws into the caller. */
export async function logEmployeeUpload(entry: EmployeeUploadLogEntry) {
  try {
    const { errors, ...rest } = entry;
    await db('employee_upload_logs').insert({ ...rest, errors: JSON.stringify(errors ?? []) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[employee upload log] failed:', (err as Error).message);
  }
}

/** Most-recent bulk-upload runs, newest first, with errors parsed back to string[]. */
export async function listEmployeeUploadLogs(limit = 50) {
  const rows = await db('employee_upload_logs')
    .select('*')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(Math.min(200, limit));
  return rows.map((r: any) => {
    let errors: string[] = [];
    try { errors = r.errors ? JSON.parse(r.errors) : []; } catch { errors = []; }
    return { ...r, errors };
  });
}
