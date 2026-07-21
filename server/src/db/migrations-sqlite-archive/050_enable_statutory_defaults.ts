import type { Knex } from 'knex';

// Payroll Phase 1: the payslip engine now reads EPF/ESI/LWF rates from
// statutory_settings instead of hardcoded constants. The settings were seeded
// disabled (config-only UI); enable them with defaults matching the previous
// hardcoded behaviour so payslips keep producing deductions after the switch.
// Rates remain fully editable from Payroll → Statutory Components.

const STATES = ['Haryana', 'Delhi', 'Chandigarh', 'Uttar Pradesh', 'Uttarakhand'];

const EPF_CONFIG = {
  epfNumber: '', deductionCycle: 'monthly',
  employeeRatePct: 12, employerRatePct: 12,
  includeEmployerInCtc: true, includeEdli: false, includeAdminCharges: false,
  overrideAtEmployee: false, lopMode: 'prorate_restricted',
};
const ESI_CONFIG = {
  esiNumber: '', deductionCycle: 'monthly',
  employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000,
  includeEmployerInCtc: false,
};
const LWF_CONFIG = { employeePct: 0.20, employeeMaxAmount: 35, employerMultiplier: 2, deductionCycle: 'monthly' };

async function enable(knex: Knex, component: string, state: string | null, config: any) {
  const q = state == null
    ? knex('statutory_settings').where('component', component).whereNull('state')
    : knex('statutory_settings').where({ component, state });
  const existing = await q.first();
  if (existing) {
    // Keep any admin-edited config; only flip the enabled bit.
    await knex('statutory_settings').where('id', existing.id).update({ enabled: 1, updated_at: knex.fn.now() });
  } else {
    await knex('statutory_settings').insert({
      component, state: state ?? null, enabled: 1, config: JSON.stringify(config),
    });
  }
}

export async function up(knex: Knex): Promise<void> {
  await enable(knex, 'epf', null, EPF_CONFIG);
  await enable(knex, 'esi', null, ESI_CONFIG);
  for (const state of STATES) await enable(knex, 'lwf', state, LWF_CONFIG);
  // PT stays disabled — none of the operating states levy professional tax today.
}

export async function down(knex: Knex): Promise<void> {
  await knex('statutory_settings').where('component', 'epf').whereNull('state').update({ enabled: 0 });
  await knex('statutory_settings').where('component', 'esi').whereNull('state').update({ enabled: 0 });
  await knex('statutory_settings').where('component', 'lwf').whereIn('state', STATES).update({ enabled: 0 });
}
