import type { Knex } from 'knex';

// Payroll v2 Phase 1: Work-Location State.
//
// Statutory values belong to the STATE of the employee's property (work
// location), and every state rule lives in editable config — nothing hardcoded.
// This migration:
//   1. Backfills properties.state (from city where possible) so the engine can
//      resolve employee → property → state. The org UI makes it mandatory.
//   2. Restructures LWF config to { mode: fixed|percent, amounts, months }:
//      - Haryana keeps its percent-of-gross + cap model (monthly);
//      - Delhi becomes fixed ₹0.75 / ₹2.25 deducted only in June & December;
//      - Chandigarh becomes fixed ₹5 / ₹20 monthly (Punjab LWF rates);
//      - Uttar Pradesh & Uttarakhand are DISABLED — neither has an LWF act,
//        so the deduction seeded by migration 050 was unlawful.
//      All values are editable defaults, not rules in code.
//   3. Converts PT rows to the slab model ({ slabs: [] }, disabled) — none of
//      the current operating states levy PT; the slab editor makes expansion
//      states pure data entry.
export async function up(knex: Knex): Promise<void> {
  // ── 1. Backfill properties.state ──
  const CITY_TO_STATE: Record<string, string> = {
    Gurugram: 'Haryana', Gurgaon: 'Haryana', Faridabad: 'Haryana', Haryana: 'Haryana',
    Delhi: 'Delhi', 'New Delhi': 'Delhi',
    Noida: 'Uttar Pradesh', 'Greater Noida': 'Uttar Pradesh', 'Uttar Pradesh': 'Uttar Pradesh',
    Chandigarh: 'Chandigarh',
    Dehradun: 'Uttarakhand', Uttarakhand: 'Uttarakhand',
  };
  const properties = await knex('properties').select('id', 'city', 'state');
  for (const p of properties) {
    const current = (p.state || '').trim();
    if (current && current.length > 1) continue; // already set — leave it alone
    const derived = CITY_TO_STATE[(p.city || '').trim()] || 'Haryana';
    await knex('properties').where('id', p.id).update({ state: derived });
  }

  // ── 2. LWF → { mode, employee_amount, employer_amount, percent fields, deduction_months } ──
  const lwfRows = await knex('statutory_settings').where('component', 'lwf').select('*');
  const parse = (raw: any) => { try { return JSON.parse(raw || '{}'); } catch { return {}; } };

  for (const row of lwfRows) {
    const old = parse(row.config);
    let cfg: any = {
      mode: 'percent',
      employeePct: Number(old.employeePct) || 0.2,
      employeeMaxAmount: Number(old.employeeMaxAmount) || 35,
      employerMultiplier: Number(old.employerMultiplier) || 2,
      employeeAmount: 0,
      employerAmount: 0,
      deductionMonths: [] as number[], // empty = every month
    };
    let enabled = row.enabled;

    if (row.state === 'Delhi') {
      cfg = { ...cfg, mode: 'fixed', employeeAmount: 0.75, employerAmount: 2.25, deductionMonths: [6, 12] };
    } else if (row.state === 'Chandigarh') {
      cfg = { ...cfg, mode: 'fixed', employeeAmount: 5, employerAmount: 20, deductionMonths: [] };
    } else if (row.state === 'Uttar Pradesh' || row.state === 'Uttarakhand') {
      enabled = 0; // no LWF act in these states — stop the unlawful deduction
    }

    await knex('statutory_settings').where('id', row.id).update({
      enabled, config: JSON.stringify(cfg), updated_at: knex.fn.now(),
    });
  }

  // ── 3. PT → slab model, disabled until real slabs are entered ──
  const ptRows = await knex('statutory_settings').where('component', 'pt').select('*');
  for (const row of ptRows) {
    await knex('statutory_settings').where('id', row.id).update({
      enabled: 0, config: JSON.stringify({ slabs: [] }), updated_at: knex.fn.now(),
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Forward-only data migration: the old LWF/PT config shapes are not restored.
  // properties.state backfill is harmless to keep.
}
