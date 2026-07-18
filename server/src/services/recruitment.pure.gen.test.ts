import { describe, it, expect } from 'vitest';
import {
  VACANCY_STATUSES,
  LIVE_VACANCY_STATUSES,
  FUNNEL_ORDER,
  OFF_RAMPS,
  CANDIDATE_STAGES,
  STAGE_LABELS,
  STAGE_CHECKLIST,
  allowedNextStages,
} from './recruitment.service';

// ────────────────────────────────────────────────────────────────────────────
// Pure surface of recruitment.service.ts.
//
// The only exported *function* that is pure is `allowedNextStages` (covered
// thoroughly elsewhere; a compact confirmation is kept here so the map/label
// invariants below have a live consumer to check against). The remaining pure
// surface is the exported constant tables that the whole hiring funnel keys off:
// FUNNEL_ORDER, OFF_RAMPS, CANDIDATE_STAGES, STAGE_LABELS, STAGE_CHECKLIST and the
// two vacancy-status lists. These are data, but they encode contracts (ordering,
// completeness, no overlap) that the rest of the module — and the client mirror —
// depend on, so they are worth pinning.
//
// No db / network / fs is touched: every assertion here is against in-memory
// exports only.
// ────────────────────────────────────────────────────────────────────────────

describe('VACANCY_STATUSES / LIVE_VACANCY_STATUSES', () => {
  it('lists the three vacancy states in order', () => {
    expect(VACANCY_STATUSES).toEqual(['new_role', 'listed', 'closed']);
  });

  it('treats new_role and listed (and only those) as "live"', () => {
    expect(LIVE_VACANCY_STATUSES).toEqual(['new_role', 'listed']);
  });

  it('excludes closed from the live set', () => {
    expect(LIVE_VACANCY_STATUSES).not.toContain('closed');
  });

  it('every live status is itself a valid vacancy status', () => {
    for (const s of LIVE_VACANCY_STATUSES) {
      expect(VACANCY_STATUSES).toContain(s);
    }
  });

  it('the live set is exactly the non-closed vacancy statuses', () => {
    expect(LIVE_VACANCY_STATUSES).toEqual(
      VACANCY_STATUSES.filter((s) => s !== 'closed'),
    );
  });
});

describe('FUNNEL_ORDER', () => {
  it('is the nine funnel stages in the documented order (steps 3–11)', () => {
    expect(FUNNEL_ORDER).toEqual([
      'applied',
      'interview',
      'selected',
      'document_collection',
      'offer_released',
      'offer_accepted',
      'pre_joining',
      'joining',
      'transferred',
    ]);
  });

  it('has exactly nine stages', () => {
    expect(FUNNEL_ORDER).toHaveLength(9);
  });

  it('starts at applied (Shortlisting) and ends at transferred', () => {
    expect(FUNNEL_ORDER[0]).toBe('applied');
    expect(FUNNEL_ORDER[FUNNEL_ORDER.length - 1]).toBe('transferred');
  });

  it('contains no duplicate stages', () => {
    expect(new Set(FUNNEL_ORDER).size).toBe(FUNNEL_ORDER.length);
  });

  it('orders the offer lifecycle: released → accepted → pre_joining → joining → transferred', () => {
    const idx = (s: string) => FUNNEL_ORDER.indexOf(s as any);
    expect(idx('offer_released')).toBeLessThan(idx('offer_accepted'));
    expect(idx('offer_accepted')).toBeLessThan(idx('pre_joining'));
    expect(idx('pre_joining')).toBeLessThan(idx('joining'));
    expect(idx('joining')).toBeLessThan(idx('transferred'));
  });

  it('places document_collection before the offer is released', () => {
    const idx = (s: string) => FUNNEL_ORDER.indexOf(s as any);
    expect(idx('document_collection')).toBeLessThan(idx('offer_released'));
  });
});

describe('OFF_RAMPS', () => {
  it('is exactly the three off-ramp stages', () => {
    expect(OFF_RAMPS).toEqual(['rejected', 'offer_declined', 'no_show']);
  });

  it('has three off-ramps', () => {
    expect(OFF_RAMPS).toHaveLength(3);
  });

  it('shares no stage name with the forward funnel', () => {
    for (const off of OFF_RAMPS) {
      expect(FUNNEL_ORDER).not.toContain(off);
    }
  });
});

describe('CANDIDATE_STAGES', () => {
  it('is the funnel stages followed by the off-ramps', () => {
    expect(CANDIDATE_STAGES).toEqual([...FUNNEL_ORDER, ...OFF_RAMPS]);
  });

  it('has twelve stages total (9 funnel + 3 off-ramp)', () => {
    expect(CANDIDATE_STAGES).toHaveLength(12);
  });

  it('contains every funnel stage', () => {
    for (const s of FUNNEL_ORDER) expect(CANDIDATE_STAGES).toContain(s);
  });

  it('contains every off-ramp', () => {
    for (const s of OFF_RAMPS) expect(CANDIDATE_STAGES).toContain(s);
  });

  it('has no duplicate stage names', () => {
    expect(new Set(CANDIDATE_STAGES).size).toBe(CANDIDATE_STAGES.length);
  });
});

describe('STAGE_LABELS', () => {
  it('gives every candidate stage a human label', () => {
    for (const stage of CANDIDATE_STAGES) {
      expect(STAGE_LABELS[stage]).toBeTruthy();
      expect(typeof STAGE_LABELS[stage]).toBe('string');
    }
  });

  it('has a label for every funnel stage and every off-ramp — no gaps', () => {
    for (const stage of [...FUNNEL_ORDER, ...OFF_RAMPS]) {
      expect(Object.prototype.hasOwnProperty.call(STAGE_LABELS, stage)).toBe(true);
    }
  });

  it('defines labels for exactly the twelve candidate stages — no stray keys', () => {
    expect(Object.keys(STAGE_LABELS).sort()).toEqual([...CANDIDATE_STAGES].sort());
  });

  it('maps the funnel stages to their documented labels', () => {
    expect(STAGE_LABELS.applied).toBe('Shortlisting');
    expect(STAGE_LABELS.interview).toBe('Interview');
    expect(STAGE_LABELS.selected).toBe('Selection');
    expect(STAGE_LABELS.document_collection).toBe('Document Collection');
    expect(STAGE_LABELS.offer_released).toBe('Offer Release');
    expect(STAGE_LABELS.offer_accepted).toBe('Offer Acceptance');
    expect(STAGE_LABELS.pre_joining).toBe('Pre-joining Formalities');
    expect(STAGE_LABELS.joining).toBe('Joining Day');
    expect(STAGE_LABELS.transferred).toBe('Transfer to Manager');
  });

  it('maps the off-ramps to their documented labels', () => {
    expect(STAGE_LABELS.rejected).toBe('Rejected');
    expect(STAGE_LABELS.offer_declined).toBe('Offer Declined');
    expect(STAGE_LABELS.no_show).toBe('No Show');
  });

  it('does not carry a label for a vacancy-only status like new_role', () => {
    expect(STAGE_LABELS.new_role).toBeUndefined();
  });
});

describe('STAGE_CHECKLIST', () => {
  it('gates exactly the three checklist-bearing stages', () => {
    expect(Object.keys(STAGE_CHECKLIST).sort()).toEqual(
      ['document_collection', 'joining', 'pre_joining'].sort(),
    );
  });

  it('maps document_collection and pre_joining to same-named checklist keys', () => {
    expect(STAGE_CHECKLIST.document_collection).toBe('document_collection');
    expect(STAGE_CHECKLIST.pre_joining).toBe('pre_joining');
  });

  it('maps the "joining" stage to the "joining_day" checklist key (not "joining")', () => {
    // Deliberate rename: the stage is `joining` but the checklist template key is
    // `joining_day`. Pin it so the mapping can't silently drift to `joining`.
    expect(STAGE_CHECKLIST.joining).toBe('joining_day');
  });

  it('every gated stage is a real forward-funnel stage', () => {
    for (const stage of Object.keys(STAGE_CHECKLIST)) {
      expect(FUNNEL_ORDER).toContain(stage);
    }
  });

  it('does not gate non-checklist stages such as applied or offer_released', () => {
    expect(STAGE_CHECKLIST.applied).toBeUndefined();
    expect(STAGE_CHECKLIST.offer_released).toBeUndefined();
    expect(STAGE_CHECKLIST.offer_accepted).toBeUndefined();
  });
});

// A compact, exhaustive confirmation of allowedNextStages. The heavy coverage
// lives in another suite; these cases exist so the invariants below (labels/valid
// stages/no-backwards) have a real consumer, and to lock the off-ramp rules that
// the STAGE tables above imply.
describe('allowedNextStages (confirmation + cross-checks with the tables)', () => {
  const expected: Record<string, string[]> = {
    applied: ['interview', 'rejected'],
    interview: ['selected', 'rejected'],
    selected: ['document_collection', 'rejected'],
    document_collection: ['offer_released', 'rejected'],
    offer_released: ['offer_accepted', 'offer_declined'],
    offer_accepted: ['pre_joining'],
    pre_joining: ['joining', 'no_show'],
    joining: ['transferred', 'no_show'],
    transferred: [],
  };

  for (const [from, next] of Object.entries(expected)) {
    it(`from "${from}" allows exactly ${JSON.stringify(next)}`, () => {
      expect(allowedNextStages(from)).toEqual(next);
    });
  }

  it('every off-ramp is terminal (no onward moves)', () => {
    for (const off of OFF_RAMPS) {
      expect(allowedNextStages(off)).toEqual([]);
    }
  });

  it('unknown / empty / non-stage inputs yield no moves', () => {
    expect(allowedNextStages('screening')).toEqual([]); // the retired default stage
    expect(allowedNextStages('')).toEqual([]);
    expect(allowedNextStages('NOT_A_STAGE')).toEqual([]);
  });

  it('rejected is offered only up to and including document_collection (pre-offer)', () => {
    for (const s of ['applied', 'interview', 'selected', 'document_collection']) {
      expect(allowedNextStages(s)).toContain('rejected');
    }
    for (const s of ['offer_released', 'offer_accepted', 'pre_joining', 'joining']) {
      expect(allowedNextStages(s)).not.toContain('rejected');
    }
  });

  it('offer_declined is the off-ramp only at offer_released', () => {
    expect(allowedNextStages('offer_released')).toContain('offer_declined');
    for (const s of FUNNEL_ORDER) {
      if (s === 'offer_released') continue;
      expect(allowedNextStages(s)).not.toContain('offer_declined');
    }
  });

  it('no_show is the off-ramp only at pre_joining and joining', () => {
    expect(allowedNextStages('pre_joining')).toContain('no_show');
    expect(allowedNextStages('joining')).toContain('no_show');
    for (const s of FUNNEL_ORDER) {
      if (s === 'pre_joining' || s === 'joining') continue;
      expect(allowedNextStages(s)).not.toContain('no_show');
    }
  });

  it('an accepted offer has no off-ramp — only forward to pre_joining', () => {
    expect(allowedNextStages('offer_accepted')).toEqual(['pre_joining']);
  });

  it('never returns the originating stage (no self-loops)', () => {
    for (const s of CANDIDATE_STAGES) {
      expect(allowedNextStages(s)).not.toContain(s);
    }
  });

  it('never moves backwards along the funnel; forward move is exactly one step', () => {
    for (let i = 0; i < FUNNEL_ORDER.length; i++) {
      const from = FUNNEL_ORDER[i];
      for (const to of allowedNextStages(from)) {
        const toIdx = FUNNEL_ORDER.indexOf(to as any);
        if (toIdx === -1) continue; // off-ramp, not on the forward line
        expect(toIdx).toBe(i + 1);
      }
    }
  });

  it('every reachable next-stage is a known candidate stage with a label', () => {
    for (const s of CANDIDATE_STAGES) {
      for (const to of allowedNextStages(s)) {
        expect(CANDIDATE_STAGES).toContain(to);
        expect(STAGE_LABELS[to]).toBeTruthy();
      }
    }
  });

  it('is a read-only query: repeated calls return equal but fresh arrays', () => {
    const a = allowedNextStages('applied');
    const b = allowedNextStages('applied');
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // a new array each call — safe for callers to mutate
  });
});
