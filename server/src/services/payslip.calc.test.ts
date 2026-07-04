import { describe, it, expect } from 'vitest';
import {
  computePayslip, payDateFor, monthName, type StatutoryRates,
} from './payslip.calc';

// Mirrors the enabled defaults seeded by migration 050 (Statutory Components).
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

describe('computePayslip — fixed salary split', () => {
  it('splits Basic = 50% gross, HRA = 50% basic, Other = remainder', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    expect(b.basic).toBe(10000);
    expect(b.hra).toBe(5000);
    expect(b.other_allowance).toBe(5000);
    expect(b.fixed_salary).toBe(20000);
  });

  it('keeps Basic + HRA + Other exactly equal to gross (odd amounts)', () => {
    const b = computePayslip({ gross: 18333 }, RATES);
    expect(b.basic + b.hra + b.other_allowance).toBe(18333);
    expect(b.fixed_salary).toBe(18333);
  });
});

describe('computePayslip — statutory deductions (settings-driven)', () => {
  it('Employee PF = 12% of (Basic + Other Allowance)', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    // basic 10000 + other 5000 = 15000 -> 12% = 1800
    expect(b.employee_pf).toBe(1800);
  });

  it('ESI = 0.75% of gross, rounded UP to the next rupee', () => {
    expect(computePayslip({ gross: 20000 }, RATES).esi).toBe(150);
    // 0.75% of 18333 = 137.4975 -> 138
    expect(computePayslip({ gross: 18333 }, RATES).esi).toBe(138);
  });

  it('ESI stops above the wage ceiling (₹21,000)', () => {
    const b = computePayslip({ gross: 27500 }, RATES);
    expect(b.esi).toBe(0);
    expect(b.employer_esi).toBe(0);
  });

  it('uses the configured ESI rate — 0.8% instead of 0.75%', () => {
    const custom = { ...RATES, esi: { ...RATES.esi, employeeRatePct: 0.8 } };
    expect(computePayslip({ gross: 20000 }, custom).esi).toBe(160);
  });

  it('LWF = employeePct% of gross capped at the state max, employer = multiplier×', () => {
    const capped = computePayslip({ gross: 20000 }, RATES);
    expect(capped.lwf).toBe(35);          // 0.2% = 40 -> capped at 35
    expect(capped.employer_lwf).toBe(70); // 35 × 2
    const under = computePayslip({ gross: 10000 }, RATES);
    expect(under.lwf).toBe(20);           // 0.2% = 20, below the cap
    expect(under.employer_lwf).toBe(40);
  });

  it('disabled components deduct nothing', () => {
    const b = computePayslip({ gross: 20000 }, DISABLED);
    expect(b.employee_pf).toBe(0);
    expect(b.esi).toBe(0);
    expect(b.lwf).toBe(0);
    expect(b.employer_pf).toBe(0);
    expect(b.employer_esi).toBe(0);
    expect(b.employer_lwf).toBe(0);
    expect(b.net_pay).toBe(20000);
  });

  it('includes LWF, meal and accommodation in total deduction', () => {
    const b = computePayslip({ gross: 20000, meal: 500, accommodation: 1000 }, RATES);
    // pf 1800 + esi 150 + lwf 35 + meal 500 + accom 1000
    expect(b.total_deduction).toBe(1800 + 150 + 35 + 500 + 1000);
  });
});

describe('computePayslip — retirals & benefits', () => {
  it('Employer PF equals Employee PF at equal configured rates', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    expect(b.employer_pf).toBe(b.employee_pf);
  });

  it('Gratuity = 4.81% of Basic', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    // basic 10000 -> 4.81% = 481
    expect(b.gratuity).toBe(481);
  });

  it('Employer ESI = 3.25% of gross (within ceiling)', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    expect(b.employer_esi).toBe(650);
  });
});

describe('computePayslip — invariants', () => {
  const cases = [12000, 18333, 20000, 27500, 50000, 99999];
  for (const gross of cases) {
    it(`Net = A + B - E and CTC = A + B + C + D for gross ${gross}`, () => {
      const b = computePayslip({
        gross, pli: 1500, meal: 300,
        accommodation: 700, accommodation_allowance: 2000,
      }, RATES);
      const A = b.fixed_salary;
      const B = b.pli;
      const E = b.total_deduction;
      const C = b.retirals;
      const D = b.benefits;
      expect(b.gross_earnings).toBe(A + B);
      expect(b.net_pay).toBe(A + B - E);
      expect(b.ctc).toBe(A + B + C + D);
      expect(b.retirals).toBe(b.employer_pf + b.gratuity + b.employer_lwf);
      expect(b.benefits).toBe(b.employer_esi + b.accommodation_allowance);
    });
  }
});

describe('computePayslip — variable pay & overrides', () => {
  it('adds PLI to gross earnings but not to fixed salary', () => {
    const b = computePayslip({ gross: 20000, pli: 2500 }, RATES);
    expect(b.fixed_salary).toBe(20000);
    expect(b.gross_earnings).toBe(22500);
  });

  it('honours explicit LWF overrides over the state formula', () => {
    const b = computePayslip({ gross: 20000, lwf_employee: 5, lwf_employer: 10 }, RATES);
    expect(b.lwf).toBe(5);
    expect(b.employer_lwf).toBe(10);
  });

  it('treats missing optional inputs as zero', () => {
    const b = computePayslip({ gross: 20000 }, RATES);
    expect(b.pli).toBe(0);
    expect(b.meal).toBe(0);
    expect(b.accommodation).toBe(0);
    expect(b.accommodation_allowance).toBe(0);
  });
});

describe('date helpers', () => {
  it('monthName maps 1-12', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(6)).toBe('June');
    expect(monthName(12)).toBe('December');
  });

  it('payDateFor defaults to the last day of the month', () => {
    expect(payDateFor(6, 2026)).toBe('2026-06-30');
    expect(payDateFor(2, 2024)).toBe('2024-02-29'); // leap year
    expect(payDateFor(2, 2026)).toBe('2026-02-28');
    expect(payDateFor(12, 2026)).toBe('2026-12-31');
  });

  it('payDateFor honours last_day schedule explicitly', () => {
    expect(payDateFor(6, 2026, { pay_date_type: 'last_day', pay_date_day: 5 })).toBe('2026-06-30');
  });

  it('payDateFor fixed_day pays on day N of the FOLLOWING month', () => {
    expect(payDateFor(6, 2026, { pay_date_type: 'fixed_day', pay_date_day: 5 })).toBe('2026-07-05');
    expect(payDateFor(12, 2026, { pay_date_type: 'fixed_day', pay_date_day: 7 })).toBe('2027-01-07');
    // clamped to the following month's length (Jan salary -> Feb 28, not Feb 31)
    expect(payDateFor(1, 2026, { pay_date_type: 'fixed_day', pay_date_day: 31 })).toBe('2026-02-28');
  });
});
