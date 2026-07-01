import { describe, it, expect } from 'vitest';
import {
  computePayslip, lwfForCity, payDateFor, monthName, LWF_BY_CITY,
} from './payslip.calc';

describe('computePayslip — fixed salary split', () => {
  it('splits Basic = 50% gross, HRA = 50% basic, Other = remainder', () => {
    const b = computePayslip({ gross: 20000, city: 'Gurugram' });
    expect(b.basic).toBe(10000);
    expect(b.hra).toBe(5000);
    expect(b.other_allowance).toBe(5000);
    expect(b.fixed_salary).toBe(20000);
  });

  it('keeps Basic + HRA + Other exactly equal to gross (odd amounts)', () => {
    const b = computePayslip({ gross: 18333 });
    expect(b.basic + b.hra + b.other_allowance).toBe(18333);
    expect(b.fixed_salary).toBe(18333);
  });
});

describe('computePayslip — deductions', () => {
  it('Employee PF = 12% of (Basic + Other Allowance)', () => {
    const b = computePayslip({ gross: 20000, city: 'Gurugram' });
    // basic 10000 + other 5000 = 15000 -> 12% = 1800
    expect(b.employee_pf).toBe(1800);
  });

  it('ESI = 0.75% of gross', () => {
    const b = computePayslip({ gross: 20000 });
    expect(b.esi).toBe(150);
  });

  it('includes LWF, meal and accommodation in total deduction', () => {
    const b = computePayslip({
      gross: 20000, city: 'Gurugram', meal: 500, accommodation: 1000,
    });
    // pf 1800 + esi 150 + lwf 31 (Gurugram) + meal 500 + accom 1000
    expect(b.lwf).toBe(31);
    expect(b.total_deduction).toBe(1800 + 150 + 31 + 500 + 1000);
  });
});

describe('computePayslip — retirals & benefits', () => {
  it('Employer PF equals Employee PF', () => {
    const b = computePayslip({ gross: 20000 });
    expect(b.employer_pf).toBe(b.employee_pf);
  });

  it('Gratuity = 4.81% of Basic', () => {
    const b = computePayslip({ gross: 20000 });
    // basic 10000 -> 4.81% = 481
    expect(b.gratuity).toBe(481);
  });

  it('Employer ESI = 3.25% of gross', () => {
    const b = computePayslip({ gross: 20000 });
    expect(b.employer_esi).toBe(650);
  });
});

describe('computePayslip — invariants', () => {
  const cases = [12000, 18333, 20000, 27500, 50000, 99999];
  for (const gross of cases) {
    it(`Net = A + B - E and CTC = A + B + C + D for gross ${gross}`, () => {
      const b = computePayslip({
        gross, city: 'Gurugram', pli: 1500, meal: 300,
        accommodation: 700, accommodation_allowance: 2000,
      });
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
    const b = computePayslip({ gross: 20000, pli: 2500 });
    expect(b.fixed_salary).toBe(20000);
    expect(b.gross_earnings).toBe(22500);
  });

  it('honours explicit LWF overrides over the city default', () => {
    const b = computePayslip({
      gross: 20000, city: 'Gurugram', lwf_employee: 5, lwf_employer: 10,
    });
    expect(b.lwf).toBe(5);
    expect(b.employer_lwf).toBe(10);
  });

  it('treats missing optional inputs as zero', () => {
    const b = computePayslip({ gross: 20000 });
    expect(b.pli).toBe(0);
    expect(b.meal).toBe(0);
    expect(b.accommodation).toBe(0);
    expect(b.accommodation_allowance).toBe(0);
  });
});

describe('lwfForCity', () => {
  it('returns known city values', () => {
    expect(lwfForCity('Gurugram')).toEqual(LWF_BY_CITY.Gurugram);
  });
  it('falls back to a default for unknown / missing city', () => {
    expect(lwfForCity('Atlantis')).toEqual({ employee: 20, employer: 40 });
    expect(lwfForCity(null)).toEqual({ employee: 20, employer: 40 });
    expect(lwfForCity(undefined)).toEqual({ employee: 20, employer: 40 });
  });
});

describe('date helpers', () => {
  it('monthName maps 1-12', () => {
    expect(monthName(1)).toBe('January');
    expect(monthName(6)).toBe('June');
    expect(monthName(12)).toBe('December');
  });
  it('payDateFor returns the last day of the month', () => {
    expect(payDateFor(6, 2026)).toBe('2026-06-30');
    expect(payDateFor(2, 2024)).toBe('2024-02-29'); // leap year
    expect(payDateFor(2, 2026)).toBe('2026-02-28');
    expect(payDateFor(12, 2026)).toBe('2026-12-31');
  });
});
