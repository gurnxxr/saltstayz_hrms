import type { Knex } from 'knex';

/**
 * Backfills realistic dummy values into every empty employee column, ties each
 * employee to a real property (branch_name), wires reporting managers, and gives
 * everyone a default shift assignment. Idempotent: only fills what is missing.
 * Deterministic from employee id so reruns are stable.
 */
const FATHER_FIRST = [
  'Ramesh', 'Suresh', 'Mahesh', 'Rajesh', 'Dinesh', 'Naresh', 'Mukesh',
  'Vinod', 'Ashok', 'Prakash', 'Sunil', 'Anil', 'Vijay', 'Sanjay', 'Rakesh',
];

const pad = (n: number, len: number) => String(Math.abs(Math.trunc(n))).padStart(len, '0').slice(-len);
const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === '';
const slug = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function seed(knex: Knex): Promise<void> {
  const properties: string[] = await knex('properties').where('is_active', true).orderBy('id').pluck('name');
  const shiftTypeIds: number[] = await knex('shift_types').where('is_active', true).orderBy('id').pluck('id');

  // ── 1) Fill scalar columns ──
  const employees = await knex('employees').select('id', 'first_name', 'last_name', 'employee_code', 'email', 'phone', 'date_of_birth', 'father_name', 'aadhaar_number', 'branch_name');
  for (const e of employees) {
    const patch: any = {};
    if (isEmpty(e.email)) {
      patch.email = `${slug(e.first_name) || 'emp'}.${slug(e.last_name) || 'x'}.${slug(e.employee_code) || e.id}@saltstayz.com`;
    }
    if (isEmpty(e.phone)) patch.phone = '9' + pad((e.id * 7919) % 1_000_000_000, 9);
    if (isEmpty(e.date_of_birth)) {
      patch.date_of_birth = `${1970 + (e.id % 33)}-${pad((e.id % 12) + 1, 2)}-${pad((e.id % 28) + 1, 2)}`;
    }
    if (isEmpty(e.father_name)) {
      patch.father_name = `Mr. ${FATHER_FIRST[e.id % FATHER_FIRST.length]} ${e.last_name || ''}`.trim();
    }
    if (isEmpty(e.aadhaar_number)) patch.aadhaar_number = pad(((e.id * 123457) % 900_000_000_000) + 100_000_000_000, 12);
    if (isEmpty(e.branch_name) && properties.length) patch.branch_name = properties[e.id % properties.length];

    if (Object.keys(patch).length) {
      await knex('employees').where('id', e.id).update({ ...patch, updated_at: knex.fn.now() });
    }
  }

  // ── 2) Reporting managers — the lowest-id active employee in each branch is its manager ──
  const active = await knex('employees').where('is_active', true).orderBy('id').select('id', 'branch_name', 'reporting_manager_id');
  const managerByBranch = new Map<string, number>();
  for (const e of active) {
    if (e.branch_name && !managerByBranch.has(e.branch_name)) managerByBranch.set(e.branch_name, e.id);
  }
  for (const e of active) {
    if (e.reporting_manager_id) continue;
    const mgr = e.branch_name ? managerByBranch.get(e.branch_name) : undefined;
    if (mgr && mgr !== e.id) {
      await knex('employees').where('id', e.id).update({ reporting_manager_id: mgr, updated_at: knex.fn.now() });
    }
  }

  // ── 3) Default shift assignment for anyone missing one ──
  if (shiftTypeIds.length) {
    const assigned = new Set<number>(await knex('employee_shift_assignments').pluck('employee_id'));
    const allActive = await knex('employees').where('is_active', true).orderBy('id').pluck('id');
    let s = 0;
    for (const id of allActive) {
      if (assigned.has(id)) continue;
      await knex('employee_shift_assignments').insert({ employee_id: id, shift_type_id: shiftTypeIds[s % shiftTypeIds.length] });
      s++;
    }
  }
}
