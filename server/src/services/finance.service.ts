import db from '../config/database';

export async function getAllBankDetails(filters: { search?: string; branch_name?: string }) {
  // Employees with bank details on file
  const completeQ = db('employee_bank_details as ebd')
    .join('employees as e', 'e.id', 'ebd.employee_id')
    .where('e.is_active', true)
    .select(
      'ebd.id', 'ebd.employee_id', 'ebd.account_name', 'ebd.name_as_per_uid',
      'ebd.bank_account_number', 'ebd.pan_card', 'ebd.ifsc_code', 'ebd.branch_name', 'ebd.payment_mode',
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name as employee_branch',
      db.raw("'complete' as detail_status"),
    )
    .orderBy('e.employee_code', 'asc');

  // Onboarded employees (have a document-collection checklist) without bank details yet.
  // The document checklist lives on the candidate; the employee is reached via the link
  // set at offer acceptance (candidates.employee_id).
  const missingQ = db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .join('candidates as c', 'c.id', 'ci.candidate_id')
    .join('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('employee_bank_details as ebd', 'ebd.employee_id', 'e.id')
    .where('ct.key', 'document_collection')
    .where('e.is_active', true)
    .whereNull('ebd.id')
    .groupBy('e.id')
    .select(
      db.raw('NULL as id'), 'e.id as employee_id',
      db.raw('NULL as account_name'), db.raw('NULL as name_as_per_uid'),
      db.raw('NULL as bank_account_number'), db.raw('NULL as pan_card'),
      db.raw('NULL as ifsc_code'), db.raw('NULL as branch_name'), db.raw('NULL as payment_mode'),
      'e.employee_code', 'e.first_name', 'e.last_name', 'e.branch_name as employee_branch',
      db.raw("'missing' as detail_status"),
    )
    .orderBy('e.employee_code', 'asc');

  const applySearch = (q: any, withDetailCols: boolean) => {
    if (filters.search) {
      q.where(function (this: any) {
        this.where('e.employee_code', 'ilike', `%${filters.search}%`)
          .orWhere('e.first_name', 'ilike', `%${filters.search}%`)
          .orWhere('e.last_name', 'ilike', `%${filters.search}%`);
        if (withDetailCols) {
          this.orWhere('ebd.account_name', 'ilike', `%${filters.search}%`)
            .orWhere('ebd.pan_card', 'ilike', `%${filters.search}%`);
        }
      });
    }
    if (filters.branch_name) q.where('e.branch_name', filters.branch_name);
  };
  applySearch(completeQ, true);
  applySearch(missingQ, false);

  const [missing, complete] = await Promise.all([missingQ, completeQ]);
  // Surface the ones needing attention first
  return [...missing, ...complete];
}

export async function getBankDetailsByEmployee(employeeId: number) {
  return db('employee_bank_details as ebd')
    .join('employees as e', 'e.id', 'ebd.employee_id')
    .where('ebd.employee_id', employeeId)
    .select(
      'ebd.*',
      'e.employee_code',
      'e.first_name',
      'e.last_name',
      'e.branch_name as employee_branch'
    )
    .first();
}

export async function upsertBankDetails(employeeId: number, data: {
  account_name: string;
  name_as_per_uid: string;
  bank_account_number: string;
  pan_card: string;
  ifsc_code: string;
  branch_name: string;
  payment_mode: string;
}) {
  const existing = await db('employee_bank_details').where('employee_id', employeeId).first();

  if (existing) {
    await db('employee_bank_details')
      .where('employee_id', employeeId)
      .update({ ...data, updated_at: db.fn.now() });
    return { id: existing.id, updated: true };
  }

  const [{ id }] = await db('employee_bank_details').insert({
    employee_id: employeeId,
    ...data,
  }).returning('id');
  return { id, updated: false };
}

export async function deleteBankDetails(employeeId: number) {
  const deleted = await db('employee_bank_details').where('employee_id', employeeId).del();
  return deleted > 0;
}

export async function getStats() {
  const totalEmployees = await db('employees').where('is_active', true).count('id as count').first();
  const withBankDetails = await db('employee_bank_details as ebd')
    .join('employees as e', 'e.id', 'ebd.employee_id')
    .where('e.is_active', true)
    .count('ebd.id as count').first();

  // Newly onboarded employees (have a document-collection checklist) still missing bank details
  const onboardedMissing = await db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .join('candidates as c', 'c.id', 'ci.candidate_id')
    .join('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('employee_bank_details as ebd', 'ebd.employee_id', 'e.id')
    .where('ct.key', 'document_collection')
    .where('e.is_active', true)
    .whereNull('ebd.id')
    .countDistinct('e.id as count').first();

  const missing = Number((onboardedMissing as any)?.count || 0);
  return {
    totalEmployees: Number((totalEmployees as any)?.count || 0),
    withBankDetails: Number((withBankDetails as any)?.count || 0),
    // "Missing Bank Details" = newly onboarded employees without bank details on file
    withoutBankDetails: missing,
    onboardedMissing: missing,
  };
}
