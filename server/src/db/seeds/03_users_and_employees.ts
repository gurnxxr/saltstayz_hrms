import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

export async function seed(knex: Knex): Promise<void> {
  await knex('users').del();
  await knex('employees').del();

  // bcrypt 12 rounds — matches the security checklist standard
  const passwordHash = await bcrypt.hash('1234', 12);

  const roles = await knex('roles').select('id', 'name');
  const roleMap: Record<string, number> = {};
  roles.forEach((r: any) => { roleMap[r.name] = r.id; });

  const properties = await knex('properties').select('id', 'name');
  const jobTitles = await knex('job_titles').select('id', 'title');

  // Post-migration employees table uses plain-text dept_name / branch_name
  // (the property_id / department_id / category_id / employment_status_id FKs
  // were dropped in migration 011). Branch defaults to the first property.
  const branch = properties[0]?.name || 'SaltStayz New Delhi';

  const jtMap: Record<string, number> = {};
  jobTitles.forEach((j: any) => { jtMap[j.title] = j.id; });

  // Create employees first (Admin / CHRO / HR / PM / Employee / Finance)
  const employees = await knex('employees').insert([
    {
      employee_code: 'SS-0001',
      first_name: 'Gurnoor',
      last_name: 'Singh',
      email: 'gurnoor@saltstayz.com',
      phone: '9999900001',
      date_of_joining: '2023-01-01',
      job_title_id: jtMap['CHRO'],
      dept_name: 'Management',
      branch_name: branch,
      is_active: true,
    },
    {
      employee_code: 'SS-0002',
      first_name: 'Priya',
      last_name: 'Sharma',
      email: 'chro@saltstayz.com',
      phone: '9999900002',
      date_of_joining: '2023-02-01',
      job_title_id: jtMap['CHRO'],
      dept_name: 'Management',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 1,
    },
    {
      employee_code: 'SS-0003',
      first_name: 'Anjali',
      last_name: 'Verma',
      email: 'hr@saltstayz.com',
      phone: '9999900003',
      date_of_joining: '2023-03-01',
      job_title_id: jtMap['HR Manager'],
      dept_name: 'Management',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 1,
    },
    {
      employee_code: 'SS-0004',
      first_name: 'Rajesh',
      last_name: 'Kumar',
      email: 'fo@saltstayz.com',
      phone: '9999900004',
      date_of_joining: '2023-04-01',
      job_title_id: jtMap['Property Manager'],
      dept_name: 'Front Desk',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 1,
    },
    {
      employee_code: 'SS-0005',
      first_name: 'Rahul',
      last_name: 'Gupta',
      email: 'employee@saltstayz.com',
      phone: '9999900005',
      date_of_joining: '2024-01-15',
      job_title_id: jtMap['Housekeeping Attendant'],
      dept_name: 'Housekeeping',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 4,
    },
    {
      employee_code: 'SS-0006',
      first_name: 'Neha',
      last_name: 'Agarwal',
      email: 'finance@saltstayz.com',
      phone: '9999900006',
      date_of_joining: '2023-06-01',
      job_title_id: jtMap['Finance Executive'],
      dept_name: 'Management',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 1,
    },
    {
      employee_code: 'SS-0007',
      first_name: 'Vikram',
      last_name: 'Mehta',
      email: 'clusterhr@saltstayz.com',
      phone: '9999900007',
      date_of_joining: '2023-07-01',
      job_title_id: jtMap['HR Executive'],
      dept_name: 'Management',
      branch_name: branch,
      is_active: true,
      reporting_manager_id: 3,
    },
  ]).returning('*');

  const empMap: Record<string, number> = {};
  employees.forEach((e: any) => { empMap[e.email] = e.id; });

  await knex('users').insert([
    { email: 'gurnoor@saltstayz.com', password_hash: passwordHash, role_id: roleMap['admin'], employee_id: empMap['gurnoor@saltstayz.com'] },
    { email: 'chro@saltstayz.com', password_hash: passwordHash, role_id: roleMap['chro'], employee_id: empMap['chro@saltstayz.com'] },
    { email: 'hr@saltstayz.com', password_hash: passwordHash, role_id: roleMap['hr'], employee_id: empMap['hr@saltstayz.com'] },
    { email: 'fo@saltstayz.com', password_hash: passwordHash, role_id: roleMap['property_manager'], employee_id: empMap['fo@saltstayz.com'] },
    { email: 'employee@saltstayz.com', password_hash: passwordHash, role_id: roleMap['employee'], employee_id: empMap['employee@saltstayz.com'] },
    { email: 'finance@saltstayz.com', password_hash: passwordHash, role_id: roleMap['finance'], employee_id: empMap['finance@saltstayz.com'] },
    { email: 'clusterhr@saltstayz.com', password_hash: passwordHash, role_id: roleMap['cluster_hr'], employee_id: empMap['clusterhr@saltstayz.com'] },
  ]);
}
