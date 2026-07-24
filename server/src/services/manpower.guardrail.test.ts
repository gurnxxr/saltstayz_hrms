import { describe, it, expect } from 'vitest';
import { suggestedSalary, evaluateGuardrail, type Availability } from './manpower.service';

// Build a minimal Availability for guardrail tests.
function avail(p: Partial<Availability>): Availability {
  return {
    configured: true, property_configured: true, band_configured: true, is_locked: false,
    property_id: 1, property_name: 'Test', job_title_id: 1, job_title: 'Waiter',
    sanctioned_headcount: 3, sanctioned_budget_monthly: 60000, band_min: 0, band_max: 25000,
    committed_amount: 0, non_left_headcount: 0, remaining_budget: 60000, remaining_slots: 3,
    suggested_ctc: 0, utilization_pct: 0, ...p,
  };
}

describe('suggestedSalary', () => {
  it('caps at the role max when the budget is ample', () => {
    expect(suggestedSalary(60000, 25000)).toBe(25000);
  });
  it('uses the remaining budget when that binds', () => {
    expect(suggestedSalary(20000, 25000)).toBe(20000);
  });
  it('is 0 when there is no budget left', () => {
    expect(suggestedSalary(0, 25000)).toBe(0);
    expect(suggestedSalary(-5000, 25000)).toBe(0);
  });
});

describe('evaluateGuardrail', () => {
  it('allows a CTC within the max and the budget', () => {
    expect(evaluateGuardrail(avail({ remaining_slots: 3, remaining_budget: 60000 }), 20000)).toBeNull();
  });
  it('allows a below-band CTC — there is no role minimum (statutory floor is enforced elsewhere)', () => {
    // Previously this was blocked as "below band minimum"; the model now enforces only a max.
    expect(evaluateGuardrail(avail({ band_max: 25000, remaining_budget: 60000 }), 8000)).toBeNull();
  });
  it('blocks when no open slots remain (over_headcount)', () => {
    const b = evaluateGuardrail(avail({ remaining_slots: 0, non_left_headcount: 3 }), 20000);
    expect(b?.exception_type).toBe('over_headcount');
  });
  it('does NOT block on headcount when skipHeadcount is set (money-only re-check at activation)', () => {
    // remaining_slots 0 but the body already holds its slot — only the money is re-validated.
    expect(evaluateGuardrail(avail({ remaining_slots: 0, remaining_budget: 60000 }), 20000, { skipHeadcount: true })).toBeNull();
  });
  it('blocks above the role maximum (over_band)', () => {
    const b = evaluateGuardrail(avail({ band_max: 25000 }), 26000);
    expect(b?.exception_type).toBe('over_band');
    expect(b?.variance_amount).toBe(1000);
  });
  it('blocks over the free (post-reservation) budget (over_budget)', () => {
    const b = evaluateGuardrail(avail({ remaining_slots: 1, remaining_budget: 20000 }), 22000);
    expect(b?.exception_type).toBe('over_budget');
    expect(b?.variance_amount).toBe(2000);
  });
});
