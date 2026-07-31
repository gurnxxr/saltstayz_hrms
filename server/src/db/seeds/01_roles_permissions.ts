import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('role_permissions').del();
  await knex('permissions').del();

  // Upsert roles by name — never DELETE them, since users FK-reference roles
  // (deleting fails on a populated DB and would half-wipe RBAC). This keeps the
  // seed safe to re-run via `db:seed` as well as `db:reset`.
  const ROLE_DEFS = [
    { name: 'admin', description: 'Full system access' },
    { name: 'chro', description: 'Chief HR Officer - all HR modules + shift approval' },
    { name: 'hr', description: 'HR staff - all modules except permissions' },
    { name: 'hr_manager', description: 'HR Manager - Employee Mgmt, Onboarding, Analytics, Hiring' },
    { name: 'cluster_hr', description: 'Cluster HR - hiring within sanction for assigned cluster(s)' },
    { name: 'property_manager', description: 'Property Manager - Attendance and Shifts for own property' },
    { name: 'employee', description: 'Employee - Self-service access' },
    { name: 'finance', description: 'Finance - Payroll and Reports' },
  ];
  for (const r of ROLE_DEFS) {
    const existing = await knex('roles').where('name', r.name).first();
    if (existing) await knex('roles').where('id', existing.id).update({ description: r.description });
    else await knex('roles').insert(r);
  }

  const roles = await knex('roles').select('id', 'name');
  const roleMap: Record<string, number> = {};
  roles.forEach((r: any) => { roleMap[r.name] = r.id; });

  const modules = [
    'employees', 'attendance', 'leave', 'shifts', 'onboarding',
    'recruitment', 'analytics', 'reports', 'payroll', 'admin',
    'admin.users', 'permissions', 'manpower',
  ];
  const actions = ['create', 'read', 'update', 'delete', 'approve'];

  const permRows: { module: string; action: string }[] = [];
  modules.forEach(mod => {
    actions.forEach(act => {
      permRows.push({ module: mod, action: act });
    });
  });
  // Org-only analytics access (attrition, headcount, org-wide attendance).
  permRows.push({ module: 'analytics', action: 'read_org' });

  // Task 23 — the final Module Access list adds nav / self-service module keys that
  // aren't route-gating modules above. Each needs a `read` permission granted to the
  // roles that see it by default, so Admin → Module Access shows the right role
  // default (and the deny toggle works). Mirrored idempotently in migration
  // 077_module_access_final.ts so a migrated DB matches a freshly seeded one.
  const NAV_MODULE_ROLES: Record<string, string[]> = {
    dashboard_admin: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'finance'],
    dashboard_employee: ['employee'],
    employee_lifecycle: ['admin', 'chro', 'hr', 'hr_manager'],
    salary: ['admin', 'chro', 'hr', 'finance', 'employee'],
    my_shifts: ['admin', 'chro', 'hr', 'hr_manager', 'cluster_hr', 'property_manager', 'employee', 'finance'],
  };
  Object.keys(NAV_MODULE_ROLES).forEach(mod => permRows.push({ module: mod, action: 'read' }));

  // `payroll_setup` gates the org-wide payroll configuration screens (Statutory
  // Components, Pay Schedule, Attendance Pay Rules, Salary Component catalog). Those
  // routes pair authorize('payroll_setup', …) with the authorizeRoles('admin','finance')
  // gate they already had — BOTH must pass — so the grant list below is deliberately
  // identical to that role gate: admin and finance, nobody else. Mirrored idempotently
  // in migration 024_payroll_setup_module.ts so a migrated DB matches a seeded one.
  const PAYROLL_SETUP_ROLES = ['admin', 'finance'];
  ['create', 'read', 'update', 'delete'].forEach(act => permRows.push({ module: 'payroll_setup', action: act }));

  const perms = await knex('permissions').insert(permRows).returning('*');
  const permMap: Record<string, number> = {};
  perms.forEach((p: any) => { permMap[`${p.module}:${p.action}`] = p.id; });

  const rpRows: { role_id: number; permission_id: number }[] = [];

  function grant(role: string, mod: string, acts: string[]) {
    acts.forEach(act => {
      const key = `${mod}:${act}`;
      if (permMap[key] && roleMap[role]) {
        rpRows.push({ role_id: roleMap[role], permission_id: permMap[key] });
      }
    });
  }

  const crud = ['create', 'read', 'update', 'delete'];
  const crudApprove = [...crud, 'approve'];

  // Admin: everything
  modules.forEach(mod => grant('admin', mod, crudApprove));

  // CHRO: everything except admin.users and permissions.
  // manpower:approve is deliberately withheld — an over-limit hiring exception can be approved
  // ONLY by Admin (and never by its own requester: maker≠checker), enforced at the route with
  // authorizeRoles('admin'). Granting approve here would be dead, misleading config.
  modules.filter(m => m !== 'admin.users' && m !== 'permissions').forEach(mod => {
    grant('chro', mod, mod === 'manpower' ? crud : crudApprove);
  });

  // HR: everything except permissions and admin.users (manpower:approve withheld — see CHRO note).
  modules.filter(m => m !== 'permissions' && m !== 'admin.users').forEach(mod => {
    grant('hr', mod, mod === 'manpower' ? crud : crudApprove);
  });

  // HR Manager
  grant('hr_manager', 'employees', ['read']);
  grant('hr_manager', 'onboarding', crud);
  grant('hr_manager', 'recruitment', ['read']);
  grant('hr_manager', 'analytics', ['read']);

  // Cluster HR — hire within sanction for assigned cluster(s); raise exceptions;
  // change status. Sanction edits + exception approvals are admin-only (route gate).
  grant('cluster_hr', 'manpower', ['read', 'create', 'update']);
  grant('cluster_hr', 'employees', ['read']);
  grant('cluster_hr', 'recruitment', ['read']);

  // Property Manager
  grant('property_manager', 'attendance', crud);
  grant('property_manager', 'leave', ['read', 'create', 'update']);
  grant('property_manager', 'shifts', ['read', 'create']);
  grant('property_manager', 'reports', ['read']);
  grant('property_manager', 'employees', ['read']);
  // Read-only budget; can initiate status changes for own property.
  grant('property_manager', 'manpower', ['read', 'update']);

  // Employee
  grant('employee', 'attendance', ['create', 'read']);
  grant('employee', 'leave', ['create', 'read', 'update']);
  grant('employee', 'shifts', ['read']);
  grant('employee', 'employees', ['read', 'update']);
  grant('employee', 'payroll', ['read']);
  grant('employee', 'analytics', ['read']);

  // Finance
  grant('finance', 'payroll', crud);
  grant('finance', 'reports', ['read']);
  grant('finance', 'employees', ['read']);

  // Org-level analytics — admin/CHRO/HR/HR-manager only (employees keep analytics:read for /me).
  ['admin', 'chro', 'hr', 'hr_manager'].forEach(role => grant(role, 'analytics', ['read_org']));

  // Nav / self-service module read-access (final Module Access list, Task 23).
  for (const [mod, rolesForMod] of Object.entries(NAV_MODULE_ROLES)) {
    rolesForMod.forEach(role => grant(role, mod, ['read']));
  }

  // Payroll configuration — admin + finance only (see PAYROLL_SETUP_ROLES note above).
  PAYROLL_SETUP_ROLES.forEach(role => grant(role, 'payroll_setup', crud));

  await knex('role_permissions').insert(rpRows);
}
