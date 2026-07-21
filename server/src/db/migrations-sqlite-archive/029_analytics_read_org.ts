import type { Knex } from 'knex';

// Splits analytics access: org-level endpoints now require analytics:read_org
// (granted to admin/chro/hr/hr_manager), while employees keep analytics:read for
// their personal /analytics/me views only. Additive + idempotent — no re-seed.
const ORG_ROLES = ['admin', 'chro', 'hr', 'hr_manager'];

export async function up(knex: Knex): Promise<void> {
  let perm = await knex('permissions').where({ module: 'analytics', action: 'read_org' }).first();
  if (!perm) {
    const [id] = await knex('permissions').insert({ module: 'analytics', action: 'read_org' });
    perm = { id };
  }

  for (const roleName of ORG_ROLES) {
    const role = await knex('roles').where('name', roleName).first();
    if (!role) continue;
    const existing = await knex('role_permissions').where({ role_id: role.id, permission_id: perm.id }).first();
    if (!existing) {
      await knex('role_permissions').insert({ role_id: role.id, permission_id: perm.id });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  const perm = await knex('permissions').where({ module: 'analytics', action: 'read_org' }).first();
  if (!perm) return;
  await knex('role_permissions').where('permission_id', perm.id).del();
  await knex('permissions').where('id', perm.id).del();
}
