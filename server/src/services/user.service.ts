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
 * Every login with its shareable onboarding credential, for Admin → User Credentials.
 * `initial_password` is the plaintext the admin last set (or the known seed password);
 * it is null once the user changes their own password — the UI shows that as
 * "changed by user". Admin-only: the plaintext is returned by no other endpoint.
 */
export async function listCredentials() {
  return db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .leftJoin('employees', 'employees.id', 'users.employee_id')
    .select(
      'users.id',
      'users.email',
      'users.is_active',
      'users.initial_password',
      'users.updated_at',
      'roles.name as role_name',
      'employees.id as employee_id',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
    )
    .orderBy([
      { column: 'users.is_active', order: 'desc' },
      { column: 'employees.first_name' },
      { column: 'users.email' },
    ]);
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
