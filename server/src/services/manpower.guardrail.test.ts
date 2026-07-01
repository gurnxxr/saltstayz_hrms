import { describe, it, expect } from 'vitest';
import { suggestedSalary, evaluateGuardrail, type Availability } from './manpower.service';

// Build a minimal Availability for guardrail tests.
function avail(p: Partial<Availability>): Availability {
  return {
    configured: true, property_configured: true, band_configured: true, is_locked: false,
    property_id: 1, property_name: 'Test', job_title_id: 1, job_title: 'Waiter',
    sanctioned_headcount: 3, sanctioned_budget_monthly: 60000, band_min: 15000, band_max: 25000,
    committed_amount: 0, non_left_headcount: 0, remaining_budget: 60000, remaining_slots: 3,
    suggested_ctc: 0, utilization_pct: 0, ...p,
  };
}

describe('suggestedSalary', () => {
  it('caps at band_max when budget is ample', () => {
    expect(suggestedSalary(60000, 3, 15000, 25000)).toBe(25000); // min(25000, 60000-30000)
  });
  it('uses remaining budget when it binds (last slot)', () => {
    expect(suggestedSalary(20000, 1, 15000, 25000)).toBe(20000); // min(25000, 20000-0)
  });
  it('reserves band_min for the other open slots', () => {
    expect(suggestedSalary(40000, 2, 15000, 25000)).toBe(25000); // min(25000, 40000-15000)
  });
  it('never goes below band_min (clamped up)', () => {
    expect(suggestedSalary(12000, 1, 15000, 25000)).toBe(15000); // min(25000,12000)=12000 -> clamp to 15000
  });
  it('is 0 when no slots remain', () => {
    expect(suggestedSalary(60000, 0, 15000, 25000)).toBe(0);
  });
});

describe('evaluateGuardrail', () => {
  it('allows a CTC within band, budget and suggestion', () => {
    expect(evaluateGuardrail(avail({ remaining_slots: 3, remaining_budget: 60000, suggested_ctc: 25000 }), 20000)).toBeNull();
  });
  it('blocks when no open slots (over_headcount)', () => {
    const b = evaluateGuardrail(avail({ remaining_slots: 0, non_left_headcount: 3, suggested_ctc: 0 }), 20000);
    expect(b?.exception_type).toBe('over_headcount');
  });
  it('blocks below band minimum (over_band)', () => {
    const b = evaluateGuardrail(avail({ suggested_ctc: 25000 }), 14000);
    expect(b?.exception_type).toBe('over_band');
    expect(b?.variance_amount).toBe(1000);
  });
  it('blocks above band maximum (over_band)', () => {
    const b = evaluateGuardrail(avail({ suggested_ctc: 25000 }), 26000);
    expect(b?.exception_type).toBe('over_band');
    expect(b?.variance_amount).toBe(1000);
  });
  it('blocks over remaining budget (over_budget)', () => {
    const b = evaluateGuardrail(avail({ remaining_slots: 1, remaining_budget: 20000, suggested_ctc: 20000 }), 22000);
    expect(b?.exception_type).toBe('over_budget');
    expect(b?.variance_amount).toBe(2000);
  });
  it('blocks when it would strand the other slots (over suggested)', () => {
    // slots 2, remaining 30000, band 15000-25000 -> suggested = min(25000, 30000-15000) = 15000
    const a = avail({ remaining_slots: 2, remaining_budget: 30000, suggested_ctc: 15000 });
    const b = evaluateGuardrail(a, 18000);
    expect(b?.exception_type).toBe('over_budget');
    expect(b?.variance_amount).toBe(3000);
  });
});
