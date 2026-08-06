// ─────────────────────────────────────────────────────────────────────────────
// What the statutory deductions are called, and the order they are listed in.
//
// The Salary page shows the same four twice — once on "My Salary Structure" and again on the
// payslip preview below it — and they disagreed on both counts: "Provident Fund / ESI /
// Professional Tax / Labour Welfare Fund" against "Employee PF / ESI / LWF / Professional Tax".
// Two cards, one screen, one scroll apart, naming the same deduction differently.
//
// "Employee PF" over "Provident Fund" on purpose: the payslip's CTC block lists Employer PF a few
// rows further down, and an employee reading two "PF" lines needs to know which one came out of
// their pay. "Labour Welfare Fund" over "LWF" for the opposite reason — an initialism nobody
// outside payroll can expand is not a label.
// ─────────────────────────────────────────────────────────────────────────────

/** The keys are `breakdown` fields on a computed payslip. Order is the display order. */
const STATUTORY: { key: string; label: string }[] = [
  { key: 'employee_pf', label: 'Employee PF' },
  { key: 'esi', label: 'ESI' },
  { key: 'pt', label: 'Professional Tax' },
  { key: 'lwf', label: 'Labour Welfare Fund' },
];

/**
 * The statutory deduction lines of a payslip breakdown, as [label, amount] pairs.
 *
 * `includeZero` is the caller's call and the two callers genuinely differ: a payslip is a record of
 * what was deducted, so it names each statutory head even at zero; the structure card is a summary
 * of what you can expect, where a row of zeroes is just noise.
 */
export function statutoryLines(
  breakdown: any,
  { includeZero = false }: { includeZero?: boolean } = {},
): [string, number][] {
  return STATUTORY
    .map(({ key, label }) => [label, Number(breakdown?.[key] ?? 0)] as [string, number])
    .filter(([, amount]) => includeZero || amount > 0);
}
