import type { Knex } from 'knex';

// Statutory component settings. One flexible table keyed by (component, state):
//  - EPF / ESI / Statutory Bonus are org-wide  → state = NULL
//  - Professional Tax / Labour Welfare Fund are per-state → state set
// `config` holds the component-specific JSON (rates, numbers, flags).
const STATES = ['Haryana', 'Delhi', 'Chandigarh', 'Uttar Pradesh', 'Uttarakhand'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('statutory_settings', (t) => {
    t.increments('id').primary();
    t.string('component', 30).notNullable(); // epf | esi | pt | lwf | bonus
    t.string('state', 100).nullable(); // NULL = org-wide
    t.integer('enabled').notNullable().defaultTo(0); // SQLite bool 0/1
    t.text('config').notNullable().defaultTo('{}'); // component-specific JSON
    t.integer('updated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.unique(['component', 'state']);
  });

  const rows: any[] = [
    // ── Org-wide (state = NULL), all disabled until configured ──
    {
      component: 'epf', state: null, enabled: 0,
      config: JSON.stringify({
        epfNumber: '', deductionCycle: 'monthly',
        employeeRatePct: 12, employerRatePct: 12,
        includeEmployerInCtc: true, includeEdli: false, includeAdminCharges: false,
        overrideAtEmployee: false, lopMode: 'prorate_restricted',
      }),
    },
    {
      component: 'esi', state: null, enabled: 0,
      config: JSON.stringify({
        esiNumber: '', deductionCycle: 'monthly',
        employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000,
        includeEmployerInCtc: false,
      }),
    },
    {
      component: 'bonus', state: null, enabled: 0,
      config: JSON.stringify({ frequency: 'monthly', monthlyPercent: 8.33 }),
    },
  ];

  // ── Per-state PT (Haryana not applicable) + LWF (disabled by default) ──
  for (const s of STATES) {
    rows.push({
      component: 'pt', state: s, enabled: 0,
      config: JSON.stringify({ applicable: s !== 'Haryana' }),
    });
    rows.push({
      component: 'lwf', state: s, enabled: 0,
      config: JSON.stringify({ employeePct: 0.20, employeeMaxAmount: 35.00, employerMultiplier: 2, deductionCycle: 'monthly' }),
    });
  }

  await knex('statutory_settings').insert(rows);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('statutory_settings');
}
