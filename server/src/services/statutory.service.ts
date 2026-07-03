import db from '../config/database';
import { ValidationError } from '../utils/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Statutory Components settings. `statutory_settings` holds one row per
// (component, state): EPF/ESI/Bonus are org-wide (state NULL); PT/LWF are per
// state. Config is a JSON blob parsed/merged over per-component defaults.
// STATUTORY_STATES is the canonical operating-state list (Haryana = head office);
// property.state is unreliable (nullable, partially seeded) so we don't derive
// the list from it.
// ─────────────────────────────────────────────────────────────────────────────

export const STATUTORY_STATES = ['Haryana', 'Delhi', 'Chandigarh', 'Uttar Pradesh', 'Uttarakhand'];

const TABLE = 'statutory_settings';
const MW_TABLE = 'state_minimum_wages';

const EPF_DEFAULT = {
  epfNumber: '', deductionCycle: 'monthly',
  employeeRatePct: 12, employerRatePct: 12,
  includeEmployerInCtc: true, includeEdli: false, includeAdminCharges: false,
  overrideAtEmployee: false, lopMode: 'prorate_restricted',
};
const ESI_DEFAULT = {
  esiNumber: '', deductionCycle: 'monthly',
  employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000,
  includeEmployerInCtc: false,
};
const BONUS_DEFAULT = { frequency: 'monthly', monthlyPercent: 8.33 };
const LWF_DEFAULT = { employeePct: 0.20, employeeMaxAmount: 35.00, employerMultiplier: 2, deductionCycle: 'monthly' };

function parseConfig(row: any, fallback: any) {
  if (!row) return { ...fallback };
  try {
    return { ...fallback, ...JSON.parse(row.config || '{}') };
  } catch {
    return { ...fallback };
  }
}

function num(v: any, name: string, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ValidationError(`${name} must be between ${min} and ${max}.`);
  }
  return n;
}

// ─── Read: the whole module in one shot ───

export async function getAllStatutory() {
  const rows = await db(TABLE).select('*');
  const org = (c: string) => rows.find((r: any) => r.component === c && r.state == null);
  const perState = (c: string, state: string) => rows.find((r: any) => r.component === c && r.state === state);

  const epf = org('epf');
  const esi = org('esi');
  const bonus = org('bonus');

  const settings = {
    epf: { enabled: !!(epf && epf.enabled), config: parseConfig(epf, EPF_DEFAULT), updated_at: epf?.updated_at },
    esi: { enabled: !!(esi && esi.enabled), config: parseConfig(esi, ESI_DEFAULT), updated_at: esi?.updated_at },
    bonus: { enabled: !!(bonus && bonus.enabled), config: parseConfig(bonus, BONUS_DEFAULT), updated_at: bonus?.updated_at },
    pt: STATUTORY_STATES.map((s) => {
      const r = perState('pt', s);
      const config = parseConfig(r, { applicable: s !== 'Haryana' });
      return { state: s, enabled: !!(r && r.enabled), applicable: config.applicable !== false, config };
    }),
    lwf: STATUTORY_STATES.map((s) => {
      const r = perState('lwf', s);
      return { state: s, enabled: !!(r && r.enabled), config: parseConfig(r, LWF_DEFAULT) };
    }),
  };

  const minimumWages = await db(MW_TABLE).select('*').orderBy('state');
  return { states: STATUTORY_STATES, settings, minimumWages };
}

// ─── Write: shared upsert (keeps existing config when the caller omits it) ───

async function upsertComponent(
  component: string,
  state: string | null,
  input: { enabled?: boolean; config?: any },
  defaults: any,
  userId?: number,
) {
  const q = state == null
    ? db(TABLE).where('component', component).whereNull('state')
    : db(TABLE).where({ component, state });
  const existing = await q.first();

  const base = existing ? parseConfig(existing, defaults) : { ...defaults };
  const merged = { ...base, ...(input.config || {}) };
  const enabled = input.enabled === undefined
    ? (existing ? existing.enabled : 0)
    : (input.enabled ? 1 : 0);

  const patch = { enabled, config: JSON.stringify(merged), updated_by: userId || null, updated_at: db.fn.now() };
  if (existing) await db(TABLE).where('id', existing.id).update(patch);
  else await db(TABLE).insert({ component, state: state ?? null, ...patch });
}

export async function saveEpf(input: any, userId?: number) {
  const c = input.config || {};
  const cfg = {
    epfNumber: String(c.epfNumber || '').trim(),
    deductionCycle: 'monthly',
    employeeRatePct: num(c.employeeRatePct ?? 12, 'Employee contribution rate', 0.01, 100),
    employerRatePct: num(c.employerRatePct ?? 12, 'Employer contribution rate', 0.01, 100),
    includeEmployerInCtc: !!c.includeEmployerInCtc,
    includeEdli: !!c.includeEdli,
    includeAdminCharges: !!c.includeAdminCharges,
    overrideAtEmployee: !!c.overrideAtEmployee,
    lopMode: ['prorate_restricted', 'consider_all_below_15000'].includes(c.lopMode) ? c.lopMode : 'prorate_restricted',
  };
  if (input.enabled && !/^[A-Z]{2}\/[A-Z]{3}\/\d{7}\/\d{3}$/.test(cfg.epfNumber)) {
    throw new ValidationError('EPF Number must match the format AA/AAA/0000000/XXX.');
  }
  await upsertComponent('epf', null, { enabled: input.enabled, config: cfg }, EPF_DEFAULT, userId);
  return getAllStatutory();
}

export async function saveEsi(input: any, userId?: number) {
  const c = input.config || {};
  const cfg = {
    esiNumber: String(c.esiNumber || '').trim(),
    deductionCycle: 'monthly',
    employeeRatePct: num(c.employeeRatePct ?? 0.75, "Employees' contribution", 0, 100),
    employerRatePct: num(c.employerRatePct ?? 3.25, "Employer's contribution", 0, 100),
    wageCeiling: 21000,
    includeEmployerInCtc: !!c.includeEmployerInCtc,
  };
  if (input.enabled && !/^\d{2}-\d{2}-\d{6}-\d{3}-\d{4}$/.test(cfg.esiNumber)) {
    throw new ValidationError('ESI Number must match the format 00-00-000000-000-0000.');
  }
  await upsertComponent('esi', null, { enabled: input.enabled, config: cfg }, ESI_DEFAULT, userId);
  return getAllStatutory();
}

export async function saveBonus(input: any, userId?: number) {
  const c = input.config || {};
  const frequency = ['monthly', 'yearly'].includes(c.frequency) ? c.frequency : 'monthly';
  const monthlyPercent = num(c.monthlyPercent ?? 8.33, 'Bonus percentage', 8.33, 20);
  await upsertComponent('bonus', null, { enabled: input.enabled, config: { frequency, monthlyPercent } }, BONUS_DEFAULT, userId);
  return getAllStatutory();
}

export async function savePtState(state: string, input: any, userId?: number) {
  if (!STATUTORY_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const c = input.config || {};
  await upsertComponent('pt', state, { enabled: input.enabled, config: { applicable: c.applicable !== false } }, { applicable: true }, userId);
  return getAllStatutory();
}

export async function saveLwf(state: string, input: any, userId?: number) {
  if (!STATUTORY_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const c = input.config;
  const cfg = c
    ? {
        employeePct: num(c.employeePct ?? LWF_DEFAULT.employeePct, 'Employee contribution %', 0, 100),
        employeeMaxAmount: num(c.employeeMaxAmount ?? LWF_DEFAULT.employeeMaxAmount, 'Max limit', 0, 1_000_000),
        employerMultiplier: num(c.employerMultiplier ?? LWF_DEFAULT.employerMultiplier, 'Employer multiplier', 1, 100),
        deductionCycle: c.deductionCycle || 'monthly',
      }
    : undefined; // omitted → keep existing config (powers the inline Enable/Disable link)
  await upsertComponent('lwf', state, { enabled: input.enabled, config: cfg }, LWF_DEFAULT, userId);
  return getAllStatutory();
}

export async function addMinimumWage(input: any, userId?: number) {
  const state = String(input.state || '');
  if (!STATUTORY_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const category = (String(input.category || 'general').trim()) || 'general';
  const wage = num(input.monthly_wage, 'Monthly minimum wage', 0.01, 1_000_000);

  const existing = await db(MW_TABLE).where({ state, category }).first();
  const patch = { monthly_wage: wage, effective_from: input.effective_from || null, updated_by: userId || null, updated_at: db.fn.now() };
  if (existing) await db(MW_TABLE).where('id', existing.id).update(patch);
  else await db(MW_TABLE).insert({ state, category, ...patch });
  return getAllStatutory();
}
