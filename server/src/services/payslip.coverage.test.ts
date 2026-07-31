import { describe, it, expect } from 'vitest';
import { computeCoverage } from './payslip.service';

/**
 * The attendance-coverage gate — the one control standing between a payroll run and
 * paying a month on evidence nobody produced.
 *
 * It measures the share of markable working-day cells that were paid with nothing showing
 * the person worked, and `lockRun` refuses (409) above the configured threshold.
 *
 * It had two holes, and only fixing both closes it:
 *
 *  1. The DENOMINATOR was a hand-maintained list of count keys that never gained `no_punch`
 *     or `hhd` after those codes entered the vocabulary, so days carrying them counted on
 *     neither side and the reported percentage was simply wrong.
 *  2. The NUMERATOR counted only `unmarked`. Since migration 026 a No Punch day pays a FULL
 *     day, so a dead fingerprint reader that yields NP for every day has zero unmarked cells
 *     and reads as perfect — which is the exact failure the gate exists to catch. Fixing the
 *     denominator alone leaves that at 0% and still silent.
 *
 * Why counting `no_punch` as unevidenced does not fire on an ordinary month: every no_punch
 * in these counts is on a SCHEDULED WORKING DAY. The engine's weekly-off and holiday branches
 * both exit before the attendance tag is read, so a rest day tagged NP — which the owner's
 * spec does deliberately, for 9 to 22 days a month — never reaches this tally.
 */
const slip = (branch: string, counts: Record<string, number>) => ({ branch, days: { counts } });

describe('attendance-coverage gate', () => {
  it('a month of nothing but No Punch trips the gate', () => {
    // The dead fingerprint reader, on scheduled working days. Before the fix this was 0/0,
    // reported 0% and locked without a prompt — a whole month paid on no evidence at all.
    const res = computeCoverage([slip('Gurgaon', { no_punch: 22 })], 10);
    expect(res.working_days).toBe(22);
    expect(res.no_punch_days).toBe(22);
    expect(res.unmarked_days).toBe(0);       // nothing is "unmarked" — every day carries NP
    expect(res.unevidenced_pct).toBe(100);
    expect(res.over_gate).toBe(true);        // the point of the whole exercise
  });

  it('a month with no records at all still trips the gate', () => {
    const res = computeCoverage([slip('Gurgaon', { unmarked: 22 })], 10);
    expect(res.unevidenced_pct).toBe(100);
    expect(res.over_gate).toBe(true);
  });

  it('No Punch and HHD days count toward the denominator', () => {
    // With no_punch and hhd missing from the denominator this month read as 5 of 10 = 50%.
    // The same facts are really 17 of 25 = 68%. A different number, from identical data.
    const res = computeCoverage([slip('Gurgaon', {
      present: 5, no_punch: 12, hhd: 3, unmarked: 5,
    })], 10);
    expect(res.working_days).toBe(25);
    expect(res.unevidenced_days).toBe(17);   // 12 No Punch + 5 unmarked
    expect(res.unevidenced_pct).toBe(68);
    expect(res.unmarked_pct).toBe(20);       // reported separately, so the two are separable
    expect(res.over_gate).toBe(true);
  });

  it('a well-evidenced month passes', () => {
    // HHD is a real mark somebody made, so it is evidence — denominator only, never numerator.
    const res = computeCoverage([slip('Gurgaon', {
      present: 18, half_day: 2, hhd: 2, short_punch: 1, miss_punch: 1, paid_leave: 2, unmarked: 1,
    })], 10);
    expect(res.working_days).toBe(27);
    expect(res.unevidenced_days).toBe(1);
    expect(res.no_punch_days).toBe(0);
    expect(res.over_gate).toBe(false);
  });

  it('counts every code a register can carry, and only those', () => {
    // `future` and `not_employed` stay out: neither is a cell anybody could have marked.
    const res = computeCoverage([slip('Gurgaon', {
      present: 1, half_day: 1, hhd: 1, absent: 1, miss_punch: 1, short_punch: 1,
      no_punch: 0, paid_leave: 1, unpaid_leave: 1, unmarked: 1,
      future: 5, not_employed: 5,
    })], 10);
    expect(res.working_days).toBe(9);
    expect(res.unevidenced_days).toBe(1);
  });

  it('exactly at the gate is not over it', () => {
    const res = computeCoverage([slip('Gurgaon', { present: 9, unmarked: 1 })], 10);
    expect(res.unevidenced_pct).toBe(10);
    expect(res.over_gate).toBe(false);
  });

  it('reports the worst property first, so a dead reader is not buried behind good ones', () => {
    const res = computeCoverage([
      slip('Gurgaon', { present: 30, unmarked: 1 }),
      slip('Rishikesh', { present: 4, no_punch: 20 }),
    ], 10);
    expect(res.by_property[0].branch).toBe('Rishikesh');
    expect(res.by_property[0].no_punch_days).toBe(20);
    expect(res.by_property[0].unevidenced_pct).toBeGreaterThan(res.by_property[1].unevidenced_pct);
  });

  it('an employee the run skipped contributes to neither side', () => {
    const res = computeCoverage([
      slip('Gurgaon', { unmarked: 10 }),
      { branch: 'Gurgaon', days: null },
    ], 10);
    expect(res.working_days).toBe(10);
    expect(res.unevidenced_pct).toBe(100);
  });
});
