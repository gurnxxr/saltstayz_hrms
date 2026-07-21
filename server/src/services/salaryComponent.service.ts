import db from '../config/database';
import { ValidationError, NotFoundError } from '../utils/errors';

// Salary component catalog (Earnings / Deductions / Benefits / Reimbursements).
// Category-specific fields live in a JSON `config` blob, validated per category.

const TABLE = 'salary_components';
const CATEGORIES = ['earning', 'deduction', 'benefit', 'reimbursement'] as const;

function parseRow(row: any) {
  let config: any = {};
  try { config = JSON.parse(row.config || '{}'); } catch { config = {}; }
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    name_in_payslip: row.name_in_payslip,
    status: row.status,
    is_system: !!row.is_system,
    sort_order: row.sort_order,
    config,
    updated_at: row.updated_at,
  };
}

export async function listSalaryComponents() {
  const rows = await db(TABLE).orderBy('sort_order').orderBy('id');
  const all = rows.map(parseRow);
  return {
    earnings: all.filter((c) => c.category === 'earning'),
    deductions: all.filter((c) => c.category === 'deduction'),
    benefits: all.filter((c) => c.category === 'benefit'),
    reimbursements: all.filter((c) => c.category === 'reimbursement'),
  };
}

function num(v: any, name: string, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be between ${min} and ${max}.`);
  return n;
}

// Normalize/validate the category-specific config coming from the client.
function buildConfig(category: string, input: any) {
  const c = input || {};
  switch (category) {
    case 'earning': {
      const calc = c.calculationType === 'percentage' ? 'percentage' : 'flat';
      return {
        earningType: c.earningType === 'variable' ? 'variable' : 'fixed',
        calculationType: calc,
        amount: calc === 'flat' ? num(c.amount ?? 0, 'Amount', 0, 100_000_000) : 0,
        percentage: calc === 'percentage' ? num(c.percentage ?? 0, 'Percentage', 0, 100) : 0,
        percentOf: c.percentOf === 'ctc' ? 'ctc' : c.percentOf === 'basic' ? 'basic' : null,
        partOfStructure: !!c.partOfStructure,
        isTaxable: c.isTaxable !== false,
        proRata: !!c.proRata,
        considerEpf: ['no', 'always', 'if_below_15000'].includes(c.considerEpf) ? c.considerEpf : 'no',
        considerEsi: !!c.considerEsi,
        showInPayslip: c.showInPayslip !== false,
      };
    }
    case 'deduction':
      return {
        deductionType: String(c.deductionType || '').trim(),
        frequency: c.frequency === 'recurring' ? 'recurring' : 'one_time',
      };
    case 'benefit':
      return {
        benefitPlan: String(c.benefitPlan || '').trim(),
        associateWith: String(c.associateWith || '').trim(),
        frequency: c.frequency === 'one_time' ? 'one_time' : 'recurring',
        proRata: !!c.proRata,
      };
    case 'reimbursement':
      return {
        reimbursementType: String(c.reimbursementType || '').trim(),
        maxAmount: num(c.maxAmount ?? 0, 'Amount', 0, 100_000_000),
        isFbp: !!c.isFbp,
        unclaimed: c.unclaimed === 'monthly' ? 'monthly' : 'carry_forward',
      };
    default:
      return {};
  }
}

export async function createSalaryComponent(input: any, userId?: number) {
  const category = String(input.category || '');
  if (!CATEGORIES.includes(category as any)) throw new ValidationError('Invalid component category.');
  const name = String(input.name || '').trim();
  if (!name) throw new ValidationError('Name is required.');
  const namePayslip = String(input.name_in_payslip || name).trim();
  const status = input.status === 'inactive' ? 'inactive' : 'active';
  const config = buildConfig(category, input.config);

  const [{ id }] = await db(TABLE).insert({
    category, name, name_in_payslip: namePayslip, status, is_system: 0, config: JSON.stringify(config),
    sort_order: 9999, updated_by: userId || null,
  }).returning('id');
  return parseRow(await db(TABLE).where('id', id).first());
}

export async function updateSalaryComponent(id: number, input: any, userId?: number) {
  const existing = await db(TABLE).where('id', id).first();
  if (!existing) throw new NotFoundError('Salary component');
  const category = existing.category; // category is immutable on edit
  const name = String(input.name ?? existing.name).trim();
  if (!name) throw new ValidationError('Name is required.');
  const namePayslip = String(input.name_in_payslip ?? existing.name_in_payslip).trim();
  const status = input.status === undefined ? existing.status : (input.status === 'inactive' ? 'inactive' : 'active');
  // Merge incoming config over the existing one (so partial edits keep other fields).
  let base: any = {};
  try { base = JSON.parse(existing.config || '{}'); } catch { base = {}; }
  const config = buildConfig(category, { ...base, ...(input.config || {}) });

  await db(TABLE).where('id', id).update({
    name, name_in_payslip: namePayslip, status, config: JSON.stringify(config),
    updated_by: userId || null, updated_at: db.fn.now(),
  });
  return parseRow(await db(TABLE).where('id', id).first());
}

export async function setSalaryComponentStatus(id: number, status: string, userId?: number) {
  const existing = await db(TABLE).where('id', id).first();
  if (!existing) throw new NotFoundError('Salary component');
  const next = status === 'inactive' ? 'inactive' : 'active';
  await db(TABLE).where('id', id).update({ status: next, updated_by: userId || null, updated_at: db.fn.now() });
  return parseRow(await db(TABLE).where('id', id).first());
}

export async function deleteSalaryComponent(id: number) {
  const existing = await db(TABLE).where('id', id).first();
  if (!existing) throw new NotFoundError('Salary component');
  // Only Earnings are deletable (matches the UI's per-category action set).
  if (existing.category !== 'earning') throw new ValidationError('Only earning components can be deleted.');
  await db(TABLE).where('id', id).del();
  return { deleted: true, id };
}
