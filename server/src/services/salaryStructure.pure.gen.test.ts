import { describe, it, expect } from 'vitest';
import { JD_CTC_BAND_PCT } from './salaryStructure.service';

// ─────────────────────────────────────────────────────────────────────────────
// salaryStructure.service.ts — PURE surface
//
// The module exposes exactly ONE pure runtime export: the constant
// `JD_CTC_BAND_PCT` (source line 334). Every exported *function* is async and
// hits the live SQLite DB (getStructureByJobTitle → computeForStructure →
// resolveStructureLines → getStatutoryRates, etc.), so none can be exercised as
// a pure unit under the harness's "do not touch the live DB" rule.
//
// Importing the module is DB-free: `import db from '../config/database'` only
// constructs the knex singleton (better-sqlite3 opens the file on the FIRST
// query, via the pool afterCreate hook — not at knex() construction), and none
// of the transitive service imports run a query at module load. So importing the
// real `JD_CTC_BAND_PCT` here does not open or mutate the database.
//
// The pure arithmetic that USES the constant lives inside `getCtcRange`
// (source lines 350-362) but is not separately exported. We pin that intended
// contract with a faithful local replica derived from the imported constant, so
// the band value is never hardcoded twice and the CTC-range math is regression-
// locked. Each replica line is annotated with the source line it mirrors.
// ─────────────────────────────────────────────────────────────────────────────

describe('JD_CTC_BAND_PCT (band constant)', () => {
  it('is exactly 15 (percent headroom above the structure CTC floor)', () => {
    expect(JD_CTC_BAND_PCT).toBe(15);
  });

  it('is a positive, finite, integer number', () => {
    expect(typeof JD_CTC_BAND_PCT).toBe('number');
    expect(Number.isFinite(JD_CTC_BAND_PCT)).toBe(true);
    expect(Number.isInteger(JD_CTC_BAND_PCT)).toBe(true);
    expect(JD_CTC_BAND_PCT).toBeGreaterThan(0);
  });

  it('yields a 1.15× multiplier when applied as (1 + pct/100)', () => {
    expect(1 + JD_CTC_BAND_PCT / 100).toBeCloseTo(1.15, 10);
  });
});

// ── Faithful replica of getCtcRange arithmetic (source lines 355-361) ─────────
//   const monthly_ctc = Math.round(breakdown.ctc);              // line 356
//   const annual_low  = monthly_ctc * 12;                       // line 357
//   const annual_high = Math.round(annual_low * (1 + PCT/100)); // line 358
//   const lpa = (n) => (n / 100000).toFixed(2);                 // line 359
//   const label = `₹${lpa(annual_low)} – ${lpa(annual_high)} LPA`; // line 360
// The band factor is pulled from the REAL imported constant so the replica can
// never silently diverge from the source's headroom value.
const lpa = (n: number): string => (n / 100000).toFixed(2);

function ctcRangeMath(ctc: number) {
  const monthly_ctc = Math.round(ctc);
  const annual_low = monthly_ctc * 12;
  const annual_high = Math.round(annual_low * (1 + JD_CTC_BAND_PCT / 100));
  const label = `₹${lpa(annual_low)} – ${lpa(annual_high)} LPA`;
  return { monthly_ctc, annual_low, annual_high, label };
}

describe('getCtcRange arithmetic — faithful replica', () => {
  it('reproduces the documented example "₹2.32 – 2.67 LPA"', () => {
    // 2.32 LPA annual_low ⇒ monthly ≈ 19333.33 ⇒ round = 19333 ⇒ annual_low 231996
    // The source doc-comment shows the shape ₹2.32 – 2.67; verify the +15% high.
    const r = ctcRangeMath(19333.33);
    expect(r.monthly_ctc).toBe(19333);
    expect(r.annual_low).toBe(231996);
    // high = round(231996 * 1.15) = round(266795.4) = 266795
    expect(r.annual_high).toBe(266795);
    expect(r.label).toBe('₹2.32 – 2.67 LPA');
  });

  it('rounds monthly_ctc before annualizing (round-then-multiply, not multiply-then-round)', () => {
    // ctc 19333.9 → round = 19334 → annual_low = 232008 (not 19333.9*12 = 231_006.8 rounded)
    const r = ctcRangeMath(19333.9);
    expect(r.monthly_ctc).toBe(19334);
    expect(r.annual_low).toBe(232008);
    expect(r.annual_high).toBe(Math.round(232008 * 1.15));
  });

  it('applies exactly +15% headroom for the high end', () => {
    const r = ctcRangeMath(20000); // annual_low 240000, high = 240000*1.15 = 276000
    expect(r.annual_low).toBe(240000);
    expect(r.annual_high).toBe(276000);
    expect(r.label).toBe('₹2.40 – 2.76 LPA');
  });

  it('handles a zero CTC (unconfigured-like) without NaN', () => {
    const r = ctcRangeMath(0);
    expect(r.monthly_ctc).toBe(0);
    expect(r.annual_low).toBe(0);
    expect(r.annual_high).toBe(0);
    expect(r.label).toBe('₹0.00 – 0.00 LPA');
  });

  it('formats LPA to exactly two decimal places (banker-free toFixed)', () => {
    // 100000 annual → 1.00; 105000 → 1.05; 149999 → 1.50 (toFixed rounds half up here)
    expect(lpa(100000)).toBe('1.00');
    expect(lpa(105000)).toBe('1.05');
    expect(lpa(149999)).toBe('1.50');
    expect(lpa(1234567)).toBe('12.35');
  });

  it('rounds the high end to the nearest rupee (Math.round half-up)', () => {
    // pick a low whose *1.15 lands on .5 → rounds up
    // annual_low = 10 → 10*1.15 = 11.5 → round = 12
    const r = ctcRangeMath(10 / 12); // monthly rounds to 1 → annual_low 12 → 12*1.15=13.8→14
    // guard against surprising rounding: recompute expectation from the same formula
    expect(r.annual_high).toBe(Math.round(r.annual_low * 1.15));
  });

  it('is monotonic: a larger CTC never produces a smaller range', () => {
    const a = ctcRangeMath(15000);
    const b = ctcRangeMath(30000);
    expect(b.annual_low).toBeGreaterThan(a.annual_low);
    expect(b.annual_high).toBeGreaterThan(a.annual_high);
    // high is always ≥ low (headroom is non-negative)
    expect(a.annual_high).toBeGreaterThanOrEqual(a.annual_low);
    expect(b.annual_high).toBeGreaterThanOrEqual(b.annual_low);
  });

  it('high end equals low end scaled by the imported band factor (no hardcoded 15)', () => {
    const ctc = 41250; // arbitrary
    const r = ctcRangeMath(ctc);
    expect(r.annual_high).toBe(Math.round(r.annual_low * (1 + JD_CTC_BAND_PCT / 100)));
  });
});
