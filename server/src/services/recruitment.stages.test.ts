import { describe, it, expect } from 'vitest';
import {
  allowedNextStages, FUNNEL_ORDER, OFF_RAMPS, CANDIDATE_STAGES,
} from './recruitment.service';

// allowedNextStages is the single source of truth for how a candidate may move through
// the hiring pipeline — one step forward at a time, with the right off-ramp at each
// stage. These rules gate real progression (and the client mirrors them), so pin them.
describe('allowedNextStages', () => {
  it('offers exactly the right move + off-ramp at each funnel stage', () => {
    expect(allowedNextStages('applied')).toEqual(['interview', 'rejected']);
    expect(allowedNextStages('interview')).toEqual(['selected', 'rejected']);
    expect(allowedNextStages('selected')).toEqual(['document_collection', 'rejected']);
    expect(allowedNextStages('document_collection')).toEqual(['offer_released', 'rejected']);
    // Once the offer is out, the off-ramp becomes "declined", not "rejected".
    expect(allowedNextStages('offer_released')).toEqual(['offer_accepted', 'offer_declined']);
    // After acceptance there is no off-ramp until a checklist phase (no-show).
    expect(allowedNextStages('offer_accepted')).toEqual(['pre_joining']);
    expect(allowedNextStages('pre_joining')).toEqual(['joining', 'no_show']);
    expect(allowedNextStages('joining')).toEqual(['transferred', 'no_show']);
  });

  it('returns nothing from terminal stages (transferred + every off-ramp)', () => {
    for (const stage of ['transferred', ...OFF_RAMPS]) {
      expect(allowedNextStages(stage)).toEqual([]);
    }
  });

  it('returns nothing for an unknown / invalid stage', () => {
    expect(allowedNextStages('nope')).toEqual([]);
    expect(allowedNextStages('')).toEqual([]);
  });

  it('rejected is only available BEFORE an offer exists', () => {
    const preOffer = FUNNEL_ORDER.slice(0, FUNNEL_ORDER.indexOf('offer_released'));
    for (const s of preOffer) expect(allowedNextStages(s)).toContain('rejected');
    for (const s of FUNNEL_ORDER.slice(FUNNEL_ORDER.indexOf('offer_released'))) {
      expect(allowedNextStages(s)).not.toContain('rejected');
    }
  });

  it('invariant: the forward move is always the very next funnel step and never backwards', () => {
    FUNNEL_ORDER.forEach((from, i) => {
      const next = allowedNextStages(from);
      const forward = next.filter((s) => (FUNNEL_ORDER as readonly string[]).includes(s));
      if (i + 1 < FUNNEL_ORDER.length && from !== 'transferred') {
        expect(forward).toEqual([FUNNEL_ORDER[i + 1]]);           // exactly one step forward
      }
      // Nothing it offers points at an earlier funnel stage.
      for (const s of forward) expect(FUNNEL_ORDER.indexOf(s as any)).toBeGreaterThan(i);
    });
  });

  it('invariant: every stage it offers is a real candidate stage', () => {
    for (const from of CANDIDATE_STAGES) {
      for (const to of allowedNextStages(from)) {
        expect(CANDIDATE_STAGES).toContain(to);
      }
    }
  });
});
