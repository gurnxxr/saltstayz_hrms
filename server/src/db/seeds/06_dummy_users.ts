import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

/**
 * Gives every active employee a login so Admin → User Credentials shows a password
 * for all of them. The first few get an assorted spread of access levels (roles) for
 * demo realism; everyone else is a plain "employee". Password is the shared demo one
 * (1234), mirrored into initial_password so it's visible & shareable on the tab.
 * Idempotent: skips employees who already have a login.
 */
const ROLE_SPREAD = ['employee', 'employee', 'employee', 'property_manager', 'hr', 'finance', 'hr_manager'];

async function uniqueEmail(knex: Knex, emp: any): Promise<string> {
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
    if (!(await knex('users').where('email', c).first())) return c;
  }
  return `emp${emp.id}.x@saltstayz.com`;
}

export async function seed(knex: Knex): Promise<void> {
  const roles = await knex('roles').select('id', 'name');
  const roleId: Record<string, number> = {};
  roles.forEach((r: any) => { roleId[r.name] = r.id; });

  const linked = await knex('users').whereNotNull('employee_id').pluck('employee_id');
  const candidates = await knex('employees')
    .where('is_active', true)
    .whereNotIn('id', linked.length ? linked : [0])
    .select('id', 'first_name', 'last_name', 'employee_code', 'email')
    .orderBy('id');

  const passwordHash = await bcrypt.hash('1234', 12);
  let i = 0;
  for (const emp of candidates) {
    const email = await uniqueEmail(knex, emp);
    const role = i < ROLE_SPREAD.length ? ROLE_SPREAD[i] : 'employee';
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
