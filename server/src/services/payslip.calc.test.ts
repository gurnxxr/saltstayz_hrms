import { describe, it, expect } from 'vitest';
import {
  computeFromStructure, legacyBreakdownToLines, payDateFor, monthName,
  type StatutoryRates, type StructureLineInput,
} from './payslip.calc';

// Mirrors the enabled defaults in Statutory Components (migration 050).
const RATES: StatutoryRates = {
  epf: { enabled: true, employeeRatePct: 12, employerRatePct: 12 },
  esi: { enabled: true, employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000 },
  lwf: { enabled: true, employeePct: 0.2, employeeMaxAmount: 35, employerMultiplier: 2 },
};

const DISABLED: StatutoryRates = {
  epf: { enabled: false, employeeRatePct: 12, employerRatePct: 12 },
  esi: { enabled: false, employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000 },
  lwf: { enabled: false, employeePct: 0.2, employeeMaxAmount: 35, employerMultiplier: 2 },
};

// The standard SaltStayz structure: Basic 50% of base, HRA 50% of Basic,
// Other Allowance = remainder, gratuity provision 4.81% of Basic (employer).
function standardStructure(extra: StructureLineInput[] = []): StructureLineInput[] {
  return [
    { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 50, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
    { component_id: 2, name: 'HRA', category: 'earning', calculation_type: 'pct_of_basic', value: 50, earning_type: 'fixed', consider_epf: 'no', consider_esi: true },
    { component_id: 3, name: 'Other Allowance', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
    { component_id: 6, name: 'Gratuity', category: 'benefit', calculation_type: 'pct_of_basic', value: 4.81 },
    ...extra,
  ];
}

describe('computeFromStructure — earnings resolution', () => {
  it('resolves pct_of_base, pct_of_basic and remainder (sums to base)', () => {
    const b = computeFromStructure(standardStructure(), 20000, RATES);
    expect(b.basic).toBe(10000);
    expect(b.earnings.find((l) => l.name === 'HRA')?.amount).toBe(5000);
    expect(b.earnings.find((l) => l.name === 'Other Allowance')?.amount).toBe(5000);
    expect(b.fixed_salary).toBe(20000);
  });

  it('keeps fixed earnings exactly equal to base for odd amounts', () => {
    const b = computeFromStructure(standardStructure(), 18333, RATES);
    expect(b.fixed_salary).toBe(18333);
  });

  it('variable earnings sit on top of the base, not inside it', () => {
    const pli: StructureLineInput = {
      component_id: 9, name: 'PLI', category: 'earning', calculation_type: 'flat', value: 1500,
      earning_type: 'variable', consider_epf: 'no', consider_esi: false,
    };
    const b = computeFromStructure(standardStructure([pli]), 20000, RATES);
    expect(b.fixed_salary).toBe(20000);
    expect(b.variable_pay).toBe(1500);
    expect(b.gross_earnings).toBe(21500);
  });

  it('two different structures produce different compositions at the same base', () => {
    const flat60: StructureLineInput[] = [
      { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 60, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
      { component_id: 3, name: 'Other Allowance', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'no', consider_esi: true },
    ];
    const a = computeFromStructure(standardStructure(), 20000, RATES);
    const c = computeFromStructure(flat60, 20000, RATES);
    expect(a.basic).toBe(10000);
    expect(c.basic).toBe(12000);
    expect(a.employee_pf).not.toBe(c.employee_pf); // different PF wage bases
  });
});

describe('computeFromStructure — statutory from component flags', () => {
  it('EPF base = Σ epf-flagged earnings (Basic + Other, not HRA)', () => {
    const b = computeFromStructure(standardStructure(), 20000, RATES);
    // basic 10000 + other 5000 = 15000 -> 12% = 1800 (HRA excluded)
    expect(b.employee_pf).toBe(1800);
    expect(b.employer_pf).toBe(1800);
  });

  it('ESI = 0.75% of esi-flagged earnings, rounded UP', () => {
    expect(computeFromStructure(standardStructure(), 20000, RATES).esi).toBe(150);
    expect(computeFromStructure(standardStructure(), 18333, RATES).esi).toBe(138); // 137.4975 -> 138
  });

  it('ESI stops above the wage ceiling', () => {
    const b = computeFromStructure(standardStructure(), 27500, RATES);
    expect(b.esi).toBe(0);
    expect(b.employer_esi).toBe(0);
  });

  it('uses the configured ESI rate — 0.8% instead of 0.75%', () => {
    const custom = { ...RATES, esi: { ...RATES.esi, employeeRatePct: 0.8 } };
    expect(computeFromStructure(standardStructure(), 20000, custom).esi).toBe(160);
  });

  it('LWF = pct of fixed gross capped at the state max, employer = multiplier×', () => {
    const capped = computeFromStructure(standardStructure(), 20000, RATES);
    expect(capped.lwf).toBe(35);          // 0.2% = 40 -> capped
    expect(capped.employer_lwf).toBe(70);
    const under = computeFromStructure(standardStructure(), 10000, RATES);
    expect(under.lwf).toBe(20);
  });

  it('disabled components deduct nothing', () => {
    const b = computeFromStructure(standardStructure(), 20000, DISABLED);
    expect(b.employee_pf + b.esi + b.lwf).toBe(0);
    expect(b.net_pay).toBe(20000);
  });
});

describe('computeFromStructure — deductions, benefits, totals', () => {
  it('deduction lines subtract; benefit lines are employer cost only', () => {
    const extra: StructureLineInput[] = [
      { component_id: 20, name: 'Meal', category: 'deduction', calculation_type: 'flat', value: 500 },
      { component_id: 21, name: 'Accommodation Allowance', category: 'benefit', calculation_type: 'flat', value: 2000 },
    ];
    const b = computeFromStructure(standardStructure(extra), 20000, RATES);
    expect(b.other_deductions.find((l) => l.name === 'Meal')?.amount).toBe(500);
    expect(b.total_deduction).toBe(1800 + 150 + 35 + 500);
    expect(b.net_pay).toBe(20000 - b.total_deduction); // benefit does not affect net
    expect(b.employer_costs.find((l) => l.name === 'Accommodation Allowance')?.amount).toBe(2000);
  });

  it('gratuity provision = 4.81% of Basic, on the employer side', () => {
    const b = computeFromStructure(standardStructure(), 20000, RATES);
    expect(b.employer_costs.find((l) => l.name === 'Gratuity')?.amount).toBe(481);
  });

  it('invariants: net and CTC identities hold', () => {
    for (const base of [12000, 18333, 20000, 27500, 50000]) {
      const b = computeFromStructure(standardStructure(), base, RATES);
      const otherDed = b.other_deductions.reduce((s, l) => s + l.amount, 0);
      const reimb = b.reimbursements.reduce((s, l) => s + l.amount, 0);
      expect(b.gross_earnings).toBe(b.fixed_salary + b.variable_pay);
      expect(b.total_deduction).toBe(b.employee_pf + b.esi + b.lwf + otherDed);
      expect(b.net_pay).toBe(b.gross_earnings - b.total_deduction + reimb);
      expect(b.ctc).toBe(b.gross_earnings + b.employer_pf + b.employer_esi + b.employer_lwf + b.employer_costs_total + reimb);
    }
  });
});

describe('legacyBreakdownToLines', () => {
  it('adapts a pre-Phase-2 snapshot to the lines shape', () => {
    const old = {
      basic: 10000, hra: 5000, other_allowance: 5000, fixed_salary: 20000, pli: 1000,
      gross_earnings: 21000, employee_pf: 1800, esi: 150, lwf: 35, meal: 0, accommodation: 0,
      total_deduction: 1985, net_pay: 19015, employer_pf: 1800, gratuity: 481, employer_lwf: 70,
      retirals: 2351, employer_esi: 650, accommodation_allowance: 0, benefits: 650, ctc: 24001,
    };
    const b = legacyBreakdownToLines(old);
    expect(b.earnings.map((l) => l.name)).toEqual(['Basic', 'HRA', 'Other Allowance', 'PLI (Variable Pay)']);
    expect(b.net_pay).toBe(19015);
    expect(b.ctc).toBe(24001);
    expect(b.employer_costs.find((l) => l.name === 'Gratuity')?.amount).toBe(481);
  });

  it('passes v2 breakdowns through untouched', () => {
    const v2 = computeFromStructure(standardStructure(), 20000, RATES);
    expect(legacyBreakdownToLines(v2)).toBe(v2);
  });
});

describe('date helpers', () => {
  it('monthName maps 1-12', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(12)).toBe('December');
  });

  it('payDateFor defaults to the last day of the month', () => {
    expect(payDateFor(6, 2026)).toBe('2026-06-30');
    expect(payDateFor(2, 2024)).toBe('2024-02-29');
  });

  it('payDateFor fixed_day pays on day N of the FOLLOWING month, clamped', () => {
    expect(payDateFor(6, 2026, { pay_date_type: 'fixed_day', pay_date_day: 5 })).toBe('2026-07-05');
    expect(payDateFor(12, 2026, { pay_date_type: 'fixed_day', pay_date_day: 7 })).toBe('2027-01-07');
    expect(payDateFor(1, 2026, { pay_date_type: 'fixed_day', pay_date_day: 31 })).toBe('2026-02-28');
  });
});
