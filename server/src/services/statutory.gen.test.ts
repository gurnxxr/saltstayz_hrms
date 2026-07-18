import { describe, it, expect, afterAll } from 'vitest';
import db from '../config/database';
import { ValidationError } from '../utils/errors';
import {
  resolveStatutoryState,
  INDIAN_STATES,
  DEFAULT_STATUTORY_STATE,
  saveBonus,
  saveEpf,
  saveEsi,
  savePtState,
  saveLwf,
  addMinimumWage,
} from './statutory.service';

/**
 * Unit suite for the PURE surface of statutory.service.ts.
 *
 * Scope / safety:
 *  - resolveStatutoryState is the only exported side-effect-free function; it is
 *    exercised exhaustively (both success and default-fallback branches).
 *  - INDIAN_STATES / DEFAULT_STATUTORY_STATE constants are asserted.
 *  - The save and addMinimumWage functions are async and DB-backed, but every one of
 *    their input-validation guards (num() range checks, state-membership,
 *    validatePtSlabs, EPF/ESI number regex, LWF fixed-mode) throws SYNCHRONOUSLY
 *    *before* the first `await db(...)`. This file ONLY drives those pre-DB
 *    rejection paths — no assertion below ever lets a save call reach the DB, so
 *    the live hrms.db is never read for a mutation nor written. (Every case is an
 *    `expect(...).rejects` on input that is guaranteed out of range.)
 *
 * Focus areas: statutory-bonus ceilings (8.33–20%), EPF/ESI rate bounds + number
 * format, PT slab validation (order/overlap/open-ended/range), LWF fixed-mode +
 * multiplier bounds, minimum-wage range.
 */

// No save* call below reaches the pool; destroy defensively so vitest exits clean.
afterAll(async () => {
  try { await db.destroy(); } catch { /* pool never opened */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveStatutoryState — pure normaliser (city/state -> statutory state)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveStatutoryState — empty / nullish inputs -> default', () => {
  it('returns the head-office default for undefined', () => {
    expect(resolveStatutoryState()).toBe('Haryana');
    expect(resolveStatutoryState()).toBe(DEFAULT_STATUTORY_STATE);
  });

  it('returns the default for null and empty string', () => {
    expect(resolveStatutoryState(null)).toBe(DEFAULT_STATUTORY_STATE);
    expect(resolveStatutoryState('')).toBe(DEFAULT_STATUTORY_STATE);
  });

  it('returns the default for a whitespace-only string (truthy, but trims to empty)', () => {
    // '   ' is truthy so it does NOT hit the `!cityOrState` early return; it is
    // trimmed to '' which matches neither a state nor a city key -> default.
    expect(resolveStatutoryState('   ')).toBe(DEFAULT_STATUTORY_STATE);
  });
});

describe('resolveStatutoryState — exact state names pass through', () => {
  it('returns a recognised state unchanged', () => {
    expect(resolveStatutoryState('Maharashtra')).toBe('Maharashtra');
    expect(resolveStatutoryState('Karnataka')).toBe('Karnataka');
    expect(resolveStatutoryState('Uttar Pradesh')).toBe('Uttar Pradesh');
    expect(resolveStatutoryState('Uttarakhand')).toBe('Uttarakhand');
    expect(resolveStatutoryState('Haryana')).toBe('Haryana');
  });

  it('returns union territories that are listed as statutory states', () => {
    expect(resolveStatutoryState('Delhi')).toBe('Delhi');
    expect(resolveStatutoryState('Chandigarh')).toBe('Chandigarh');
    expect(resolveStatutoryState('Puducherry')).toBe('Puducherry');
  });

  it('trims surrounding whitespace before the state lookup', () => {
    expect(resolveStatutoryState('  Kerala  ')).toBe('Kerala');
    expect(resolveStatutoryState('\tTelangana\n')).toBe('Telangana');
  });
});

describe('resolveStatutoryState — legacy city values map to their state', () => {
  it('maps Haryana cities', () => {
    expect(resolveStatutoryState('Gurugram')).toBe('Haryana');
    expect(resolveStatutoryState('Faridabad')).toBe('Haryana');
  });

  it('maps UP cities', () => {
    expect(resolveStatutoryState('Noida')).toBe('Uttar Pradesh');
    expect(resolveStatutoryState('Greater Noida')).toBe('Uttar Pradesh');
  });

  it('maps New Delhi -> Delhi and Dehradun -> Uttarakhand', () => {
    expect(resolveStatutoryState('New Delhi')).toBe('Delhi');
    expect(resolveStatutoryState('Dehradun')).toBe('Uttarakhand');
  });

  it('trims whitespace before the city lookup too', () => {
    expect(resolveStatutoryState('  Noida  ')).toBe('Uttar Pradesh');
    expect(resolveStatutoryState('  New Delhi ')).toBe('Delhi');
  });
});

describe('resolveStatutoryState — unrecognised tokens fall back to default', () => {
  it('returns default for an unknown place', () => {
    expect(resolveStatutoryState('Atlantis')).toBe(DEFAULT_STATUTORY_STATE);
    expect(resolveStatutoryState('SomeUnmappedBranch')).toBe(DEFAULT_STATUTORY_STATE);
  });

  it('is case-sensitive: a wrong-case token is unrecognised -> default', () => {
    // The CITY_TO_STATE keys and INDIAN_STATES are proper-cased; lower-case tokens
    // are not recognised and therefore resolve to the default (documented limit).
    expect(resolveStatutoryState('gurugram')).toBe(DEFAULT_STATUTORY_STATE);
    expect(resolveStatutoryState('maharashtra')).toBe(DEFAULT_STATUTORY_STATE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported constants
// ─────────────────────────────────────────────────────────────────────────────

describe('INDIAN_STATES / DEFAULT_STATUTORY_STATE', () => {
  it('DEFAULT_STATUTORY_STATE is Haryana and is itself a listed state', () => {
    expect(DEFAULT_STATUTORY_STATE).toBe('Haryana');
    expect(INDIAN_STATES).toContain(DEFAULT_STATUTORY_STATE);
  });

  it('enumerates all 28 states + 8 UTs (36 entries), unique', () => {
    expect(INDIAN_STATES).toHaveLength(36);
    expect(new Set(INDIAN_STATES).size).toBe(36);
  });

  it('includes representative states and UTs', () => {
    expect(INDIAN_STATES).toContain('Maharashtra');
    expect(INDIAN_STATES).toContain('Tamil Nadu');
    expect(INDIAN_STATES).toContain('Delhi');
    expect(INDIAN_STATES).toContain('Ladakh');
    expect(INDIAN_STATES).toContain('Jammu and Kashmir');
  });

  it('does not contain city-only tokens', () => {
    expect(INDIAN_STATES).not.toContain('Gurugram');
    expect(INDIAN_STATES).not.toContain('Noida');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Statutory-bonus ceilings — num(monthlyPercent, 8.33, 20). All rejects (pre-DB).
// ─────────────────────────────────────────────────────────────────────────────

describe('saveBonus — statutory percentage ceiling guards (8.33%–20%)', () => {
  it('rejects just below the 8.33% floor', async () => {
    await expect(saveBonus({ enabled: false, config: { monthlyPercent: 8.32 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects zero (0 is not nullish, so the 8.33 default does not apply)', async () => {
    await expect(saveBonus({ enabled: false, config: { monthlyPercent: 0 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects just above the 20% ceiling', async () => {
    await expect(saveBonus({ enabled: false, config: { monthlyPercent: 20.01 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects a grossly high percentage', async () => {
    await expect(saveBonus({ enabled: false, config: { monthlyPercent: 100 } }))
      .rejects.toThrow(/Bonus percentage must be between 8.33 and 20/);
  });

  it('rejects a non-finite percentage', async () => {
    await expect(saveBonus({ enabled: false, config: { monthlyPercent: 'abc' } }))
      .rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EPF — rate bounds [0.01, 100] and EPF-number format. All rejects (pre-DB).
// ─────────────────────────────────────────────────────────────────────────────

describe('saveEpf — contribution-rate bounds and number format', () => {
  it('rejects an employee rate of 0 (below the 0.01 minimum)', async () => {
    await expect(saveEpf({ enabled: false, config: { employeeRatePct: 0 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects an employee rate above 100', async () => {
    await expect(saveEpf({ enabled: false, config: { employeeRatePct: 100.01 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects an out-of-range employer rate', async () => {
    await expect(saveEpf({ enabled: false, config: { employeeRatePct: 12, employerRatePct: 0 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects enabling with a malformed EPF number', async () => {
    await expect(saveEpf({
      enabled: true,
      config: { employeeRatePct: 12, employerRatePct: 12, epfNumber: 'NOT-A-NUMBER' },
    })).rejects.toThrow(/EPF Number must match/);
  });

  it('rejects enabling with an empty EPF number', async () => {
    await expect(saveEpf({
      enabled: true,
      config: { employeeRatePct: 12, employerRatePct: 12, epfNumber: '' },
    })).rejects.toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ESI — rate bounds [0, 100] and ESI-number format. All rejects (pre-DB).
// ─────────────────────────────────────────────────────────────────────────────

describe('saveEsi — contribution-rate bounds and number format', () => {
  it('rejects an employee rate above 100', async () => {
    await expect(saveEsi({ enabled: false, config: { employeeRatePct: 101 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects an employer rate above 100', async () => {
    await expect(saveEsi({ enabled: false, config: { employerRatePct: 200 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects a negative employee rate (below the 0 minimum)', async () => {
    await expect(saveEsi({ enabled: false, config: { employeeRatePct: -1 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects enabling with a malformed ESI number', async () => {
    await expect(saveEsi({
      enabled: true,
      config: { employeeRatePct: 0.75, employerRatePct: 3.25, esiNumber: 'BAD' },
    })).rejects.toThrow(/ESI Number must match/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PT slabs — validatePtSlabs via savePtState (state-membership + slab validation).
// All rejects (pre-DB): the state guard and validatePtSlabs both throw before any
// query; enabled:false keeps the inline-enable DB read path out of the picture.
// ─────────────────────────────────────────────────────────────────────────────

describe('savePtState — state guard', () => {
  it('rejects an unknown state', async () => {
    await expect(savePtState('Narnia', { enabled: false }))
      .rejects.toThrow(/Unknown state/);
  });
});

describe('savePtState — slab validation (validatePtSlabs)', () => {
  it('rejects overlapping slabs (next.min <= prev.max)', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [
        { min: 0, max: 100, amount: 200 },
        { min: 50, max: 200, amount: 300 },
      ] },
    })).rejects.toThrow(/must not overlap/);
  });

  it('rejects a boundary-touching pair (next.min === prev.max counts as overlap)', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [
        { min: 0, max: 100, amount: 200 },
        { min: 100, max: 200, amount: 300 },
      ] },
    })).rejects.toThrow(/must not overlap/);
  });

  it('rejects an open-ended (max=null) slab that is not the last', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [
        { min: 0, max: null, amount: 200 },
        { min: 100, max: 200, amount: 300 },
      ] },
    })).rejects.toThrow(/must not overlap/);
  });

  it('rejects a slab whose upper bound is below its lower bound', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [{ min: 100, max: 50, amount: 200 }] },
    })).rejects.toThrow(/upper bound must be/);
  });

  it('rejects a negative lower bound', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [{ min: -5, max: 100, amount: 200 }] },
    })).rejects.toThrow(ValidationError);
  });

  it('rejects an amount above the 100000 cap', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [{ min: 0, max: 100, amount: 200000 }] },
    })).rejects.toThrow(ValidationError);
  });

  it('rejects a month-override key outside 1–12', async () => {
    await expect(savePtState('Maharashtra', {
      enabled: false,
      config: { slabs: [{ min: 0, max: 100, amount: 200, monthAmounts: { 13: 250 } }] },
    })).rejects.toThrow(/month override/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LWF — state guard, num bounds, and fixed-mode zero-amount guard. Rejects (pre-DB).
// ─────────────────────────────────────────────────────────────────────────────

describe('saveLwf — guards', () => {
  it('rejects an unknown state', async () => {
    await expect(saveLwf('Narnia', {})).rejects.toThrow(/Unknown state/);
  });

  it('rejects an employee percentage above 100', async () => {
    await expect(saveLwf('Maharashtra', { enabled: false, config: { employeePct: 150 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects an employer multiplier below the minimum of 1', async () => {
    await expect(saveLwf('Maharashtra', { enabled: false, config: { employerMultiplier: 0 } }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects enabling fixed-mode LWF with both amounts zero', async () => {
    await expect(saveLwf('Maharashtra', {
      enabled: true,
      config: { mode: 'fixed', employeeAmount: 0, employerAmount: 0 },
    })).rejects.toThrow(/Fixed-amount LWF needs/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Minimum wage — state guard + num bounds [0.01, 1_000_000]. Rejects (pre-DB).
// ─────────────────────────────────────────────────────────────────────────────

describe('addMinimumWage — guards', () => {
  it('rejects an unknown state', async () => {
    await expect(addMinimumWage({ state: 'Narnia', monthly_wage: 5000 }))
      .rejects.toThrow(/Unknown state/);
  });

  it('rejects a zero wage (below the 0.01 minimum)', async () => {
    await expect(addMinimumWage({ state: 'Maharashtra', monthly_wage: 0 }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects a wage above the 1,000,000 cap', async () => {
    await expect(addMinimumWage({ state: 'Maharashtra', monthly_wage: 2_000_000 }))
      .rejects.toThrow(ValidationError);
  });

  it('rejects a missing / non-finite wage', async () => {
    await expect(addMinimumWage({ state: 'Maharashtra' }))
      .rejects.toThrow(ValidationError);
  });
});
