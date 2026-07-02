import db from '../config/database';
import { nextJobId } from '../utils/jobId';

export async function listEmployees(filters: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  // Shared WHERE builder so the count and the page use identical filters
  const applyFilters = (q: any) => {
    if (filters.search) {
      q.where(function (this: any) {
        this.where('e.first_name', 'like', `%${filters.search}%`)
          .orWhere('e.last_name', 'like', `%${filters.search}%`)
          .orWhere('e.employee_code', 'like', `%${filters.search}%`)
          .orWhere('e.email', 'like', `%${filters.search}%`);
      });
    }
    if (filters.status === 'active') q.where('e.is_active', true);
    else if (filters.status === 'inactive') q.where('e.is_active', false);
    return q;
  };

  const baseQuery = () =>
    db('employees as e')
      .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
      .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'e.email', 'e.phone', 'e.date_of_birth', 'e.date_of_joining',
        'e.father_name', 'e.aadhaar_number', 'e.dept_name', 'e.branch_name',
        'e.is_active',
        'j.title as designation_name',
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

export async function getEmployee(id: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as j', 'j.id', 'e.job_title_id')
    .leftJoin('employees as mgr', 'mgr.id', 'e.reporting_manager_id')
    .where('e.id', id)
    .select(
      'e.*',
      'j.title as designation_name',
      'mgr.first_name as manager_first_name',
      'mgr.last_name as manager_last_name',
    )
    .first();

  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  return emp;
}

export async function createEmployee(data: any) {
  const existing = await db('employees').where('employee_code', data.employee_code).first();
  if (existing) throw Object.assign(new Error('Employee code already exists'), { status: 409 });

  if (data.email) {
    const emailExists = await db('employees').where('email', data.email).first();
    if (emailExists) throw Object.assign(new Error('Email already in use'), { status: 409 });
  }

  if (!data.job_id) data.job_id = await nextJobId(db);
  const [id] = await db('employees').insert(data);
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
  department: 'dept_name', dept_name: 'dept_name', dept: 'dept_name',
  branch: 'branch_name', branch_name: 'branch_name', property: 'branch_name', location: 'branch_name',
  designation: 'job_title', job_title: 'job_title', title: 'job_title', role: 'job_title',
  reporting_manager_code: 'reporting_manager_code', manager_code: 'reporting_manager_code',
  is_active: 'is_active', status: 'is_active', active: 'is_active',
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
    const doj = normalizeDate(row.date_of_joining);
    if (doj) data.date_of_joining = doj;
    const dob = normalizeDate(row.date_of_birth);
    if (dob) data.date_of_birth = dob;
    if (row.is_active !== undefined && row.is_active !== '') {
      data.is_active = /^(1|true|active|yes|y)$/i.test(row.is_active.trim());
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
        await db('employees').insert(data);
        results.created++;
      }
    } catch (e: any) {
      results.skipped++;
      results.errors.push(`Row ${rowNo}: ${e.message}`);
    }
  }

  return results;
}

export async function updateEmployee(id: number, data: any) {
  await db('employees').where('id', id).first().then(e => {
    if (!e) throw Object.assign(new Error('Employee not found'), { status: 404 });
  });

  if (data.email) {
    const emailExists = await db('employees').where('email', data.email).whereNot('id', id).first();
    if (emailExists) throw Object.assign(new Error('Email already in use'), { status: 409 });
  }

  await db('employees').where('id', id).update({ ...data, updated_at: db.fn.now() });
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
