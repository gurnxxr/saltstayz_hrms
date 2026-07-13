import db from '../config/database';
import bcrypt from 'bcryptjs';
import { NotFoundError, ValidationError } from '../utils/errors';

export async function listUsers(filters: { search?: string; role_id?: string; is_active?: string }) {
  const query = db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .leftJoin('employees', 'employees.id', 'users.employee_id')
    .leftJoin('job_titles', 'job_titles.id', 'employees.job_title_id')
    .select(
      'users.id',
      'users.email',
      'users.role_id',
      'users.employee_id',
      'users.is_active',
      'users.created_at',
      'users.updated_at',
      'roles.name as role_name',
      'roles.description as role_description',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'employees.dept_name',
      'employees.branch_name',
      'employees.job_title_id',
      'job_titles.title as designation'
    )
    .orderBy('users.created_at', 'desc');

  if (filters.search) {
    query.where(function () {
      this.where('users.email', 'like', `%${filters.search}%`)
        .orWhere('employees.first_name', 'like', `%${filters.search}%`)
        .orWhere('employees.last_name', 'like', `%${filters.search}%`)
        .orWhere('employees.employee_code', 'like', `%${filters.search}%`);
    });
  }
  if (filters.role_id) query.where('users.role_id', filters.role_id);
  if (filters.is_active !== undefined && filters.is_active !== '') {
    query.where('users.is_active', filters.is_active === 'true' ? 1 : 0);
  }

  return query;
}

export async function getUser(id: number) {
  const user = await db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .leftJoin('employees', 'employees.id', 'users.employee_id')
    .leftJoin('job_titles', 'job_titles.id', 'employees.job_title_id')
    .where('users.id', id)
    .select(
      'users.id',
      'users.email',
      'users.role_id',
      'users.employee_id',
      'users.is_active',
      'users.created_at',
      'users.updated_at',
      'roles.name as role_name',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'employees.phone',
      'employees.date_of_joining',
      'employees.dept_name',
      'employees.branch_name',
      'job_titles.title as job_title'
    )
    .first();

  if (!user) throw new NotFoundError('User');
  return user;
}

export async function createUser(data: {
  email: string;
  password: string;
  role_id: number;
  employee_id?: number | null;
}) {
  const existing = await db('users').where('email', data.email).first();
  if (existing) throw new ValidationError('A user with this email already exists');

  if (data.employee_id) {
    const empUser = await db('users').where('employee_id', data.employee_id).first();
    if (empUser) throw new ValidationError('This employee already has a user account');
  }

  const password_hash = await bcrypt.hash(data.password, 12);
  const [id] = await db('users').insert({
    email: data.email,
    password_hash,
    role_id: data.role_id,
    employee_id: data.employee_id || null,
    // Keep the admin-set plaintext so it can be copied & shared with the new hire
    // (Admin → User Credentials). Cleared once the user changes their own password.
    initial_password: data.password,
  });

  return getUser(id);
}

export async function updateUser(id: number, data: {
  email?: string;
  role_id?: number;
  employee_id?: number | null;
  is_active?: boolean;
  job_title_id?: number | null; // designation of the linked employee
}) {
  const user = await db('users').where('id', id).first();
  if (!user) throw new NotFoundError('User');

  if (data.email && data.email !== user.email) {
    const existing = await db('users').where('email', data.email).whereNot('id', id).first();
    if (existing) throw new ValidationError('A user with this email already exists');
  }

  if (data.employee_id && data.employee_id !== user.employee_id) {
    const empUser = await db('users').where('employee_id', data.employee_id).whereNot('id', id).first();
    if (empUser) throw new ValidationError('This employee already has a user account');
  }

  const updates: Record<string, any> = { updated_at: db.fn.now() };
  if (data.email !== undefined) updates.email = data.email;
  if (data.role_id !== undefined) updates.role_id = data.role_id;
  if (data.employee_id !== undefined) updates.employee_id = data.employee_id || null;
  if (data.is_active !== undefined) updates.is_active = data.is_active;

  await db('users').where('id', id).update(updates);

  // Designation lives on the linked employee record
  if (data.job_title_id !== undefined) {
    const targetEmployeeId = data.employee_id !== undefined ? (data.employee_id || null) : user.employee_id;
    if (targetEmployeeId) {
      await db('employees').where('id', targetEmployeeId)
        .update({ job_title_id: data.job_title_id || null, updated_at: db.fn.now() });
    }
  }

  return getUser(id);
}

/**
 * Module-level access per access level (role). A module is "accessible" to a role
 * if that role holds the module's `read` permission. Drives the access matrix that
 * shows which modules each designation/access level can reach.
 */
export async function getAccessMatrix() {
  const modules = [
    'employees', 'attendance', 'leave', 'shifts', 'onboarding',
    'recruitment', 'analytics', 'reports', 'payroll', 'admin',
  ];
  const roles = await db('roles').orderBy('id');
  const grants = await db('role_permissions as rp')
    .join('roles as r', 'r.id', 'rp.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('p.action', 'read')
    .select('r.name as role', 'p.module');

  const byRole: Record<string, Set<string>> = {};
  grants.forEach((g: any) => { (byRole[g.role] ??= new Set()).add(g.module); });

  return {
    modules,
    roles: roles.map((r: any) => ({
      name: r.name,
      description: r.description,
      access: Object.fromEntries(modules.map((m) => [m, byRole[r.name]?.has(m) ?? false])),
    })),
  };
}

export async function resetPassword(id: number, newPassword: string) {
  const user = await db('users').where('id', id).first();
  if (!user) throw new NotFoundError('User');

  const password_hash = await bcrypt.hash(newPassword, 12);
  await db('users').where('id', id).update({ password_hash, initial_password: newPassword, updated_at: db.fn.now() });
  return { message: 'Password reset successfully' };
}

/**
 * Every active EMPLOYEE with their login and shareable password, for Admin → User
 * Credentials. Employees without a login appear too (email/password null) so the admin
 * can spot who still needs one. `initial_password` is the plaintext the admin last set
 * (or the known seed password); it is null once the user changes their own password —
 * the UI shows that as "changed by user". Admin-only: the plaintext is returned nowhere else.
 */
export async function listCredentials() {
  const rows = await db('employees as e')
    .leftJoin('users as u', 'u.employee_id', 'e.id')
    .leftJoin('roles as r', 'r.id', 'u.role_id')
    .where('e.is_active', true)
    .select(
      'e.id as employee_id', 'e.first_name', 'e.last_name', 'e.employee_code', 'e.email as employee_email',
      'u.id as user_id', 'u.email as login_email', 'u.initial_password', 'u.is_active as user_active',
      'r.name as role_name',
    )
    .orderBy('e.first_name');

  return rows.map((row: any) => ({
    employee_id: row.employee_id,
    user_id: row.user_id ?? null,
    first_name: row.first_name,
    last_name: row.last_name,
    employee_code: row.employee_code,
    email: row.login_email || row.employee_email || null,
    role_name: row.role_name ?? null,
    initial_password: row.initial_password ?? null,
    has_login: !!row.user_id,
    is_active: !!row.user_active,
  }));
}

/** A unique, sensible login email for an employee who has none yet. */
async function deriveUniqueEmail(emp: any): Promise<string> {
  const clean = `${emp.first_name || ''}.${emp.last_name || ''}`.toLowerCase().replace(/[^a-z.]/g, '').replace(/^\.+|\.+$/g, '');
  const code = String(emp.employee_code || emp.id).toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = clean || `emp${code}`;
  const candidates = [
    emp.email && String(emp.email).includes('@') ? String(emp.email).trim().toLowerCase() : null,
    `${base}@saltstayz.com`,
    `${base}.${code}@saltstayz.com`,
    `emp${emp.id}@saltstayz.com`,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (!(await db('users').where('email', c).first())) return c;
  }
  return `emp${emp.id}.${Date.now()}@saltstayz.com`;
}

/**
 * Fill every gap on the credentials tab with the shared demo password 1234: create a
 * login (role "employee") for any active employee who has none, and set 1234 as the
 * shareable password for any login whose password isn't known (never set, or the user
 * changed it). Logins that already have a known password are left untouched. Idempotent.
 */
export async function fillMissingCredentials() {
  const employees = await db('employees').where('is_active', true)
    .select('id', 'first_name', 'last_name', 'employee_code', 'email');
  const role = await db('roles').where('name', 'employee').first();
  if (!role) throw new ValidationError('The "employee" role is missing.');
  // One hash, reused — everyone here shares the demo password 1234.
  const password_hash = await bcrypt.hash('1234', 12);

  let created = 0, updated = 0;
  for (const emp of employees) {
    const user = await db('users').where('employee_id', emp.id).first();
    if (!user) {
      const email = await deriveUniqueEmail(emp);
      await db('users').insert({ email, password_hash, initial_password: '1234', role_id: role.id, employee_id: emp.id });
      created += 1;
    } else if (!user.initial_password) {
      await db('users').where('id', user.id).update({ password_hash, initial_password: '1234', updated_at: db.fn.now() });
      updated += 1;
    }
  }
  return { created, updated, total: employees.length };
}

export async function deleteUser(id: number) {
  const user = await db('users').where('id', id).first();
  if (!user) throw new NotFoundError('User');
  await db('users').where('id', id).update({ is_active: false, updated_at: db.fn.now() });
  return { message: 'User deactivated' };
}

export async function getRoles() {
  return db('roles').orderBy('name');
}

export async function getUnlinkedEmployees() {
  return db('employees')
    .leftJoin('users', 'users.employee_id', 'employees.id')
    .whereNull('users.id')
    .where('employees.is_active', true)
    .select('employees.id', 'employees.first_name', 'employees.last_name', 'employees.employee_code', 'employees.email')
    .orderBy('employees.first_name');
}
