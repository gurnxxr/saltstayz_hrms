import { describe, it, expect } from 'vitest';
import {
  computeFromStructure, legacyBreakdownToLines, payDateFor, monthName,
  type StatutoryRates, type StructureLineInput,
} from './payslip.calc';

// ── Rate fixtures (mirror payslip.calc.test.ts so the two suites stay in sync) ──
const LWF_PERCENT = {
  enabled: true, mode: 'percent' as const,
  employeePct: 0.2, employeeMaxAmount: 35, employerMultiplier: 2,
  employeeAmount: 0, employerAmount: 0, deductionMonths: [] as number[],
};
const NO_PT = { enabled: false, slabs: [] };
const EPF_ON = { enabled: true, employeeRatePct: 12, employerRatePct: 12, wageCeiling: 15000, lopMode: 'prorate_restricted' as const, includeInCtc: true };
const ESI_ON = { enabled: true, employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000, includeInCtc: true };

const RATES: StatutoryRates = {
  epf: { ...EPF_ON }, esi: { ...ESI_ON }, lwf: { ...LWF_PERCENT }, pt: { ...NO_PT },
};
const DISABLED: StatutoryRates = {
  epf: { ...EPF_ON, enabled: false }, esi: { ...ESI_ON, enabled: false },
  lwf: { ...LWF_PERCENT, enabled: false }, pt: { ...NO_PT },
};

// Standard SaltStayz structure: Basic 50% of base, HRA 50% of Basic,
// Other Allowance = remainder, Gratuity 4.81% of Basic (employer benefit).
function standardStructure(extra: StructureLineInput[] = []): StructureLineInput[] {
  return [
    { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 50, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
    { component_id: 2, name: 'HRA', category: 'earning', calculation_type: 'pct_of_basic', value: 50, earning_type: 'fixed', consider_epf: 'no', consider_esi: true },
    { component_id: 3, name: 'Other Allowance', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
    { component_id: 6, name: 'Gratuity', category: 'benefit', calculation_type: 'pct_of_basic', value: 4.81 },
    ...extra,
  ];
}
// Single Basic = 100% of base, PF+ESI applicable, so the PF/ESI wage == base.
const singleBasic = (): StructureLineInput[] => [
  { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 100, earning_type: 'fixed', consider_epf: 'always', consider_esi: true },
];
const days = (working: number, payment: number) =>
  ({ period_days: 30, working_days: working, payment_days: payment, lop_days: working - payment });

// ─────────────────────────────────────────────────────────────────────────────
describe('proration — rounding & the remainder absorbing drift', () => {
  it('non-divisible payment/working ratio keeps fixed_salary EXACTLY equal to the rounded prorated base', () => {
    // factor 17/23; round(25000·17/23) = round(18478.26) = 18478.
    const b = computeFromStructure(standardStructure(), 25000, RATES, days(23, 17));
    expect(b.fixed_salary).toBe(18478);
    expect(b.gross_earnings).toBe(18478);
    // Basic 9239, HRA round(4619.5)=4620, Other = remainder absorbs the −1 drift = 4619.
    expect(b.earnings.find((l) => l.name === 'Basic')?.amount).toBe(9239);
    expect(b.earnings.find((l) => l.name === 'HRA')?.amount).toBe(4620);
    expect(b.earnings.find((l) => l.name === 'Other Allowance')?.amount).toBe(4619);
    // Remainder guarantees the parts still sum to the rounded prorated base.
    const sum = b.earnings.filter((l) => l.name !== undefined).reduce((s, l) => s + l.amount, 0);
    expect(sum).toBe(18478);
  });

  it('PF wage prorates the capped contracted wage (prorate_restricted) under an odd factor', () => {
    // pfBaseFull = Basic 12500 + Other 6250 = 18750 → capped 15000 → ×17/23 = 11086.96 → 12% → 1330.
    const b = computeFromStructure(standardStructure(), 25000, RATES, days(23, 17));
    expect(b.employee_pf).toBe(1330);
    expect(b.employer_pf).toBe(1330);
  });

  it('ESI rounds UP on the prorated earned wage while contracted wage keeps coverage', () => {
    // factor 22/26 → base 16923; 0.75% = 126.9225 → ceil 127.
    const b = computeFromStructure(standardStructure(), 20000, RATES, days(26, 22));
    expect(b.fixed_salary).toBe(16923);
    expect(b.esi).toBe(127);
  });

  it('a variable earning flagged pro_rata DOES scale with LOP (unlike the default variable line)', () => {
    const proRataBonus: StructureLineInput = {
      component_id: 9, name: 'Bonus', category: 'earning', calculation_type: 'flat', value: 2000,
      earning_type: 'variable', consider_epf: 'no', consider_esi: false, pro_rata: true,
    };
    const b = computeFromStructure(standardStructure([proRataBonus]), 20000, RATES, days(26, 13)); // 50%
    expect(b.variable_pay).toBe(1000); // 2000 × 0.5
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('zero / clamped-negative inputs & days=0', () => {
  it('zero base pays nothing and every total collapses to 0', () => {
    const b = computeFromStructure(standardStructure(), 0, RATES);
    expect(b.fixed_salary).toBe(0);
    expect(b.gross_earnings).toBe(0);
    expect(b.basic).toBe(0);
    expect(b.employee_pf).toBe(0);
    expect(b.esi).toBe(0);
    expect(b.lwf).toBe(0);
    expect(b.net_pay).toBe(0);
    expect(b.ctc).toBe(0);
    expect(b.employer_costs_total).toBe(0); // gratuity 4.81% of basic 0
  });

  it('negative payment_days is clamped to 0 (no negative pay)', () => {
    const b = computeFromStructure(standardStructure(), 20000, RATES, days(26, -5));
    expect(b.fixed_salary).toBe(0);
    expect(b.net_pay).toBe(0);
    expect(b.days?.payment_days).toBe(-5); // stored verbatim in the attendance context
  });

  it('working_days = 0 guards the denominator → factor 0, not a division by zero', () => {
    const att = { period_days: 30, working_days: 0, lop_days: 0, payment_days: 20 };
    const b = computeFromStructure(standardStructure(), 20000, RATES, att);
    expect(Number.isFinite(b.fixed_salary)).toBe(true);
    expect(b.fixed_salary).toBe(0);
    expect(b.net_pay).toBe(0);
  });

  it('full-LOP month (payment_days 0) zeroes pay and all statutory deductions', () => {
    const b = computeFromStructure(standardStructure(), 18000, RATES, days(26, 0));
    expect(b.gross_earnings).toBe(0);
    expect(b.employee_pf + b.esi + b.lwf + b.pt).toBe(0);
    expect(b.net_pay).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PF wage cap boundaries', () => {
  it('below / at / above the ₹15,000 ceiling', () => {
    expect(computeFromStructure(singleBasic(), 12000, RATES).employee_pf).toBe(1440); // 12% of 12000
    expect(computeFromStructure(singleBasic(), 15000, RATES).employee_pf).toBe(1800); // at cap
    expect(computeFromStructure(singleBasic(), 15001, RATES).employee_pf).toBe(1800); // just above → capped
  });

  it('wageCeiling = 0 disables the cap → PF charged on the full wage', () => {
    const noCap: StatutoryRates = { ...RATES, epf: { ...RATES.epf, wageCeiling: 0 } };
    expect(computeFromStructure(singleBasic(), 30000, noCap).employee_pf).toBe(3600); // 12% of 30000
    expect(computeFromStructure(singleBasic(), 30000, noCap).employer_pf).toBe(3600);
  });

  it('disabled EPF contributes nothing regardless of wage', () => {
    const off: StatutoryRates = { ...RATES, epf: { ...RATES.epf, enabled: false } };
    const b = computeFromStructure(singleBasic(), 15000, off);
    expect(b.employee_pf).toBe(0);
    expect(b.employer_pf).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ESI ceiling & rounding edges', () => {
  it('wageCeiling = 0 means no ceiling — a high earner stays covered', () => {
    const noCeil: StatutoryRates = { ...RATES, esi: { ...RATES.esi, wageCeiling: 0 } };
    expect(computeFromStructure(singleBasic(), 50000, noCeil).esi).toBe(Math.ceil(50000 * 0.0075)); // 375
  });

  it('coveredOverride is ignored when ESI itself is disabled', () => {
    const forcedButOff: StatutoryRates = { ...RATES, esi: { ...RATES.esi, enabled: false, coveredOverride: true } };
    const b = computeFromStructure(singleBasic(), 15000, forcedButOff);
    expect(b.esi).toBe(0);
    expect(b.employer_esi).toBe(0);
    expect(b.esi_covered).toBe(false);
  });

  it('ceil rounds a sub-rupee fraction up to the next whole rupee', () => {
    // Basic 13401 → 0.75% = 100.5075 → ceil 101.
    const b = computeFromStructure(singleBasic(), 13401, RATES);
    expect(b.esi).toBe(101);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LWF percent cap boundary & zero', () => {
  it('just below, exactly at, and above the state max', () => {
    expect(computeFromStructure(singleBasic(), 17000, RATES).lwf).toBe(34); // 0.2% = 34 < 35
    expect(computeFromStructure(singleBasic(), 17500, RATES).lwf).toBe(35); // 0.2% = 35 == cap
    expect(computeFromStructure(singleBasic(), 20000, RATES).lwf).toBe(35); // 0.2% = 40 → capped
  });

  it('employer LWF is the multiple of the (capped) employee amount', () => {
    expect(computeFromStructure(singleBasic(), 17000, RATES).employer_lwf).toBe(68); // 34 × 2
    expect(computeFromStructure(singleBasic(), 20000, RATES).employer_lwf).toBe(70); // 35 × 2
  });

  it('zero fixed salary → zero LWF (min against the cap stays 0)', () => {
    expect(computeFromStructure(singleBasic(), 0, RATES).lwf).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PT slab selection — boundaries, no-match, month override', () => {
  const mh: StatutoryRates = {
    ...DISABLED,
    pt: {
      enabled: true,
      slabs: [
        { min: 0, max: 7500, amount: 0 },
        { min: 7501, max: 10000, amount: 175 },
        { min: 10001, max: null, amount: 200, monthAmounts: { '4': 0 } }, // statutory-holiday month → 0
      ],
    },
  };
  const gross = (base: number, month: number | null = null) =>
    computeFromStructure(singleBasic(), base, mh, null, month).pt;

  it('inclusive slab boundaries pick the right band', () => {
    expect(gross(7500)).toBe(0);    // upper edge of band 1
    expect(gross(7501)).toBe(175);  // lower edge of band 2
    expect(gross(10000)).toBe(175); // upper edge of band 2
    expect(gross(10001)).toBe(200); // lower edge of band 3
  });

  it('no matching slab yields 0', () => {
    const gapped: StatutoryRates = { ...DISABLED, pt: { enabled: true, slabs: [{ min: 100000, max: null, amount: 500 }] } };
    expect(computeFromStructure(singleBasic(), 20000, gapped, null, 5).pt).toBe(0);
  });

  it('a per-month override of 0 is honoured (not treated as "fall back to slab amount")', () => {
    expect(gross(20000, 4)).toBe(0);   // April override → 0
    expect(gross(20000, 5)).toBe(200); // other month → slab amount
  });

  it('PT is an employee-only deduction folded into total_deduction and net', () => {
    const b = computeFromStructure(singleBasic(), 20000, mh, null, 5);
    expect(b.pt).toBe(200);
    expect(b.total_deduction).toBe(200); // everything else disabled
    expect(b.net_pay).toBe(b.gross_earnings - 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('structure edge shapes', () => {
  it('no pct_of_base line → basic anchor is 0 and pct_of_basic lines resolve to 0', () => {
    const flatOnly: StructureLineInput[] = [
      { component_id: 1, name: 'Wage', category: 'earning', calculation_type: 'flat', value: 20000, earning_type: 'fixed', consider_epf: 'no', consider_esi: false },
      { component_id: 2, name: 'Bonus', category: 'earning', calculation_type: 'pct_of_basic', value: 10, earning_type: 'fixed', consider_epf: 'no', consider_esi: false },
    ];
    const b = computeFromStructure(flatOnly, 20000, DISABLED);
    expect(b.basic).toBe(0);
    expect(b.earnings.find((l) => l.name === 'Bonus')?.amount).toBe(0);
    expect(b.fixed_salary).toBe(20000); // Wage only
  });

  it('remainder floors at 0 when fixed flat components already exceed the base', () => {
    const overspent: StructureLineInput[] = [
      { component_id: 1, name: 'Basic', category: 'earning', calculation_type: 'pct_of_base', value: 10, earning_type: 'fixed', consider_epf: 'no', consider_esi: false },
      { component_id: 2, name: 'Transport', category: 'earning', calculation_type: 'flat', value: 12000, earning_type: 'fixed', consider_epf: 'no', consider_esi: false },
      { component_id: 3, name: 'Other', category: 'earning', calculation_type: 'remainder', value: 0, earning_type: 'fixed', consider_epf: 'no', consider_esi: false },
    ];
    const b = computeFromStructure(overspent, 10000, DISABLED);
    expect(b.earnings.find((l) => l.name === 'Other')?.amount).toBe(0); // clamped, never negative
    expect(b.earnings.find((l) => l.name === 'Transport')?.amount).toBe(12000);
    expect(b.fixed_salary).toBe(13000); // 1000 + 12000 + 0
  });

  it('reimbursement lines lift net_pay and CTC but stay out of gross earnings', () => {
    const reimb: StructureLineInput = { component_id: 40, name: 'Fuel', category: 'reimbursement', calculation_type: 'flat', value: 2500 };
    const b = computeFromStructure(standardStructure([reimb]), 20000, RATES);
    expect(b.gross_earnings).toBe(20000); // reimbursement excluded from gross
    expect(b.reimbursements.find((l) => l.name === 'Fuel')?.amount).toBe(2500);
    // total_deduction = pf 1800 + esi 150 + lwf 35 = 1985; net = 20000 − 1985 + 2500.
    expect(b.total_deduction).toBe(1985);
    expect(b.net_pay).toBe(20515);
    // ctc = gross + er_pf 1800 + er_esi 650 + er_lwf 70 + gratuity 481 + reimb 2500.
    expect(b.ctc).toBe(25501);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('legacyBreakdownToLines — adapter branches', () => {
  it('a full legacy snapshot maps meal/accommodation deductions and drops a zero PLI', () => {
    const old = {
      basic: 8000, hra: 4000, other_allowance: 3000, pli: 0,
      meal: 600, accommodation: 1200, gratuity: 385, accommodation_allowance: 500,
      fixed_salary: 15000, gross_earnings: 15000,
      employee_pf: 960, esi: 0, lwf: 0, total_deduction: 1560, net_pay: 13440,
      employer_pf: 960, employer_esi: 0, employer_lwf: 0, ctc: 16345,
    };
    const b = legacyBreakdownToLines(old);
    expect(b.earnings.map((l) => l.name)).toEqual(['Basic', 'HRA', 'Other Allowance']); // no PLI at 0
    expect(b.variable_pay).toBe(0);
    expect(b.other_deductions.find((l) => l.name === 'Meal')?.amount).toBe(600);
    expect(b.other_deductions.find((l) => l.name === 'Accommodation')?.amount).toBe(1200);
    expect(b.employer_costs_total).toBe(885); // gratuity 385 + accommodation allowance 500
    expect(b.pt).toBe(0);
  });

  it('a v2 snapshot missing the pt field is backfilled to pt:0 as a fresh object', () => {
    const v2NoPt: any = {
      earnings: [{ component_id: 1, name: 'Basic', amount: 10000 }],
      net_pay: 15000, ctc: 20000,
    };
    const b = legacyBreakdownToLines(v2NoPt);
    expect(b.pt).toBe(0);
    expect(b.net_pay).toBe(15000);
    expect(b).not.toBe(v2NoPt);          // new object (spread), original untouched
    expect(b.earnings).toBe(v2NoPt.earnings); // shallow — earnings array shared by reference
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('date helpers — extra edges', () => {
  it('monthName returns "" outside 1–12', () => {
    expect(monthName(0)).toBe('');
    expect(monthName(13)).toBe('');
    expect(monthName(-1)).toBe('');
  });

  it('payDateFor last_day handles 28/30/31-day months', () => {
    expect(payDateFor(2, 2026)).toBe('2026-02-28'); // non-leap February
    expect(payDateFor(4, 2026)).toBe('2026-04-30'); // 30-day month
    expect(payDateFor(12, 2026)).toBe('2026-12-31'); // 31-day month
  });

  it('payDateFor fixed_day clamps day ≤ 0 to 1, truncates fractions, and caps to month length', () => {
    const fx = (day: number) => payDateFor(3, 2026, { pay_date_type: 'fixed_day', pay_date_day: day });
    expect(fx(0)).toBe('2026-04-01');   // 0 → 1
    expect(fx(-5)).toBe('2026-04-01');  // negative → 1
    expect(fx(10.9)).toBe('2026-04-10'); // truncated
    expect(fx(31)).toBe('2026-04-30');  // April has 30 days → clamped
  });
});
