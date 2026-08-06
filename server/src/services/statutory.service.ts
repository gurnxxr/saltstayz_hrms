import db from '../config/database';
import { ValidationError } from '../utils/errors';
import type { StatutoryRates } from './payslip.calc';

// ─────────────────────────────────────────────────────────────────────────────
// Statutory Components settings. `statutory_settings` holds one row per
// (component, state): EPF/ESI/Bonus are org-wide (state NULL); PT/LWF are per
// state. Config is a JSON blob parsed/merged over per-component defaults.
//
// Work-Location State model (Payroll v2 Phase 1): the statutory state comes
// from the employee's property (properties.state, mandatory), and the operating
// state list is DERIVED from data — properties + configured statutory rows —
// never a hardcoded list. INDIAN_STATES is a geographic enumeration used only
// to validate input.
// ─────────────────────────────────────────────────────────────────────────────

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const TABLE = 'statutory_settings';
const MW_TABLE = 'state_minimum_wages';

// The EPF and ESI registration numbers used to live here and on the settings form. They were
// captured and format-checked, and then read by nothing — no payslip, no PDF, no export, no
// return. A required field that feeds nothing is just a way to fail to switch EPF on, so it is
// gone. Rows saved before this keep the key inside their config JSON, harmlessly: upsertComponent
// merges over the stored blob, so it survives, and nothing looks at it.
const EPF_DEFAULT = {
  deductionCycle: 'monthly',
  employeeRatePct: 12, employerRatePct: 12,
  pfWageCeiling: 15000, // PF wage cap (statutory)
  includeEmployerInCtc: true, lopMode: 'prorate_restricted',
};
const ESI_DEFAULT = {
  deductionCycle: 'monthly',
  employeeRatePct: 0.75, employerRatePct: 3.25, wageCeiling: 21000,
  includeEmployerInCtc: false,
};
const BONUS_DEFAULT = { frequency: 'monthly', monthlyPercent: 8.33 };
const LWF_DEFAULT = {
  mode: 'percent', // 'percent' (pct of fixed gross, capped) | 'fixed' (flat state amounts)
  employeePct: 0.20, employeeMaxAmount: 35.00, employerMultiplier: 2,
  employeeAmount: 0, employerAmount: 0,
  deductionMonths: [] as number[], // empty = every month; e.g. Delhi = [6, 12]
};
const PT_DEFAULT = { slabs: [] as Array<{ min: number; max: number | null; amount: number; monthAmounts?: Record<string, number> }> };

/**
 * Operating states, derived from data (never hardcoded): every state that has a
 * property, plus states that already carry statutory/minimum-wage rows.
 */
export async function getOperatingStates(): Promise<string[]> {
  const [props, statRows, mwRows] = await Promise.all([
    db('properties').whereNotNull('state').distinct('state'),
    db(TABLE).whereNotNull('state').distinct('state'),
    db(MW_TABLE).distinct('state'),
  ]);
  const set = new Set<string>();
  for (const r of [...props, ...statRows, ...mwRows]) {
    const s = String((r as any).state || '').trim();
    if (s) set.add(s);
  }
  return [...set].sort();
}

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

// ─── Rates resolution for the payslip engine ───

// Legacy salary_setup/structure rows store a "city"; statutory config is per state.
const CITY_TO_STATE: Record<string, string> = {
  Gurugram: 'Haryana', Faridabad: 'Haryana', Haryana: 'Haryana',
  Delhi: 'Delhi', 'New Delhi': 'Delhi',
  Noida: 'Uttar Pradesh', 'Greater Noida': 'Uttar Pradesh', 'Uttar Pradesh': 'Uttar Pradesh',
  Chandigarh: 'Chandigarh',
  Dehradun: 'Uttarakhand', Uttarakhand: 'Uttarakhand',
};

export const DEFAULT_STATUTORY_STATE = 'Haryana'; // data-quality fallback only (head office)

export function resolveStatutoryState(cityOrState?: string | null): string {
  if (!cityOrState) return DEFAULT_STATUTORY_STATE;
  const trimmed = String(cityOrState).trim();
  if (INDIAN_STATES.includes(trimmed)) return trimmed;
  return CITY_TO_STATE[trimmed] || DEFAULT_STATUTORY_STATE;
}

/**
 * The employee's statutory state: employee → property (branch_name) → state.
 *
 * `resolved` is the point. This returned a bare string, so no caller could tell a state read
 * from the person's actual work location apart from the head-office fallback — and the fallback
 * fires whenever `branch_name` matches no property, which is silent, permanent, and decides their
 * Professional Tax, Labour Welfare Fund and minimum-wage floor. A guess that cannot be
 * distinguished from a fact is how ~90 people came to be paid another state's rates unnoticed.
 */
export interface ResolvedState {
  state: string;
  resolved: 'property' | 'fallback';
}

export async function resolveEmployeeState(employeeId: number): Promise<ResolvedState> {
  const row = await db('employees as e')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .where('e.id', employeeId)
    .select('p.state')
    .first();
  const state = row?.state ?? null;
  return state
    ? { state: resolveStatutoryState(state), resolved: 'property' }
    : { state: DEFAULT_STATUTORY_STATE, resolved: 'fallback' };
}

/** The state alone, for callers that only need the rate lookup. */
export async function getEmployeeState(employeeId: number): Promise<string> {
  return (await resolveEmployeeState(employeeId)).state;
}

/**
 * Resolves the effective statutory rates for a state — the single source the
 * payslip engine uses. Rates come from the editable statutory_settings rows
 * (EPF/ESI org-wide, LWF/PT per state); a disabled component contributes zero.
 */
export async function getStatutoryRates(cityOrState?: string | null): Promise<StatutoryRates> {
  const state = resolveStatutoryState(cityOrState);
  const rows = await db(TABLE)
    .whereIn('component', ['epf', 'esi', 'lwf', 'pt'])
    .where(function (this: any) {
      this.whereNull('state').orWhere('state', state);
    })
    .select('*');

  const epfRow = rows.find((r: any) => r.component === 'epf' && r.state == null);
  const esiRow = rows.find((r: any) => r.component === 'esi' && r.state == null);
  const lwfRow = rows.find((r: any) => r.component === 'lwf' && r.state === state);
  const ptRow = rows.find((r: any) => r.component === 'pt' && r.state === state);

  const epfCfg = parseConfig(epfRow, EPF_DEFAULT);
  const esiCfg = parseConfig(esiRow, ESI_DEFAULT);
  const lwfCfg = parseConfig(lwfRow, LWF_DEFAULT);
  const ptCfg = parseConfig(ptRow, PT_DEFAULT);

  return {
    epf: {
      enabled: !!(epfRow && epfRow.enabled),
      employeeRatePct: Number(epfCfg.employeeRatePct) || 0,
      employerRatePct: Number(epfCfg.employerRatePct) || 0,
      wageCeiling: epfCfg.pfWageCeiling == null ? 15000 : Number(epfCfg.pfWageCeiling) || 0,
      lopMode: epfCfg.lopMode === 'consider_all_below_15000' ? 'consider_all_below_15000' : 'prorate_restricted',
      includeInCtc: epfCfg.includeEmployerInCtc !== false,
    },
    esi: {
      enabled: !!(esiRow && esiRow.enabled),
      employeeRatePct: Number(esiCfg.employeeRatePct) || 0,
      employerRatePct: Number(esiCfg.employerRatePct) || 0,
      wageCeiling: Number(esiCfg.wageCeiling) || 0,
      includeInCtc: esiCfg.includeEmployerInCtc !== false,
    },
    lwf: {
      enabled: !!(lwfRow && lwfRow.enabled),
      mode: lwfCfg.mode === 'fixed' ? 'fixed' : 'percent',
      employeePct: Number(lwfCfg.employeePct) || 0,
      employeeMaxAmount: Number(lwfCfg.employeeMaxAmount) || 0,
      employerMultiplier: Number(lwfCfg.employerMultiplier) || 1,
      employeeAmount: Number(lwfCfg.employeeAmount) || 0,
      employerAmount: Number(lwfCfg.employerAmount) || 0,
      deductionMonths: Array.isArray(lwfCfg.deductionMonths)
        ? lwfCfg.deductionMonths.map((m: any) => Number(m)).filter((m: number) => m >= 1 && m <= 12)
        : [],
    },
    pt: {
      enabled: !!(ptRow && ptRow.enabled),
      slabs: Array.isArray(ptCfg.slabs)
        ? ptCfg.slabs.map((s: any) => ({
            min: Number(s.min) || 0,
            max: s.max == null || s.max === '' ? null : Number(s.max),
            amount: Number(s.amount) || 0,
            ...(s.monthAmounts && typeof s.monthAmounts === 'object' ? { monthAmounts: s.monthAmounts } : {}),
          }))
        : [],
    },
  };
}

/** Lowest configured, currently-effective minimum wage for a state (null when none). */
export async function getMinimumWageFor(state: string): Promise<number | null> {
  // Only wages effective on or before today apply — a future-dated wage must NOT take
  // effect until its date (effective-dating was previously ignored entirely, so a
  // future entry began flagging slips immediately).
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db(MW_TABLE)
    .where('state', state)
    .andWhere((q: any) => q.whereNull('effective_from').orWhere('effective_from', '<=', today))
    .select('monthly_wage');
  // Honour the documented "lowest configured minimum wage" contract — do NOT special-case
  // the 'general' category (which could be higher than a skilled/unskilled row). Ignore
  // zero/non-numeric rows so a state with only bad data returns null, never Infinity.
  const valid = rows.map((r: any) => Number(r.monthly_wage)).filter((w) => Number.isFinite(w) && w > 0);
  return valid.length ? Math.min(...valid) : null;
}

const inrAmount = (n: number) => Math.round(Number(n) || 0).toLocaleString('en-IN');

/**
 * Statutory floor: a monthly Total CTC may not be below the minimum wage of the
 * employee's state (employee → property → state). No-op when the state has no
 * minimum wage configured. `stateOrCity` is normalised first (property values are
 * already states; legacy city values are mapped). Throws ValidationError (→ 400).
 */
export async function assertCtcMeetsMinimumWage(stateOrCity: string | null | undefined, monthlyCtc: number) {
  const state = resolveStatutoryState(stateOrCity ?? null);
  const minWage = await getMinimumWageFor(state);
  if (minWage != null && Number.isFinite(monthlyCtc) && monthlyCtc < minWage) {
    throw new ValidationError(
      `Offered monthly CTC ₹${inrAmount(monthlyCtc)} is below the minimum wage of ₹${inrAmount(minWage)} per month for ${state}. ` +
      'Raise the salary, or update the state minimum wage in Statutory Components → Minimum Wage.',
    );
  }
}

/** Statutory bonus setting for the payslip engine (Payment of Bonus Act line). */
export async function getStatutoryBonus(): Promise<{ enabled: boolean; frequency: string; monthlyPercent: number }> {
  const row = await db(TABLE).where('component', 'bonus').whereNull('state').first();
  const cfg = parseConfig(row, BONUS_DEFAULT);
  return {
    enabled: !!(row && row.enabled),
    frequency: cfg.frequency === 'yearly' ? 'yearly' : 'monthly',
    monthlyPercent: Number(cfg.monthlyPercent) || 0,
  };
}

export async function getAllStatutory() {
  const states = await getOperatingStates();
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
    pt: states.map((s) => {
      const r = perState('pt', s);
      return { state: s, enabled: !!(r && r.enabled), config: parseConfig(r, PT_DEFAULT) };
    }),
    lwf: states.map((s) => {
      const r = perState('lwf', s);
      return { state: s, enabled: !!(r && r.enabled), config: parseConfig(r, LWF_DEFAULT) };
    }),
  };

  const minimumWages = await db(MW_TABLE).select('*').orderBy('state');
  return { states, settings, minimumWages };
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
  const c = input.config;
  // Omitted config → keep what is stored, the same contract savePtState and saveLwf already
  // honour. It matters for the Disable button: rebuilding cfg from the defaults on a bare
  // { enabled: false } would quietly reset a tuned rate or LOP mode, and switching back on
  // would return the wrong numbers rather than the ones that were there.
  const cfg = c ? {
    deductionCycle: 'monthly',
    employeeRatePct: num(c.employeeRatePct ?? 12, 'Employee contribution rate', 0.01, 100),
    employerRatePct: num(c.employerRatePct ?? 12, 'Employer contribution rate', 0.01, 100),
    pfWageCeiling: 15000,
    includeEmployerInCtc: c.includeEmployerInCtc !== false,
    lopMode: ['prorate_restricted', 'consider_all_below_15000'].includes(c.lopMode) ? c.lopMode : 'prorate_restricted',
  } : undefined;
  // No completeness guard on the enable path, unlike PT and LWF below. Those two can be switched
  // on into a state that then deducts nothing; EPF cannot — both rates have a 0.01 floor, so an
  // enabled EPF always computes something.
  await upsertComponent('epf', null, { enabled: input.enabled, config: cfg }, EPF_DEFAULT, userId);
  return getAllStatutory();
}

export async function saveEsi(input: any, userId?: number) {
  const c = input.config; // omitted → keep stored, as in saveEpf above
  const cfg = c ? {
    deductionCycle: 'monthly',
    employeeRatePct: num(c.employeeRatePct ?? 0.75, "Employees' contribution", 0, 100),
    employerRatePct: num(c.employerRatePct ?? 3.25, "Employer's contribution", 0, 100),
    wageCeiling: 21000,
    includeEmployerInCtc: !!c.includeEmployerInCtc,
  } : undefined;
  // Unlike EPF, both rates here floor at 0 and the form takes free numbers, so ESI CAN be
  // enabled at 0% / 0% and deduct nothing — the case PT and LWF each guard against below. That
  // gap predates this and the removed number format check never covered it; left as found.
  await upsertComponent('esi', null, { enabled: input.enabled, config: cfg }, ESI_DEFAULT, userId);
  return getAllStatutory();
}

export async function saveBonus(input: any, userId?: number) {
  const c = input.config; // omitted → keep stored, as in saveEpf above
  // Only monthly statutory bonus is computed; yearly (off-cycle) is not offered.
  const cfg = c
    ? { frequency: 'monthly', monthlyPercent: num(c.monthlyPercent ?? 8.33, 'Bonus percentage', 8.33, 20) }
    : undefined;
  await upsertComponent('bonus', null, { enabled: input.enabled, config: cfg }, BONUS_DEFAULT, userId);
  return getAllStatutory();
}

/** Validates and normalizes a PT slab list: sorted, non-overlapping, sane amounts. */
function validatePtSlabs(raw: any): Array<{ min: number; max: number | null; amount: number; monthAmounts?: Record<string, number> }> {
  if (!Array.isArray(raw)) return [];
  const slabs = raw.map((s: any, i: number) => {
    const min = num(s.min ?? 0, `Slab ${i + 1} lower bound`, 0, 10_000_000);
    const max = s.max == null || s.max === '' ? null : num(s.max, `Slab ${i + 1} upper bound`, 0, 10_000_000);
    if (max !== null && max < min) throw new ValidationError(`Slab ${i + 1}: upper bound must be ≥ lower bound.`);
    const amount = num(s.amount ?? 0, `Slab ${i + 1} amount`, 0, 100_000);
    let monthAmounts: Record<string, number> | undefined;
    if (s.monthAmounts && typeof s.monthAmounts === 'object') {
      monthAmounts = {};
      for (const [k, v] of Object.entries(s.monthAmounts)) {
        const m = Number(k);
        if (!Number.isInteger(m) || m < 1 || m > 12) throw new ValidationError(`Slab ${i + 1}: month override "${k}" must be 1–12.`);
        monthAmounts[String(m)] = num(v, `Slab ${i + 1} month ${m} amount`, 0, 100_000);
      }
      if (Object.keys(monthAmounts).length === 0) monthAmounts = undefined;
    }
    return { min, max, amount, ...(monthAmounts ? { monthAmounts } : {}) };
  });
  slabs.sort((a, b) => a.min - b.min);
  for (let i = 1; i < slabs.length; i++) {
    const prev = slabs[i - 1];
    if (prev.max === null || slabs[i].min <= prev.max) {
      throw new ValidationError('PT slabs must not overlap (and only the last slab may be open-ended).');
    }
  }
  return slabs;
}

export async function savePtState(state: string, input: any, userId?: number) {
  if (!INDIAN_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const c = input.config;
  const cfg = c ? { slabs: validatePtSlabs(c.slabs) } : undefined; // omitted → keep existing (inline enable/disable)
  if (input.enabled) {
    // Validate the effective config: the incoming slabs, or (inline enable) the
    // stored ones — so PT can't be enabled with no slabs and silently deduct zero.
    const stored = cfg ? null : parseConfig(await db(TABLE).where({ component: 'pt', state }).first(), PT_DEFAULT);
    const slabs = cfg?.slabs ?? stored?.slabs ?? [];
    if (!slabs.length) {
      throw new ValidationError('Add at least one PT slab before enabling Professional Tax for this state.');
    }
  }
  await upsertComponent('pt', state, { enabled: input.enabled, config: cfg }, PT_DEFAULT, userId);
  return getAllStatutory();
}

export async function saveLwf(state: string, input: any, userId?: number) {
  if (!INDIAN_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const c = input.config;
  let cfg: any;
  if (c) {
    const mode = c.mode === 'fixed' ? 'fixed' : 'percent';
    const deductionMonths = Array.isArray(c.deductionMonths)
      ? [...new Set(c.deductionMonths.map((m: any) => Number(m)))].filter((m: any) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a: any, b: any) => a - b)
      : [];
    cfg = {
      mode,
      employeePct: num(c.employeePct ?? LWF_DEFAULT.employeePct, 'Employee contribution %', 0, 100),
      employeeMaxAmount: num(c.employeeMaxAmount ?? LWF_DEFAULT.employeeMaxAmount, 'Max limit', 0, 1_000_000),
      employerMultiplier: num(c.employerMultiplier ?? LWF_DEFAULT.employerMultiplier, 'Employer multiplier', 1, 100),
      employeeAmount: num(c.employeeAmount ?? 0, 'Employee amount', 0, 1_000_000),
      employerAmount: num(c.employerAmount ?? 0, 'Employer amount', 0, 1_000_000),
      deductionMonths,
    };
  }
  if (input.enabled) {
    // Validate the effective config (incoming, or stored for inline enable) so a
    // fixed-mode state can't be enabled with zero amounts and deduct nothing.
    const eff = cfg ?? parseConfig(await db(TABLE).where({ component: 'lwf', state }).first(), LWF_DEFAULT);
    const effMode = eff.mode === 'fixed' ? 'fixed' : 'percent';
    if (effMode === 'fixed' && Number(eff.employeeAmount) <= 0 && Number(eff.employerAmount) <= 0) {
      throw new ValidationError('Fixed-amount LWF needs an employee or employer amount.');
    }
  }
  await upsertComponent('lwf', state, { enabled: input.enabled, config: cfg }, LWF_DEFAULT, userId);
  return getAllStatutory();
}

export async function addMinimumWage(input: any, userId?: number) {
  const state = String(input.state || '');
  if (!INDIAN_STATES.includes(state)) throw new ValidationError('Unknown state.');
  const category = (String(input.category || 'general').trim()) || 'general';
  const wage = num(input.monthly_wage, 'Monthly minimum wage', 0.01, 1_000_000);

  const existing = await db(MW_TABLE).where({ state, category }).first();
  const patch = { monthly_wage: wage, effective_from: input.effective_from || null, updated_by: userId || null, updated_at: db.fn.now() };
  if (existing) await db(MW_TABLE).where('id', existing.id).update(patch);
  else await db(MW_TABLE).insert({ state, category, ...patch });
  return getAllStatutory();
}
