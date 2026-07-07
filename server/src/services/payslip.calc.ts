/**
 * Payslip computation engine (pure — no DB access).
 *
 * Phase 2: component-based. A salary structure is a list of catalog-component
 * lines; each line's value rule is one of:
 *   flat          — a fixed monthly amount
 *   pct_of_base   — % of the employee's assigned base (monthly gross)
 *   pct_of_basic  — % of the computed Basic line
 *   remainder     — base minus every other FIXED earning (keeps earnings == base)
 *
 * The component's catalog config decides behaviour:
 *   category      — earning | deduction | benefit (employer cost) | reimbursement
 *   earningType   — fixed (part of gross) | variable (paid on top, e.g. PLI)
 *   considerEpf   — 'always' | 'if_below_15000' | 'no'  → PF wage base
 *   considerEsi   — boolean                              → ESI wage base
 *
 * STATUTORY deductions (EPF, ESI, LWF) are computed by the engine from the
 * injected `StatutoryRates` (Payroll → Statutory Components) — never hardcoded.
 * All amounts are monthly, rounded to the nearest rupee (ESI rounds UP per statute).
 */

const round = (n: number) => Math.round(n);
const ceil = (n: number) => Math.ceil(n);

// ─── Statutory rates (resolved from statutory_settings — see statutory.service) ───

export interface PtSlab {
  min: number;            // monthly gross lower bound (inclusive)
  max: number | null;     // upper bound (inclusive); null = no upper limit
  amount: number;         // monthly PT amount in this slab
  monthAmounts?: Record<string, number>; // calendar-month overrides, e.g. { "2": 300 }
}

export interface StatutoryRates {
  epf: { enabled: boolean; employeeRatePct: number; employerRatePct: number };
  esi: { enabled: boolean; employeeRatePct: number; employerRatePct: number; wageCeiling: number };
  lwf: {
    enabled: boolean;
    mode: 'percent' | 'fixed';
    // percent mode: % of fixed gross capped at a max, employer = multiple
    employeePct: number; employeeMaxAmount: number; employerMultiplier: number;
    // fixed mode: flat state amounts
    employeeAmount: number; employerAmount: number;
    // calendar months the deduction applies in; empty = every month.
    // Half-yearly states (e.g. Delhi: June & December) list their months here.
    deductionMonths: number[];
  };
  pt: { enabled: boolean; slabs: PtSlab[] };
}

// ─── Structure lines (resolved from salary_structure_components + catalog) ───

export type LineCalcType = 'flat' | 'pct_of_base' | 'pct_of_basic' | 'remainder';

export interface StructureLineInput {
  component_id: number | null; // null for injected manual adjustment lines
  name: string; // name_in_payslip
  category: 'earning' | 'deduction' | 'benefit' | 'reimbursement';
  calculation_type: LineCalcType;
  value: number;
  earning_type?: 'fixed' | 'variable';
  consider_epf?: 'no' | 'always' | 'if_below_15000';
  consider_esi?: boolean;
  pro_rata?: boolean; // flat earning lines only: scale by payment/working days
}

/**
 * Attendance context for a pay period (from the payable-days engine).
 * Monthly-rated: pay is prorated by payment_days / working_days.
 * Hourly-rated: pass `hours` — pay = base (hourly rate) × hours.
 */
export interface AttendanceContext {
  period_days: number;
  working_days: number;
  lop_days: number;
  payment_days: number;
  not_employed_days?: number;      // scheduled working days outside the employment span
  hours?: number | null; // hourly-rated only: attendance working hours
  counts?: Record<string, number>; // day-status counts for the review screen
  lop_overridden?: boolean;        // HR replaced the computed LOP in review
}

export interface PayslipLine {
  component_id: number | null;
  name: string;
  amount: number;
}

export interface PayslipBreakdown {
  // Component lines
  earnings: PayslipLine[];         // fixed + variable earnings
  other_deductions: PayslipLine[]; // component deductions (meal, accommodation, …)
  employer_costs: PayslipLine[];   // benefit lines (gratuity provision, accom. allowance, …)
  reimbursements: PayslipLine[];   // paid with salary, outside gross
  // Anchors + totals
  basic: number;          // the Basic line (statutory & F&F anchor)
  fixed_salary: number;   // Σ fixed earnings (== base for monthly structures)
  variable_pay: number;   // Σ variable earnings
  gross_earnings: number; // fixed + variable
  // Statutory employee deductions
  employee_pf: number;
  esi: number;
  lwf: number;
  pt: number;              // Professional Tax (state slab; 0 where not levied)
  total_deduction: number; // statutory + other_deductions
  net_pay: number;         // gross − deductions + reimbursements
  // Employer side
  employer_pf: number;
  employer_esi: number;
  employer_lwf: number;
  employer_costs_total: number; // Σ employer_costs lines
  ctc: number;                  // gross + employer statutory + employer costs + reimbursements
  // Attendance context (present when the slip is attendance-driven)
  days?: AttendanceContext;
}

/**
 * Computes a payslip from resolved structure lines at the assigned base.
 *
 * With an AttendanceContext the pay becomes attendance-driven:
 *  - monthly: the base is prorated by payment_days / working_days, so every
 *    percentage line (and the remainder) shrinks with Loss of Pay; flat earning
 *    lines scale too when their component is pro-rata.
 *  - hourly (`hours` present): pay = base (hourly rate) × attendance hours.
 */
export function computeFromStructure(
  lines: StructureLineInput[],
  base: number,
  statutory: StatutoryRates,
  attendance?: AttendanceContext | null,
  month?: number | null, // calendar month of the pay period — drives cyclical statutory items (LWF months, PT overrides)
): PayslipBreakdown {
  const isHourly = attendance?.hours !== undefined && attendance?.hours !== null;
  const factor = !attendance || isHourly
    ? 1
    : (attendance.working_days > 0 ? Math.max(0, attendance.payment_days) / attendance.working_days : 0);
  const b = isHourly
    ? round((base || 0) * (attendance!.hours || 0))
    : round((base || 0) * factor);

  // ── Pass 1: flat + pct_of_base amounts; find Basic ──
  const amounts = new Map<StructureLineInput, number>();
  for (const line of lines) {
    if (line.calculation_type === 'flat') {
      const scale = line.category === 'earning' && line.pro_rata && !isHourly ? factor : 1;
      amounts.set(line, round(line.value * scale));
    } else if (line.calculation_type === 'pct_of_base') amounts.set(line, round((line.value / 100) * b));
  }
  const basicLine = lines.find((l) => l.category === 'earning' && l.calculation_type === 'pct_of_base' && /basic/i.test(l.name))
    ?? lines.find((l) => l.category === 'earning' && l.calculation_type === 'pct_of_base');
  const basic = basicLine ? (amounts.get(basicLine) ?? 0) : 0;

  // ── Pass 2: pct_of_basic ──
  for (const line of lines) {
    if (line.calculation_type === 'pct_of_basic') amounts.set(line, round((line.value / 100) * basic));
  }

  // ── Pass 3: remainder (earnings only) — base minus every other FIXED earning ──
  const isFixedEarning = (l: StructureLineInput) => l.category === 'earning' && (l.earning_type ?? 'fixed') === 'fixed';
  for (const line of lines) {
    if (line.calculation_type !== 'remainder') continue;
    const others = lines
      .filter((l) => l !== line && isFixedEarning(l) && l.calculation_type !== 'remainder')
      .reduce((sum, l) => sum + (amounts.get(l) ?? 0), 0);
    amounts.set(line, Math.max(0, b - others));
  }

  const toLine = (l: StructureLineInput): PayslipLine => ({
    component_id: l.component_id, name: l.name, amount: amounts.get(l) ?? 0,
  });

  const earningLines = lines.filter((l) => l.category === 'earning');
  const earnings = earningLines.map(toLine);
  const other_deductions = lines.filter((l) => l.category === 'deduction').map(toLine);
  const employer_costs = lines.filter((l) => l.category === 'benefit').map(toLine);
  const reimbursements = lines.filter((l) => l.category === 'reimbursement').map(toLine);

  const fixed_salary = earningLines.filter(isFixedEarning).reduce((s, l) => s + (amounts.get(l) ?? 0), 0);
  const variable_pay = earningLines.filter((l) => !isFixedEarning(l)).reduce((s, l) => s + (amounts.get(l) ?? 0), 0);
  const gross_earnings = fixed_salary + variable_pay;

  // ── Statutory bases from component applicability flags ──
  const pfBase = earningLines.reduce((sum, l) => {
    const flag = l.consider_epf ?? 'no';
    const include = flag === 'always' || (flag === 'if_below_15000' && fixed_salary <= 15000);
    return include ? sum + (amounts.get(l) ?? 0) : sum;
  }, 0);
  const esiBase = earningLines.reduce((sum, l) => (l.consider_esi ? sum + (amounts.get(l) ?? 0) : sum), 0);

  // EPF
  const employee_pf = statutory.epf.enabled ? round((statutory.epf.employeeRatePct / 100) * pfBase) : 0;
  const employer_pf = statutory.epf.enabled ? round((statutory.epf.employerRatePct / 100) * pfBase) : 0;

  // ESI — only while wages are within the ceiling; contributions round UP per statute
  const esiEligible = statutory.esi.enabled
    && (statutory.esi.wageCeiling <= 0 || esiBase <= statutory.esi.wageCeiling);
  const esi = esiEligible ? ceil((statutory.esi.employeeRatePct / 100) * esiBase) : 0;
  const employer_esi = esiEligible ? ceil((statutory.esi.employerRatePct / 100) * esiBase) : 0;

  // LWF — per-state config: percent-of-gross+cap or fixed amounts, deducted only
  // in the state's deduction months (empty = every month). Without a known month
  // (reference/preview breakdowns) only monthly-cycle LWF is shown.
  const lwfCfg = statutory.lwf;
  const months = lwfCfg.deductionMonths ?? [];
  const lwfDue = lwfCfg.enabled
    && (months.length === 0 || (month != null && months.includes(month)));
  let lwf = 0;
  let employer_lwf = 0;
  if (lwfDue) {
    if (lwfCfg.mode === 'fixed') {
      lwf = round(lwfCfg.employeeAmount);
      employer_lwf = round(lwfCfg.employerAmount);
    } else {
      lwf = Math.min(round((lwfCfg.employeePct / 100) * fixed_salary), round(lwfCfg.employeeMaxAmount));
      employer_lwf = round(lwf * lwfCfg.employerMultiplier);
    }
  }

  // PT — state slab on monthly gross earnings; employee-only deduction.
  const ptCfg = statutory.pt;
  let pt = 0;
  if (ptCfg?.enabled && Array.isArray(ptCfg.slabs)) {
    const slab = ptCfg.slabs.find((s) =>
      gross_earnings >= (Number(s.min) || 0) && (s.max == null || gross_earnings <= Number(s.max)));
    if (slab) {
      const override = month != null ? slab.monthAmounts?.[String(month)] : undefined;
      pt = round(Number(override ?? slab.amount) || 0);
    }
  }

  const otherDeductionTotal = other_deductions.reduce((s, l) => s + l.amount, 0);
  const reimbursementTotal = reimbursements.reduce((s, l) => s + l.amount, 0);
  const employer_costs_total = employer_costs.reduce((s, l) => s + l.amount, 0);

  const total_deduction = employee_pf + esi + lwf + pt + otherDeductionTotal;
  const net_pay = gross_earnings - total_deduction + reimbursementTotal;
  const ctc = gross_earnings + employer_pf + employer_esi + employer_lwf + employer_costs_total + reimbursementTotal;

  return {
    earnings, other_deductions, employer_costs, reimbursements,
    basic, fixed_salary, variable_pay, gross_earnings,
    employee_pf, esi, lwf, pt, total_deduction, net_pay,
    employer_pf, employer_esi, employer_lwf, employer_costs_total, ctc,
    ...(attendance ? { days: attendance } : {}),
  };
}

/**
 * Adapts a legacy (pre-Phase-2) breakdown snapshot to the lines shape so old
 * stored payslips keep rendering (PDF re-downloads).
 */
export function legacyBreakdownToLines(old: any): PayslipBreakdown {
  if (old && Array.isArray(old.earnings)) {
    if (typeof old.pt === 'number') return old as PayslipBreakdown; // already v2, current shape
    // v2 snapshot stored before Work-Location State — default the pt field
    return { ...(old as PayslipBreakdown), pt: 0 };
  }
  const n = (v: any) => Number(v) || 0;
  const line = (name: string, amount: number): PayslipLine => ({ component_id: null, name, amount });
  const earnings: PayslipLine[] = [
    line('Basic', n(old?.basic)), line('HRA', n(old?.hra)), line('Other Allowance', n(old?.other_allowance)),
  ];
  if (n(old?.pli) > 0) earnings.push(line('PLI (Variable Pay)', n(old?.pli)));
  const other_deductions: PayslipLine[] = [];
  if (n(old?.meal) > 0) other_deductions.push(line('Meal', n(old?.meal)));
  if (n(old?.accommodation) > 0) other_deductions.push(line('Accommodation', n(old?.accommodation)));
  const employer_costs: PayslipLine[] = [];
  if (n(old?.gratuity) > 0) employer_costs.push(line('Gratuity', n(old?.gratuity)));
  if (n(old?.accommodation_allowance) > 0) employer_costs.push(line('Accommodation Allowance', n(old?.accommodation_allowance)));
  return {
    earnings, other_deductions, employer_costs, reimbursements: [],
    basic: n(old?.basic), fixed_salary: n(old?.fixed_salary), variable_pay: n(old?.pli),
    gross_earnings: n(old?.gross_earnings),
    employee_pf: n(old?.employee_pf), esi: n(old?.esi), lwf: n(old?.lwf), pt: 0,
    total_deduction: n(old?.total_deduction), net_pay: n(old?.net_pay),
    employer_pf: n(old?.employer_pf), employer_esi: n(old?.employer_esi), employer_lwf: n(old?.employer_lwf),
    employer_costs_total: n(old?.gratuity) + n(old?.accommodation_allowance),
    ctc: n(old?.ctc),
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
