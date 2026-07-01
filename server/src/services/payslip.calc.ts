/**
 * Payslip computation engine.
 *
 * All amounts are monthly and rounded to the nearest rupee. Every formula here
 * maps 1:1 to the salary-structure spec:
 *
 *   A. Fixed Salary (= Gross, defined per minimum wage)
 *      Basic            = 50% of Gross
 *      HRA              = 50% of Basic
 *      Other Allowance  = Gross - Basic - HRA   (the remainder)
 *   B. Variable Pay
 *      PLI              = manual
 *   E. Deductions
 *      Employee PF      = 12% of (Basic + Other Allowance)
 *      ESI              = 0.75% of Gross
 *      LWF              = fixed, per city
 *      Meal             = manual
 *      Accommodation    = manual
 *   Net In Hand        = A + B - E
 *   C. Retirals (employer)
 *      Employer PF      = 12% of (Basic + Other Allowance)
 *      Gratuity         = 4.81% of Basic
 *      Employer LWF     = fixed, per city
 *   D. Benefits
 *      Employer ESI     = 3.25% of Gross
 *      Accommodation Allowance = tentative cost (manual)
 *   CTC                = A + B + C + D
 */

const round = (n: number) => Math.round(n);

// Labour Welfare Fund — fixed monthly contribution, varies by state/city.
// Values are indicative; HR can override per-employee via salary_setup.
export const LWF_BY_CITY: Record<string, { employee: number; employer: number }> = {
  Delhi: { employee: 0.75, employer: 2.25 },
  Gurugram: { employee: 31, employer: 62 },
  Haryana: { employee: 31, employer: 62 },
  Noida: { employee: 0, employer: 0 },
  Mumbai: { employee: 25, employer: 75 },
  Maharashtra: { employee: 25, employer: 75 },
  Bengaluru: { employee: 20, employer: 40 },
  Karnataka: { employee: 20, employer: 40 },
  Chandigarh: { employee: 5, employer: 20 },
};

const DEFAULT_LWF = { employee: 20, employer: 40 };

export function lwfForCity(city?: string | null) {
  if (!city) return DEFAULT_LWF;
  return LWF_BY_CITY[city] || DEFAULT_LWF;
}

// Default percentages — overridable per designation via the salary structure.
export interface SalaryPercentages {
  basic: number;        // % of Gross
  hra: number;          // % of Basic
  employee_pf: number;  // % of (Basic + Other Allowance)
  esi: number;          // % of Gross
  employer_pf: number;  // % of (Basic + Other Allowance)
  gratuity: number;     // % of Basic
  employer_esi: number; // % of Gross
}

export const DEFAULT_PERCENTAGES: SalaryPercentages = {
  basic: 50, hra: 50, employee_pf: 12, esi: 0.75,
  employer_pf: 12, gratuity: 4.81, employer_esi: 3.25,
};

export interface SalaryInputs {
  gross: number;
  city?: string | null;
  pli?: number;
  meal?: number;
  accommodation?: number;
  accommodation_allowance?: number;
  lwf_employee?: number | null;
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

export function computePayslip(input: SalaryInputs): PayslipBreakdown {
  const p: SalaryPercentages = { ...DEFAULT_PERCENTAGES, ...(input.pct || {}) };
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

  // LWF (override > city lookup)
  const cityLwf = lwfForCity(input.city);
  const lwf = round(input.lwf_employee ?? cityLwf.employee);
  const employer_lwf = round(input.lwf_employer ?? cityLwf.employer);

  // E. Deductions
  const pfBase = basic + other_allowance;
  const employee_pf = round((p.employee_pf / 100) * pfBase);
  const esi = round((p.esi / 100) * gross);
  const total_deduction = employee_pf + esi + lwf + meal + accommodation;

  // Net In Hand (A + B - E)
  const net_pay = fixed_salary + pli - total_deduction;

  // C. Retirals (employer contributions)
  const employer_pf = round((p.employer_pf / 100) * pfBase);
  const gratuity = round((p.gratuity / 100) * basic);
  const retirals = employer_pf + gratuity + employer_lwf;

  // D. Benefits
  const employer_esi = round((p.employer_esi / 100) * gross);
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

/** Pay date = last calendar day of the selected month. */
export function payDateFor(month: number, year: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}
