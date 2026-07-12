import type { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  await knex('departments').del();
  await knex('properties').del();
  await knex('employee_categories').del();
  await knex('job_titles').del();
  await knex('pay_grades').del();
  await knex('employment_statuses').del();

  await knex('properties').insert([
    { name: 'SaltStayz Hauz Khas', address: 'Hauz Khas Village', city: 'New Delhi', state: 'Delhi' },
    { name: 'SaltStayz Connaught Place', address: 'Block A, CP', city: 'New Delhi', state: 'Delhi' },
    { name: 'SaltStayz Gurgaon', address: 'Sector 29', city: 'Gurgaon', state: 'Haryana' },
  ]);

  // Departments are organization-wide (shared across all properties). This list
  // must cover every dept_name the employee seeds use (see 09_property_employees),
  // so the catalog matches reality out of the box — "Security" included.
  await knex('departments').insert([
    { name: 'Housekeeping' },
    { name: 'Food & Beverage' },
    { name: 'Front Desk' },
    { name: 'Management' },
    { name: 'Security' },
  ]);

  await knex('employee_categories').insert([
    { name: 'Housekeeping Staff' },
    { name: 'F&B Staff' },
    { name: 'Property Manager' },
    { name: 'Corporate' },
  ]);

  await knex('job_titles').insert([
    { title: 'Housekeeping Attendant' },
    { title: 'Housekeeping Supervisor' },
    { title: 'F&B Server' },
    { title: 'F&B Manager' },
    { title: 'Front Desk Executive' },
    { title: 'Front Office Manager' },
    { title: 'Property Manager' },
    { title: 'HR Manager' },
    { title: 'HR Executive' },
    { title: 'Finance Executive' },
    { title: 'CHRO' },
  ]);

  await knex('pay_grades').insert([
    { name: 'Grade A', min_salary: 15000, max_salary: 25000 },
    { name: 'Grade B', min_salary: 25000, max_salary: 45000 },
    { name: 'Grade C', min_salary: 45000, max_salary: 75000 },
    { name: 'Grade D', min_salary: 75000, max_salary: 150000 },
  ]);

  await knex('employment_statuses').insert([
    { name: 'Probation' },
    { name: 'Confirmed' },
    { name: 'Notice Period' },
    { name: 'Terminated' },
    { name: 'Absconding' },
  ]);
}
