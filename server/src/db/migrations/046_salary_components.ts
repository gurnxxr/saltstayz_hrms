import type { Knex } from 'knex';

// Salary component catalog: the library of Earnings / Deductions / Benefits /
// Reimbursements an org can attach to salary structures & payslips. One flexible
// table keyed by `category` with a JSON `config` for category-specific fields.

interface Row { category: string; name: string; name_in_payslip: string; status: string; is_system: number; sort_order: number; config: string; }

let ORDER = 0;
const earning = (name: string, o: {
  earningType: 'fixed' | 'variable'; calc: 'flat' | 'percentage';
  amount?: number; percentage?: number; percentOf?: 'ctc' | 'basic' | null;
  status?: string; epf?: 'no' | 'always' | 'if_below_15000'; esi?: boolean; taxable?: boolean; payslip?: string;
}): Row => ({
  category: 'earning', name, name_in_payslip: o.payslip || name, status: o.status || 'active', is_system: 1, sort_order: ORDER++,
  config: JSON.stringify({
    earningType: o.earningType, calculationType: o.calc, amount: o.amount ?? 0, percentage: o.percentage ?? 0, percentOf: o.percentOf ?? null,
    partOfStructure: true, isTaxable: o.taxable ?? true, proRata: true,
    considerEpf: o.epf || 'no', considerEsi: o.esi ?? false, showInPayslip: true,
  }),
});

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('salary_components', (t) => {
    t.increments('id').primary();
    t.string('category', 20).notNullable(); // earning | deduction | benefit | reimbursement
    t.string('name', 150).notNullable();
    t.string('name_in_payslip', 150).notNullable();
    t.string('status', 12).notNullable().defaultTo('active'); // active | inactive
    t.integer('is_system').notNullable().defaultTo(0); // seeded default (some fields locked)
    t.integer('sort_order').notNullable().defaultTo(0);
    t.text('config').notNullable().defaultTo('{}');
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  const rows: Row[] = [
    // ── Earnings ──
    earning('Basic', { earningType: 'fixed', calc: 'percentage', percentage: 50, percentOf: 'ctc', epf: 'always', esi: true }),
    earning('House Rent Allowance', { earningType: 'fixed', calc: 'percentage', percentage: 50, percentOf: 'basic', esi: true, payslip: 'HRA' }),
    earning('Conveyance Allowance', { earningType: 'fixed', calc: 'flat', epf: 'if_below_15000', esi: true }),
    earning('Children Education Allowance', { earningType: 'fixed', calc: 'flat', status: 'inactive' }),
    earning('Transport Allowance', { earningType: 'fixed', calc: 'flat', amount: 1600, esi: true }),
    earning('Travelling Allowance', { earningType: 'variable', calc: 'flat', esi: true }),
    earning('Fixed Allowance', { earningType: 'fixed', calc: 'flat', epf: 'always', esi: true }),
    earning('Overtime Allowance', { earningType: 'variable', calc: 'flat', status: 'inactive' }),
    earning('Gratuity', { earningType: 'variable', calc: 'flat' }),
    earning('Bonus', { earningType: 'variable', calc: 'flat' }),
    earning('Commission', { earningType: 'variable', calc: 'flat', status: 'inactive' }),
    earning('Leave Encashment', { earningType: 'variable', calc: 'flat' }),
    earning('Notice Pay', { earningType: 'variable', calc: 'flat' }),
    earning('Hold Salary (Non Taxable)', { earningType: 'variable', calc: 'flat', taxable: false, status: 'inactive' }),
    // ── Deductions ──
    { category: 'deduction', name: 'Withheld Salary', name_in_payslip: 'Withheld Salary', status: 'active', is_system: 1, sort_order: ORDER++, config: JSON.stringify({ deductionType: 'Withheld Salary', frequency: 'one_time' }) },
    { category: 'deduction', name: 'Notice Pay Deduction', name_in_payslip: 'Notice Pay Deduction', status: 'active', is_system: 1, sort_order: ORDER++, config: JSON.stringify({ deductionType: 'Notice Pay Deduction', frequency: 'one_time' }) },
    // ── Benefits ──
    { category: 'benefit', name: 'Voluntary Provident Fund', name_in_payslip: 'VPF', status: 'inactive', is_system: 1, sort_order: ORDER++, config: JSON.stringify({ benefitPlan: 'Voluntary Provident Fund', associateWith: 'Employee Provident Fund', frequency: 'recurring', proRata: false }) },
    // ── Reimbursements (all inactive, amount 0) ──
    ...['Fuel Reimbursement', 'Driver Reimbursement', 'Vehicle Maintenance Reimbursement', 'Telephone Reimbursement', 'Leave Travel Allowance'].map((name): Row => ({
      category: 'reimbursement', name, name_in_payslip: name, status: 'inactive', is_system: 1, sort_order: ORDER++,
      config: JSON.stringify({ reimbursementType: name, maxAmount: 0, isFbp: false, unclaimed: 'carry_forward' }),
    })),
  ];

  await knex('salary_components').insert(rows);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('salary_components');
}
