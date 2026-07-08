import { describe, it, expect } from 'vitest';
import {
  computeFromStructure, legacyBreakdownToLines, payDateFor, monthName,
  type StatutoryRates, type StructureLineInput,
} from './payslip.calc';

// Mirrors the enabled defaults in Statutory Components (migrations 050 + 059).
const LWF_PERCENT = {
  enabled: true, mode: 'percent' as const,
  employeePct: 0.2, employeeMaxAmount: 35, employerMultiplier: 2,
  employeeAmount: 0, employerAmount: 0, deductionMonths: [] as number[],
};
const NO_PT = { enabled: false, slabs: [] };

const EPF_ON = { enabled: true, employeeRatePct: 12, employerRatePct: 12, wageCeiling: 15000, lopMode: 'prorate_restricted' as const };
const RATES: StatutoryRates = {
  epf: { ...EPF_ON },
  esi: { enabled: true, employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000 },
  lwf: { ...LWF_PERCENT },
  pt: { ...NO_PT },
};

const DISABLED: StatutoryRates = {
  epf: { ...EPF_ON, enabled: false },
  esi: { enabled: false, employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000 },
  lwf: { ...LWF_PERCENT, enabled: false },
  pt: { ...NO_PT },
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
      expect(b.total_deduction).toBe(b.employee_pf + b.esi + b.lwf + b.pt + otherDed);
      expect(b.net_pay).toBe(b.gross_earnings - b.total_deduction + reimb);
      expect(b.ctc).toBe(b.gross_earnings + b.employer_pf + b.employer_esi + b.employer_lwf + b.employer_costs_total + reimb);
    }
  });
});

describe('computeFromStructure — attendance-driven proration (Phase 3)', () => {
  // The plan's worked example: base 18000, 6-day week June (26 working days),
  // 2 absents + 1 half-day + 1 unpaid leave day → LOP 3.5 → payment days 22.5.
  const JUNE = { period_days: 30, working_days: 26, lop_days: 3.5, payment_days: 22.5 };

  it('prorates the base by payment/working days (earned gross 15,577)', () => {
    const b = computeFromStructure(standardStructure(), 18000, RATES, JUNE);
    expect(b.fixed_salary).toBe(15577); // 18000 × 22.5 / 26
    expect(b.esi).toBe(117);            // ceil(0.75% of 15,577)
    expect(b.lwf).toBe(31);             // 0.2% of 15,577 = 31.15 → 31, below the 35 cap
    expect(b.days?.lop_days).toBe(3.5);
    expect(b.days?.payment_days).toBe(22.5);
    // statutory shrinks with the prorated wage base
    const full = computeFromStructure(standardStructure(), 18000, RATES);
    expect(b.employee_pf).toBeLessThan(full.employee_pf);
    expect(b.net_pay).toBeLessThan(full.net_pay);
  });

  it('full attendance pays the full base', () => {
    const att = { period_days: 30, working_days: 26, lop_days: 0, payment_days: 26 };
    const b = computeFromStructure(standardStructure(), 18000, RATES, att);
    expect(b.fixed_salary).toBe(18000);
  });

  it('flat earning lines scale only when pro-rata', () => {
    const proRataAllowance: StructureLineInput = {
      component_id: 30, name: 'Transport', category: 'earning', calculation_type: 'flat', value: 1000,
      earning_type: 'fixed', consider_epf: 'no', consider_esi: false, pro_rata: true,
    };
    const fixedPli: StructureLineInput = {
      component_id: 9, name: 'PLI', category: 'earning', calculation_type: 'flat', value: 720,
      earning_type: 'variable', consider_epf: 'no', consider_esi: false, pro_rata: false,
    };
    const att = { period_days: 30, working_days: 26, lop_days: 13, payment_days: 13 }; // half the month
    const b = computeFromStructure(standardStructure([proRataAllowance, fixedPli]), 18000, RATES, att);
    expect(b.earnings.find((l) => l.name === 'Transport')?.amount).toBe(500); // scaled
    expect(b.earnings.find((l) => l.name === 'PLI')?.amount).toBe(720);       // not scaled
  });

  it('zero payment days → zero pay, zero statutory', () => {
    const att = { period_days: 30, working_days: 26, lop_days: 26, payment_days: 0 };
    const b = computeFromStructure(standardStructure(), 18000, RATES, att);
    expect(b.fixed_salary).toBe(0);
    expect(b.employee_pf + b.esi + b.lwf).toBe(0);
    expect(b.net_pay).toBe(0);
  });

  it('hourly basis: pay = rate × attendance hours', () => {
    const att = { period_days: 30, working_days: 26, lop_days: 0, payment_days: 26, hours: 176 };
    const b = computeFromStructure(standardStructure(), 100, RATES, att); // ₹100/hour
    expect(b.fixed_salary).toBe(17600);
    expect(b.basic).toBe(8800);
    expect(b.days?.hours).toBe(176);
  });
});

describe('computeFromStructure — state-config LWF & PT (Phase 1: Work-Location State)', () => {
  it('fixed-amount LWF deducts only in the configured months (Delhi: June & December)', () => {
    const delhi: StatutoryRates = {
      ...DISABLED,
      lwf: { enabled: true, mode: 'fixed', employeePct: 0, employeeMaxAmount: 0, employerMultiplier: 1, employeeAmount: 0.75, employerAmount: 2.25, deductionMonths: [6, 12] },
    };
    const june = computeFromStructure(standardStructure(), 20000, delhi, null, 6);
    expect(june.lwf).toBe(0.75);          // sub-rupee statutory amounts keep paise
    expect(june.employer_lwf).toBe(2.25);
    const july = computeFromStructure(standardStructure(), 20000, delhi, null, 7);
    expect(july.lwf).toBe(0);
    expect(july.employer_lwf).toBe(0);
    // Reference breakdown (no month known): cyclical LWF is excluded
    const reference = computeFromStructure(standardStructure(), 20000, delhi, null, null);
    expect(reference.lwf).toBe(0);
  });

  it('fixed-amount LWF with empty months deducts every month (Chandigarh ₹5/₹20)', () => {
    const chd: StatutoryRates = {
      ...DISABLED,
      lwf: { enabled: true, mode: 'fixed', employeePct: 0, employeeMaxAmount: 0, employerMultiplier: 1, employeeAmount: 5, employerAmount: 20, deductionMonths: [] },
    };
    for (const month of [1, 6, null]) {
      const b = computeFromStructure(standardStructure(), 20000, chd, null, month);
      expect(b.lwf).toBe(5);
      expect(b.employer_lwf).toBe(20);
    }
  });

  it('percent LWF keeps the cap behaviour and applies monthly', () => {
    const b = computeFromStructure(standardStructure(), 20000, RATES, null, 3);
    expect(b.lwf).toBe(Math.min(Math.round(20000 * 0.002), 35));
  });

  it('PT: slab on monthly gross, month overrides, none without a matching slab', () => {
    const mh: StatutoryRates = {
      ...DISABLED,
      pt: {
        enabled: true,
        slabs: [
          { min: 0, max: 7500, amount: 0 },
          { min: 7501, max: 10000, amount: 175 },
          { min: 10001, max: null, amount: 200, monthAmounts: { '2': 300 } }, // Maharashtra-style February
        ],
      },
    };
    const b = computeFromStructure(standardStructure(), 20000, mh, null, 5);
    expect(b.pt).toBe(200);
    expect(b.total_deduction).toBe(200); // everything else disabled
    expect(b.net_pay).toBe(b.gross_earnings - 200);
    const feb = computeFromStructure(standardStructure(), 20000, mh, null, 2);
    expect(feb.pt).toBe(300);
    const mid = computeFromStructure(standardStructure(), 9000, mh, null, 5); // gross 9000 → second slab
    expect(mid.pt).toBe(175);
    const tiny = computeFromStructure(standardStructure(), 7000, mh, null, 5); // gross 7000 → first slab, ₹0
    expect(tiny.pt).toBe(0);
    const disabled = computeFromStructure(standardStructure(), 20000, DISABLED, null, 5);
    expect(disabled.pt).toBe(0);
  });
});

describe('computeFromStructure — proration of fixed flat earnings (Phase 5)', () => {
  const days = (working: number, payment: number) => ({ period_days: 30, working_days: working, payment_days: payment, lop_days: working - payment });
  // Basic 50% + a FIXED flat Transport (pro_rata not set) + remainder Other.
  const withFixedFlat = (): StructureLineInput[] => [
    { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 50, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
    { component_id: 2, name: 'Transport', category: 'earning', calculation_type: 'flat', value: 6000, earning_type: 'fixed', consider_epf: 'no', consider_esi: true },
    { component_id: 3, name: 'Other', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'no', consider_esi: true },
  ];

  it('a fixed flat earning prorates with LOP — gross never exceeds base × factor', () => {
    const full = computeFromStructure(withFixedFlat(), 20000, RATES);
    expect(full.gross_earnings).toBe(20000);           // full month sums to base
    const half = computeFromStructure(withFixedFlat(), 20000, RATES, days(20, 10)); // 50% LOP
    expect(half.gross_earnings).toBe(10000);           // no overpay (was 11000: full Transport + floored remainder)
    expect(half.earnings.find((l) => l.name === 'Transport')?.amount).toBe(3000); // prorated
  });

  it('a variable flat earning still sits on top (not prorated)', () => {
    const pli: StructureLineInput = { component_id: 9, name: 'PLI', category: 'earning', calculation_type: 'flat', value: 2000, earning_type: 'variable', consider_epf: 'no', consider_esi: false };
    const half = computeFromStructure(standardStructure([pli]), 20000, RATES, days(20, 10));
    expect(half.variable_pay).toBe(2000); // variable pay unaffected by LOP
  });
});

describe('computeFromStructure — statutory ceilings & eligibility (Phase 5)', () => {
  // A single Basic = 100% of base, EPF+ESI applicable, so PF/ESI wage == base.
  const singleBasic = (): StructureLineInput[] => [
    { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 100, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
  ];
  const days = (working: number, payment: number) => ({ period_days: 30, working_days: working, payment_days: payment, lop_days: working - payment });

  it('PF wage is capped at ₹15,000 (₹1,800), not paid on full wage', () => {
    expect(computeFromStructure(singleBasic(), 10000, RATES).employee_pf).toBe(1200); // below cap
    expect(computeFromStructure(singleBasic(), 15000, RATES).employee_pf).toBe(1800); // at cap
    expect(computeFromStructure(singleBasic(), 30000, RATES).employee_pf).toBe(1800); // capped (was 3600)
    expect(computeFromStructure(singleBasic(), 30000, RATES).employer_pf).toBe(1800);
  });

  it('ESI ceiling boundary: ≤ ₹21,000 covered, above it not', () => {
    expect(computeFromStructure(singleBasic(), 20999, RATES).esi).toBe(Math.ceil(20999 * 0.0075)); // covered
    expect(computeFromStructure(singleBasic(), 21000, RATES).esi).toBe(Math.ceil(21000 * 0.0075)); // covered at ceiling
    expect(computeFromStructure(singleBasic(), 21001, RATES).esi).toBe(0);                          // above → not covered
  });

  it('ESI eligibility uses the CONTRACTED wage, not the LOP-earned wage', () => {
    // ₹25,000 contracted (above ₹21,000) with 50% LOP earns ₹12,500 — still NOT ESI-eligible.
    const b = computeFromStructure(singleBasic(), 25000, RATES, days(20, 10));
    expect(b.esi).toBe(0);          // was: 0.75% of the prorated 12,500 deducted unlawfully
    expect(b.employer_esi).toBe(0);
  });

  it('ESI contribution is on the earned wage while covered (₹20,000, 50% LOP)', () => {
    const b = computeFromStructure(singleBasic(), 20000, RATES, days(20, 10));
    // contracted 20,000 ≤ 21,000 → covered; contribution on earned 10,000.
    expect(b.esi).toBe(Math.ceil(10000 * 0.0075));
  });

  it('PF wage cap prorates by LOP (prorate_restricted): ₹30k, 50% LOP → ₹900', () => {
    const b = computeFromStructure(singleBasic(), 30000, RATES, days(20, 10));
    // min(30000, 15000) × 0.5 = 7500 → 12% = 900
    expect(b.employee_pf).toBe(900);
  });

  it('lopMode consider_all_below_15000 uses the earned wage up to the cap', () => {
    const rates: StatutoryRates = { ...RATES, epf: { ...RATES.epf, lopMode: 'consider_all_below_15000' } };
    const b = computeFromStructure(singleBasic(), 30000, rates, days(20, 10));
    // earned PF wage = 30000 × 0.5 = 15000, capped at 15000 → 12% = 1800
    expect(b.employee_pf).toBe(1800);
  });

  it('if_below_15000 EPF flag is decided on the contracted wage, not the LOP-earned wage', () => {
    const withAllowance = (base: number, lop?: { working: number; payment: number }) => computeFromStructure([
      { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 50, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
      { component_id: 2, name: 'Special', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'if_below_15000', consider_esi: true },
    ], base, RATES, lop ? days(lop.working, lop.payment) : null);
    // Contracted fixed salary 20,000 > 15,000 → Special excluded even with heavy LOP.
    const heavy = withAllowance(20000, { working: 20, payment: 2 }); // 90% LOP
    // PF wage = Basic only (10,000 contracted) capped, prorated: 10000 × (2/20) = 1000 → 12% = 120
    expect(heavy.employee_pf).toBe(120);
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
