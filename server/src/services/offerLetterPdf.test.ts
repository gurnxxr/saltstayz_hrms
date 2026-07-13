import { describe, it, expect } from 'vitest';
import { buildCompensationRows } from './offerLetterPdf.service';

// A breakdown with an edited deduction component (Meal Deduction), an employer
// benefit (Gratuity) and a reimbursement (Telephone) — the categories the offer
// PDF used to collapse into aggregates.
const breakdown: any = {
  earnings: [{ name: 'Basic', amount: 20000 }, { name: 'HRA', amount: 8000 }],
  gross_earnings: 28000,
  employee_pf: 1800, esi: 0, pt: 200, lwf: 20,
  other_deductions: [{ name: 'Meal Deduction', amount: 500 }],
  total_deduction: 2520,
  net_pay: 25480,
  employer_pf: 1800, employer_esi: 0, employer_lwf: 40,
  employer_costs: [{ name: 'Gratuity', amount: 962 }],
  employer_costs_total: 962,
  reimbursements: [{ name: 'Telephone Reimbursement', amount: 1000 }],
  ctc: 30842,
};

describe('offer letter — buildCompensationRows', () => {
  const rows = buildCompensationRows(breakdown);
  const labels = rows.map((r) => r[0]);

  it('itemises every edited component as its own line', () => {
    for (const name of ['Basic', 'HRA', 'Meal Deduction', 'Gratuity', 'Telephone Reimbursement']) {
      expect(labels).toContain(name);
    }
  });

  it('itemises applicable statutory deductions + employer contributions', () => {
    expect(labels).toEqual(expect.arrayContaining(['Provident Fund', 'Professional Tax', 'Labour Welfare Fund', 'Employer PF', 'Employer LWF']));
  });

  it('omits zero-value statutory lines (ESI here is 0)', () => {
    expect(labels).not.toContain('ESI');
    expect(labels).not.toContain('Employer ESI');
  });

  it('keeps the subtotal anchors bold', () => {
    const bold = rows.filter((r) => r[2]).map((r) => r[0]);
    expect(bold).toEqual(['Gross Earnings', 'Total Deductions', 'Net In-Hand (approx.)', 'Cost to Company (CTC)']);
  });

  it('carries the right amount for an edited deduction component', () => {
    expect(rows.find((r) => r[0] === 'Meal Deduction')?.[1]).toBe(500);
  });
});
