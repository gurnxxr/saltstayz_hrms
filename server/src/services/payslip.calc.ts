/**
 * Payslip computation engine (pure — no DB access).
 *
 * All amounts are monthly and rounded to the nearest rupee (ESI rounds UP, per
 * statute). The salary COMPOSITION (Basic/HRA split, gratuity) comes from the
 * designation structure; all STATUTORY rates (EPF, ESI, LWF) are injected via
 * `StatutoryRates`, resolved from the editable Statutory Components settings —
 * never hardcoded here.
 *
 *   A. Fixed Salary (= Gross)
 *      Basic            = pct.basic% of Gross
 *      HRA              = pct.hra% of Basic
 *      Other Allowance  = Gross - Basic - HRA   (the remainder)
 *   B. Variable Pay
 *      PLI              = manual
 *   E. Deductions
 *      Employee PF      = epf.employeeRatePct% of (Basic + Other Allowance), if enabled
 *      ESI              = esi.employeeRatePct% of Gross, if enabled and Gross ≤ wage ceiling
 *      LWF              = employeePct% of Gross capped at employeeMaxAmount, if enabled
 *      Meal             = manual
 *      Accommodation    = manual
 *   Net In Hand        = A + B - E
 *   C. Retirals (employer)
 *      Employer PF      = epf.employerRatePct% of (Basic + Other Allowance)
 *      Gratuity         = pct.gratuity% of Basic
 *      Employer LWF     = employee LWF × employerMultiplier
 *   D. Benefits
 *      Employer ESI     = esi.employerRatePct% of Gross (same eligibility)
 *      Accommodation Allowance = tentative cost (manual)
 *   CTC                = A + B + C + D
 */

const round = (n: number) => Math.round(n);
const ceil = (n: number) => Math.ceil(n);

// ─── Composition percentages (per designation structure) ───

export interface SalaryPercentages {
  basic: number;    // % of Gross
  hra: number;      // % of Basic
  gratuity: number; // % of Basic (employer retiral)
}

export const DEFAULT_COMPOSITION: SalaryPercentages = { basic: 50, hra: 50, gratuity: 4.81 };

// ─── Statutory rates (resolved from statutory_settings — see statutory.service) ───

export interface StatutoryRates {
  epf: { enabled: boolean; employeeRatePct: number; employerRatePct: number };
  esi: { enabled: boolean; employeeRatePct: number; employerRatePct: number; wageCeiling: number };
  lwf: { enabled: boolean; employeePct: number; employeeMaxAmount: number; employerMultiplier: number };
}

export interface SalaryInputs {
  gross: number;
  city?: string | null;
  pli?: number;
  meal?: number;
  accommodation?: number;
  accommodation_allowance?: number;
  lwf_employee?: number | null;  // explicit per-employee/structure override
  lwf_employer?: number | null;
  pct?: Partial<SalaryPercentages>;
}

export interface PayslipBreakdown {
  // A. Fixed salary
  basic: number;
  hra: number;
  other_allowance: number;
  fixed_salary: number; // A
  // B. Variable
  pli: number; // B
  gross_earnings: number; // A + B
  // E. Deductions
  employee_pf: number;
  esi: number;
  lwf: number;
  meal: number;
  accommodation: number;
  total_deduction: number; // E
  // Net
  net_pay: number; // A + B - E
  // C. Retirals
  employer_pf: number;
  gratuity: number;
  employer_lwf: number;
  retirals: number; // C
  // D. Benefits
  employer_esi: number;
  accommodation_allowance: number;
  benefits: number; // D
  // Total
  ctc: number; // A + B + C + D
}

export function computePayslip(input: SalaryInputs, statutory: StatutoryRates): PayslipBreakdown {
  const p: SalaryPercentages = { ...DEFAULT_COMPOSITION, ...(input.pct || {}) };
  const gross = round(input.gross || 0);
  const pli = round(input.pli || 0);
  const meal = round(input.meal || 0);
  const accommodation = round(input.accommodation || 0);
  const accommodationAllowance = round(input.accommodation_allowance || 0);

  // A. Fixed Salary
  const basic = round(gross * (p.basic / 100));
  const hra = round(basic * (p.hra / 100));
  const other_allowance = gross - basic - hra; // remainder keeps A == gross exactly
  const fixed_salary = gross;

  // B. Variable Pay
  const gross_earnings = fixed_salary + pli;

  // LWF — % of gross capped at the state max (explicit override wins)
  const lwfCfg = statutory.lwf;
  const lwfCalc = lwfCfg.enabled
    ? Math.min(round((lwfCfg.employeePct / 100) * gross), round(lwfCfg.employeeMaxAmount))
    : 0;
  const lwf = round(input.lwf_employee ?? lwfCalc);
  const employer_lwf = round(input.lwf_employer ?? (lwfCfg.enabled ? lwfCalc * lwfCfg.employerMultiplier : 0));

  // EPF — on PF wages (Basic + Other Allowance)
  const pfBase = basic + other_allowance;
  const employee_pf = statutory.epf.enabled ? round((statutory.epf.employeeRatePct / 100) * pfBase) : 0;
  const employer_pf = statutory.epf.enabled ? round((statutory.epf.employerRatePct / 100) * pfBase) : 0;

  // ESI — only while gross is within the wage ceiling; contributions round UP per statute
  const esiEligible = statutory.esi.enabled
    && (statutory.esi.wageCeiling <= 0 || gross <= statutory.esi.wageCeiling);
  const esi = esiEligible ? ceil((statutory.esi.employeeRatePct / 100) * gross) : 0;
  const employer_esi = esiEligible ? ceil((statutory.esi.employerRatePct / 100) * gross) : 0;

  // E. Deductions
  const total_deduction = employee_pf + esi + lwf + meal + accommodation;

  // Net In Hand (A + B - E)
  const net_pay = fixed_salary + pli - total_deduction;

  // C. Retirals (employer contributions)
  const gratuity = round((p.gratuity / 100) * basic);
  const retirals = employer_pf + gratuity + employer_lwf;

  // D. Benefits
  const benefits = employer_esi + accommodationAllowance;

  // CTC (A + B + C + D)
  const ctc = fixed_salary + pli + retirals + benefits;

  return {
    basic, hra, other_allowance, fixed_salary,
    pli, gross_earnings,
    employee_pf, esi, lwf, meal, accommodation, total_deduction,
    net_pay,
    employer_pf, gratuity, employer_lwf, retirals,
    employer_esi, accommodation_allowance: accommodationAllowance, benefits,
    ctc,
  };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number) {
  return MONTHS[month - 1] || '';
}

export interface PayDateSchedule {
  pay_date_type: string; // 'last_day' | 'fixed_day'
  pay_date_day: number;
}

/**
 * Pay date for a salary month, honouring the Pay Schedule settings:
 *  - last_day (default): the last calendar day of the salary month
 *  - fixed_day N: day N of the FOLLOWING month (salary is paid after the month
 *    ends), clamped to that month's length
 */
export function payDateFor(month: number, year: number, schedule?: PayDateSchedule | null): string {
  const fmt = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  if (schedule?.pay_date_type === 'fixed_day') {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const daysInNext = new Date(nextYear, nextMonth, 0).getDate();
    const day = Math.min(Math.max(1, Math.trunc(schedule.pay_date_day) || 1), daysInNext);
    return fmt(nextYear, nextMonth, day);
  }

  const lastDay = new Date(year, month, 0).getDate();
  return fmt(year, month, lastDay);
}
