import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

/**
 * Creates login accounts for active employees that don't have one yet, with an
 * assorted spread of access levels (roles), so User Management is populated for
 * demos. Idempotent: skips employees already linked and emails already taken.
 * Capped to keep the dataset reasonable.
 */
const MAX_NEW_USERS = 15;
const ROLE_SPREAD = ['employee', 'employee', 'employee', 'property_manager', 'hr', 'finance', 'hr_manager'];

export async function seed(knex: Knex): Promise<void> {
  const roles = await knex('roles').select('id', 'name');
  const roleId: Record<string, number> = {};
  roles.forEach((r: any) => { roleId[r.name] = r.id; });

  const linked = await knex('users').whereNotNull('employee_id').pluck('employee_id');
  const candidates = await knex('employees')
    .where('is_active', true)
    .whereNotIn('id', linked.length ? linked : [0])
    .select('id', 'first_name', 'last_name', 'email')
    .orderBy('id')
    .limit(MAX_NEW_USERS);

  const passwordHash = await bcrypt.hash('1234', 12);
  let i = 0;
  for (const emp of candidates) {
    const base = `${emp.first_name}.${emp.last_name}`.toLowerCase().replace(/[^a-z.]/g, '');
    const email = (emp.email && emp.email.includes('@')) ? emp.email : `${base || 'user' + emp.id}@saltstayz.com`;

    const emailTaken = await knex('users').where('email', email).first();
    if (emailTaken) continue;

    const role = ROLE_SPREAD[i % ROLE_SPREAD.length];
    await knex('users').insert({
      email,
      password_hash: passwordHash,
      initial_password: '1234', // shareable seed credential for Admin → User Credentials
      role_id: roleId[role] ?? roleId['employee'],
      employee_id: emp.id,
    });
    i += 1;
  }
}
