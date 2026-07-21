import type { Knex } from 'knex';

// Task 23 — the final Module Access list. Introduces the module keys the Admin →
// Module Access screen now grants/revokes but which the base RBAC seed never
// created: dashboard_admin, dashboard_employee, employee_lifecycle, salary,
// my_shifts. Each gets a `read` permission granted to the roles that see it by
// default, so the access screen shows the correct role default (and the deny
// toggle works). `salary` also gates the /payroll/me self-service routes.
//
// Additive + idempotent — safe to run on a populated DB and mirrored in
// seed 01_roles_permissions.ts so `db:reset` produces the same rows.
const NAV_MODULE_ROLES: Record<string, string[]> = {
  dashboard_admin: ['admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'finance'],
  dashboard_employee: ['employee'],
  employee_lifecycle: ['admin', 'chro', 'hr', 'hr_manager'],
  salary: ['admin', 'chro', 'hr', 'finance', 'employee'],
  my_shifts: ['admin', 'chro', 'hr', 'hr_manager', 'cluster_hr', 'property_manager', 'employee', 'finance'],
};

export async function up(knex: Knex): Promise<void> {
  for (const [module, roles] of Object.entries(NAV_MODULE_ROLES)) {
    let perm = await knex('permissions').where({ module, action: 'read' }).first();
    if (!perm) {
      const [id] = await knex('permissions').insert({ module, action: 'read' });
      perm = { id };
    }
    for (const roleName of roles) {
      const role = await knex('roles').where('name', roleName).first();
      if (!role) continue;
      const existing = await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).first();
      if (!existing) await knex('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const module of Object.keys(NAV_MODULE_ROLES)) {
    const perm = await knex('permissions').where({ module, action: 'read' }).first();
    if (!perm) continue;
    await knex('role_permissions').where('permission_id', perm.id).del();
    await knex('permissions').where('id', perm.id).del();
  }
}
