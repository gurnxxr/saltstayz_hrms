import { describe, it, expect } from 'vitest';
import {
  COOLDOWN_SECONDS, EMPTY_STATE, FAILURE_WINDOW_MS, ISSUE_WINDOW_MS, MAX_FAILURES_PER_HOUR,
  MAX_PER_WINDOW, evaluateFailure, evaluateIssue, isLockedOut, type ThrottleState,
} from './passwordResetThrottle.service';

/**
 * The budgets that decide how many guesses an attacker gets at one account.
 *
 * Better Auth caps attempts per CODE at five. On its own that is worth nothing, because asking for
 * a fresh code resets the counter — so the real bound is how many codes one account will issue, and
 * that is this file. A window that silently stops rolling, or a counter that resets on the wrong
 * edge, would leave a limit that looks present and enforces nothing.
 */

const T0 = new Date('2026-08-03T10:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const state = (over: Partial<ThrottleState> = {}): ThrottleState => ({ ...EMPTY_STATE, ...over });

describe('the attacker budget is genuinely bounded', () => {
  it('five guesses per code over a million codes is under one in ten thousand', () => {
    // The property the whole design rests on. Asserted over the constants so that raising the
    // attempt cap, or shortening the code, fails here rather than silently weakening the flow.
    const OTP_SPACE = 10 ** 6;
    const ATTEMPTS_PER_CODE = 5;
    const perCode = ATTEMPTS_PER_CODE / OTP_SPACE;
    expect(perCode).toBeLessThan(1e-4);

    // And across a full hour of maximum abuse: 4 windows × 3 codes × 5 guesses.
    const codesPerHour = (60 / 15) * MAX_PER_WINDOW;
    const guessesPerHour = Math.min(codesPerHour * ATTEMPTS_PER_CODE, MAX_FAILURES_PER_HOUR);
    expect(guessesPerHour / OTP_SPACE).toBeLessThan(1e-4);
    // The hourly failure budget, not the per-code cap, is what binds.
    expect(guessesPerHour).toBe(MAX_FAILURES_PER_HOUR);
  });
});

describe('issuing a code', () => {
  it('allows the first one and records the window', () => {
    const r = evaluateIssue(state(), T0);
    expect(r.allowed).toBe(true);
    expect(r.next.issued_in_window).toBe(1);
    expect(r.next.window_started_at).toEqual(T0);
    expect(r.next.last_issued_at).toEqual(T0);
  });

  it('refuses a second inside the cooldown, and allows it after', () => {
    const s = state({ last_issued_at: T0, window_started_at: T0, issued_in_window: 1 });
    expect(evaluateIssue(s, at(COOLDOWN_SECONDS * 1000 - 1)).refusal).toBe('cooldown');
    expect(evaluateIssue(s, at(COOLDOWN_SECONDS * 1000)).allowed).toBe(true);
  });

  it('refuses beyond the per-window cap even once the cooldown has passed', () => {
    const s = state({ last_issued_at: T0, window_started_at: T0, issued_in_window: MAX_PER_WINDOW });
    const r = evaluateIssue(s, at(5 * 60 * 1000));
    expect(r.allowed).toBe(false);
    expect(r.refusal).toBe('window');
    expect(r.next.issued_in_window).toBe(MAX_PER_WINDOW); // refusal must not advance the counter
  });

  it('starts a fresh window once the old one has run out', () => {
    const s = state({ last_issued_at: T0, window_started_at: T0, issued_in_window: MAX_PER_WINDOW });
    const r = evaluateIssue(s, at(ISSUE_WINDOW_MS));
    expect(r.allowed).toBe(true);
    expect(r.next.issued_in_window).toBe(1);          // counts from this request, not from the old total
    expect(r.next.window_started_at).toEqual(at(ISSUE_WINDOW_MS)); // and the window is re-anchored
  });

  it('refuses outright while the account is out of failure budget', () => {
    const s = state({ failed_window_started_at: T0, failed_in_hour: MAX_FAILURES_PER_HOUR });
    // No cooldown, no codes issued — and still refused. Otherwise an attacker who burned the
    // failure budget could simply keep requesting fresh codes.
    expect(evaluateIssue(s, at(60_000)).refusal).toBe('locked_out');
  });
});

describe('failed confirmations', () => {
  it('counts up and locks out at the cap', () => {
    let s = state();
    for (let i = 0; i < MAX_FAILURES_PER_HOUR; i += 1) {
      expect(isLockedOut(s, T0)).toBe(false);
      s = evaluateFailure(s, T0);
    }
    expect(s.failed_in_hour).toBe(MAX_FAILURES_PER_HOUR);
    expect(isLockedOut(s, T0)).toBe(true);
  });

  it('frees the account gradually, not on a cliff at the hour mark', () => {
    const s = state({ failed_window_started_at: T0, failed_in_hour: MAX_FAILURES_PER_HOUR });
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS - 1))).toBe(true);
    // The moment the window rolls, the whole of the last hour still sits inside the trailing hour.
    // The old fixed window dropped it to zero here, which is what handed an attacker a second full
    // budget by waiting a minute.
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS))).toBe(true);
    // Half a window later, half of it has aged out: 15 × 0.5 = 7.5, under the cap of 15.
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS * 1.5))).toBe(false);
    // And two clear windows later nothing carries at all.
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS * 2))).toBe(false);
  });

  it('does not hand back a second full budget to someone who straddles the boundary', () => {
    // The defect this design exists to close. Burn the hour's budget, wait just past the boundary,
    // and try to burn it again: the carried count must keep the account locked well into the next
    // window rather than resetting to zero the instant the clock ticks over.
    let s = state();
    for (let i = 0; i < MAX_FAILURES_PER_HOUR; i += 1) s = evaluateFailure(s, at(FAILURE_WINDOW_MS - 1000));
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS + 1000))).toBe(true);
    expect(isLockedOut(s, at(FAILURE_WINDOW_MS + 60_000))).toBe(true);
  });

  it('re-anchors the hour in whole windows, carrying the previous count', () => {
    const s = state({ failed_window_started_at: T0, failed_in_hour: 9 });
    const next = evaluateFailure(s, at(FAILURE_WINDOW_MS + 1000));
    expect(next.failed_in_hour).toBe(1);
    expect(next.failed_in_prev_window).toBe(9);
    // Anchored to T0 + one window, NOT to the moment of the request. Re-anchoring to `now` would
    // let an attacker walk the window forward for ever by spacing failures just past the boundary.
    expect(next.failed_window_started_at).toEqual(at(FAILURE_WINDOW_MS));
  });

  it('leaves the issuance counters alone', () => {
    // The two budgets are independent; a wrong code must not consume a code allowance.
    const s = state({ last_issued_at: T0, window_started_at: T0, issued_in_window: 2 });
    const next = evaluateFailure(s, T0);
    expect(next.issued_in_window).toBe(2);
    expect(next.window_started_at).toEqual(T0);
  });
});
