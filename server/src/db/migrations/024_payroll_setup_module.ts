import type { Knex } from 'knex';

/**
 * Mints the `payroll_setup` module so Admin → Module Access can govern the org-wide
 * payroll configuration screens (Statutory Components, Pay Schedule, Attendance Pay
 * Rules, Salary Component catalog).
 *
 * Until now those four route files carried only `authorizeRoles('admin', 'finance')`,
 * with no `authorize()` at all — so a Module Access DENY had nothing to bite on. The
 * routes now pair the role gate with `authorize('payroll_setup', …)`; BOTH must pass.
 *
 * Because both gates must pass, the grant list here is deliberately identical to the
 * role gate it sits beside: admin and finance, nobody else. Granting a third role
 * would be dead config — `authorizeRoles('admin', 'finance')` would still reject it —
 * and granting fewer would silently revoke access from admin or finance.
 *
 * Additive + idempotent (safe to re-run), and mirrored in seed
 * 01_roles_permissions.ts so a freshly seeded DB matches a migrated one.
 */
const MODULE = 'payroll_setup';
const ACTIONS = ['read', 'create', 'update', 'delete'];
const ROLES = ['admin', 'finance'];

export async function up(knex: Knex): Promise<void> {
  let permsCreated = 0;
  let grantsCreated = 0;

  for (const action of ACTIONS) {
    let perm = await knex('permissions').where({ module: MODULE, action }).first();
    if (!perm) {
      const [row] = await knex('permissions').insert({ module: MODULE, action }).returning('id');
      perm = { id: row.id };
      permsCreated++;
    }

    for (const roleName of ROLES) {
      const role = await knex('roles').where('name', roleName).first();
      if (!role) continue;
      const existing = await knex('role_permissions')
        .where({ role_id: role.id, permission_id: perm.id })
        .first();
      if (!existing) {
        await knex('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
        grantsCreated++;
      }
    }
  }

  console.log(
    permsCreated === 0 && grantsCreated === 0
      ? `  ${MODULE}: already present — created 0 permissions, 0 role grants.`
      : `  ${MODULE}: created ${permsCreated} permission(s) and ${grantsCreated} role grant(s) (${ROLES.join(', ')}).`,
  );
}

export async function down(knex: Knex): Promise<void> {
  const permIds = await knex('permissions').where('module', MODULE).pluck('id');
  if (!permIds.length) return;
  await knex('role_permissions').whereIn('permission_id', permIds).del();
  await knex('permissions').whereIn('id', permIds).del();
  console.log(`  ${MODULE}: removed ${permIds.length} permission(s) and their role grants.`);
}
