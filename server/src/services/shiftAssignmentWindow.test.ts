import { describe, it, expect } from 'vitest';
import { pickAssignmentFor } from './shiftPattern';

/**
 * Which assignment governs a date, once assignments can END.
 *
 * This function decides the shift, and the shift decides off-days, grace and the hour thresholds
 * that turn a punch into a full day, a half day or an absence — so getting it wrong moves money.
 * The cases below are the ones an end date newly makes possible; the open-ended ones are here to
 * prove nothing that worked before now behaves differently.
 */
const A = { id: 'A', effective_from: '2026-01-01', effective_to: null as string | null };
const B = { id: 'B', effective_from: '2026-07-01', effective_to: null as string | null };
const TODAY = '2026-07-31';

const pick = (rows: any[], date: string) => pickAssignmentFor(rows, date, TODAY)?.id ?? null;

describe('pickAssignmentFor — open-ended assignments (unchanged behaviour)', () => {
  it('takes the latest assignment that has started', () => {
    expect(pick([A, B], '2026-06-30')).toBe('A');
    expect(pick([A, B], '2026-07-01')).toBe('B');
    expect(pick([A, B], '2026-12-31')).toBe('B');
  });

  it('projects the earliest assignment backwards over dates that pre-date it', () => {
    expect(pick([B], '2026-03-15')).toBe('B');
  });

  it('refuses to let a future-dated assignment govern history', () => {
    const future = { id: 'F', effective_from: '2026-09-01', effective_to: null };
    expect(pick([future], '2026-03-15')).toBeNull();
  });
});

describe('pickAssignmentFor — with an end date', () => {
  const ended = { id: 'A', effective_from: '2026-01-01', effective_to: '2026-06-30' };

  it('governs up to and including the end date', () => {
    expect(pick([ended], '2026-06-29')).toBe('A');
    expect(pick([ended], '2026-06-30')).toBe('A'); // inclusive
  });

  it('stops governing the day after it ends', () => {
    expect(pick([ended], '2026-07-01')).toBeNull();
  });

  it('hands the date to a later assignment that covers it', () => {
    expect(pick([ended, B], '2026-06-30')).toBe('A');
    expect(pick([ended, B], '2026-07-01')).toBe('B');
  });

  it('leaves a gap unshifted rather than resurrecting the ended one', () => {
    // A ends in June, B starts in August — July belongs to neither. Returning A here would
    // silently undo the end date the admin set, which is the whole point of having one.
    const later = { id: 'B', effective_from: '2026-08-01', effective_to: null };
    expect(pick([ended, later], '2026-07-15')).toBeNull();
    expect(pick([ended, later], '2026-08-01')).toBe('B');
  });

  it('does NOT backfill an expired assignment onto earlier dates', () => {
    // The backfill exists for dates BEFORE any assignment started, not for dates after one ended.
    expect(pick([ended], '2025-11-01')).toBe('A'); // before it started → projected backwards
    expect(pick([ended], '2026-08-01')).toBeNull(); // after it ended → nothing
  });

  it('lets a later start win while both are live', () => {
    const long = { id: 'A', effective_from: '2026-01-01', effective_to: '2026-12-31' };
    const short = { id: 'B', effective_from: '2026-03-01', effective_to: '2026-03-14' };
    expect(pick([long, short], '2026-02-28')).toBe('A');
    expect(pick([long, short], '2026-03-05')).toBe('B'); // the more specific, later-starting one
    expect(pick([long, short], '2026-03-15')).toBe('A'); // short one over — back to the long one
  });

  it('treats an empty-string end date as open-ended, not as expired', () => {
    // The client sends '' from a cleared date input; it must not read as "ended on nothing".
    const blank = { id: 'A', effective_from: '2026-01-01', effective_to: '' };
    expect(pick([blank], '2026-12-31')).toBe('A');
  });
});
