import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

// The list of modules whose access an admin can grant/revoke per employee
// (mirrors the sidebar). Two kinds of key live here:
//
//   API-gating — a matching authorize('<key>', …) sits on the routes, so a toggle
//   here changes both what the person sees AND what the API lets them do:
//     analytics, attendance, leave, recruitment, payroll, salary, shifts, admin,
//     employees, onboarding, manpower, finance, admin.users, payroll_setup,
//     employee_lifecycle
//
//   Nav-only — no route carries the key, so the toggle governs sidebar
//   visibility alone:
//     dashboard_admin, dashboard_employee, my_shifts
//
// See migration 077 (archived) / 024_payroll_setup_module.ts / seed 01 for the role defaults.
export const ACCESS_MODULES = [
  'dashboard_admin', 'dashboard_employee', 'analytics', 'attendance', 'leave',
  'recruitment', 'employee_lifecycle', 'payroll', 'salary', 'shifts', 'my_shifts', 'admin',
  'employees', 'onboarding', 'manpower', 'finance', 'admin.users', 'payroll_setup',
] as const;

/** Raw per-employee overrides as granted/denied module-name lists. */
export async function getEmployeeOverrides(employeeId: number): Promise<{ granted: string[]; denied: string[] }> {
  const rows = await db('employee_module_access').where('employee_id', employeeId).select('module', 'allowed');
  return {
    granted: rows.filter((r: any) => r.allowed).map((r: any) => r.module),
    denied: rows.filter((r: any) => !r.allowed).map((r: any) => r.module),
  };
}

/** Modules a role can read (used as the per-employee default). */
async function roleReadModules(roleId: number): Promise<Set<string>> {
  const rows = await db('role_permissions as rp')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('rp.role_id', roleId)
    .andWhere('p.action', 'read')
    .pluck('p.module');
  return new Set(rows);
}

export async function searchEmployees(q?: string) {
  const query = db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('users as u', 'u.employee_id', 'e.id')
    .where('e.is_active', true)
    .select(
      'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
      'e.dept_name', 'e.branch_name', 'jt.title as designation',
      db.raw('case when u.id is not null then 1 else 0 end as has_login'),
    )
    .orderBy('e.first_name')
    .limit(30);

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query.where(function (this: any) {
      this.where('e.first_name', 'ilike', term)
        .orWhere('e.last_name', 'ilike', term)
        .orWhere('e.employee_code', 'ilike', term)
        .orWhere('jt.title', 'ilike', term)
        .orWhereRaw("(e.first_name || ' ' || e.last_name) ilike ?", [term]);
    });
  }
  return query;
}

/** Per-module access detail for one employee: role default, override state, and effective value. */
export async function getEmployeeAccess(employeeId: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.id', employeeId)
    .select('e.id', 'e.employee_code', 'e.first_name', 'e.last_name', 'e.dept_name', 'e.branch_name', 'jt.title as designation')
    .first();
  if (!emp) throw new NotFoundError('Employee');

  const user = await db('users as u').leftJoin('roles as r', 'r.id', 'u.role_id')
    .where('u.employee_id', employeeId)
    .select('u.id', 'u.role_id', 'r.name as role_name')
    .first();

  const roleModules = user ? await roleReadModules(user.role_id) : new Set<string>();
  const overrides = await db('employee_module_access').where('employee_id', employeeId).select('module', 'allowed');
  const ovMap = new Map<string, boolean>(overrides.map((o: any) => [o.module, !!o.allowed]));

  const modules = ACCESS_MODULES.map((m) => {
    const roleDefault = roleModules.has(m);
    const override = ovMap.has(m) ? ovMap.get(m)! : null;
    return { module: m, roleDefault, override, effective: override === null ? roleDefault : override };
  });

  return {
    employee: emp,
    hasLogin: !!user,
    role: user?.role_name ?? null,
    modules,
  };
}

/** Sets (allowed=true/false) or clears (allowed=null) a per-employee module override. */
export async function setEmployeeAccess(employeeId: number, module: string, allowed: boolean | null, updatedBy?: number | null) {
  if (!ACCESS_MODULES.includes(module as any)) throw new ValidationError(`Unknown module: ${module}`);
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');

  if (allowed === null) {
    await db('employee_module_access').where({ employee_id: employeeId, module }).del();
    return getEmployeeAccess(employeeId);
  }

  const existing = await db('employee_module_access').where({ employee_id: employeeId, module }).first();
  if (existing) {
    await db('employee_module_access').where('id', existing.id)
      .update({ allowed: allowed ? true : false, updated_by: updatedBy ?? null, updated_at: db.fn.now() });
  } else {
    await db('employee_module_access').insert({ employee_id: employeeId, module, allowed: allowed ? true : false, updated_by: updatedBy ?? null });
  }
  return getEmployeeAccess(employeeId);
}

/** Removes all overrides for an employee (revert to role defaults). */
export async function resetEmployeeAccess(employeeId: number) {
  await db('employee_module_access').where('employee_id', employeeId).del();
  return getEmployeeAccess(employeeId);
}
