import db from '../config/database';
import { LOCK, advisoryXactLock } from '../utils/locks';

/**
 * Per-account budgets for password reset. See migration 035 for why these exist at all.
 *
 * The arithmetic is separated from the database on purpose: windows and counters are exactly the
 * sort of thing that is easy to get subtly wrong (a window that never rolls over, a counter that
 * resets on the wrong edge) and impossible to notice, because the failure mode is a limit that
 * silently stops limiting. Everything below `evaluate*` is pure and directly tested.
 */

/** Seconds before a second code may be requested. Mirrored by the client's resend countdown. */
export const COOLDOWN_SECONDS = 60;
/** Codes per window, and the window. This is the dial that bounds an attacker's total guesses. */
export const MAX_PER_WINDOW = 3;
export const ISSUE_WINDOW_MS = 15 * 60 * 1000;
/** Failed confirmations allowed per hour, measured over a SLIDING hour — see `rollFailures`. */
export const MAX_FAILURES_PER_HOUR = 15;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

export interface ThrottleState {
  last_issued_at: Date | null;
  window_started_at: Date | null;
  issued_in_window: number;
  failed_window_started_at: Date | null;
  failed_in_hour: number;
  failed_in_prev_window: number;
}

export const EMPTY_STATE: ThrottleState = {
  last_issued_at: null,
  window_started_at: null,
  issued_in_window: 0,
  failed_window_started_at: null,
  failed_in_hour: 0,
  failed_in_prev_window: 0,
};

const elapsed = (from: Date | null, now: Date) => (from ? now.getTime() - from.getTime() : Infinity);

/**
 * Advance the failure buckets to `now` without recording anything.
 *
 * The failure budget used to be a FIXED window anchored on the first failure and reset wholesale
 * when it expired, which handed an attacker who timed a burst against the boundary roughly double
 * the intended guesses back to back: fifteen at 59 minutes, the window resets, fifteen more at 61.
 * Two buckets — this window and the one before it — let the count decay smoothly instead.
 *
 * Note the anchor moves in whole windows (`start + FAILURE_WINDOW_MS`), not to `now`. Re-anchoring
 * to the moment of the request would let an attacker walk the window forward indefinitely by
 * spacing failures just over the boundary, which is the same defect in a different costume.
 */
function rollFailures(state: ThrottleState, now: Date): { start: Date | null; prev: number; current: number } {
  const start = state.failed_window_started_at;
  if (!start) return { start: null, prev: 0, current: 0 };

  const since = now.getTime() - start.getTime();
  if (since < FAILURE_WINDOW_MS) {
    return { start, prev: state.failed_in_prev_window, current: state.failed_in_hour };
  }
  if (since < 2 * FAILURE_WINDOW_MS) {
    // Exactly one window has passed: what was current becomes the previous bucket.
    return { start: new Date(start.getTime() + FAILURE_WINDOW_MS), prev: state.failed_in_hour, current: 0 };
  }
  return { start: null, prev: 0, current: 0 }; // two clear windows — nothing carries
}

/**
 * Failures over the trailing hour, counting the previous bucket in proportion to how much of it
 * still falls inside that hour. The standard two-bucket approximation — the same shape
 * `express-rate-limit` uses — chosen over storing one row per attempt because it is a fixed amount
 * of state and cannot grow under attack.
 */
function weightedFailures(state: ThrottleState, now: Date): number {
  const { start, prev, current } = rollFailures(state, now);
  if (!start) return current;
  const intoWindow = now.getTime() - start.getTime();
  const carry = Math.max(0, 1 - intoWindow / FAILURE_WINDOW_MS);
  return current + prev * carry;
}

/** True when this account has burned its hourly failure budget. Checked before a code is accepted. */
export function isLockedOut(state: ThrottleState, now: Date): boolean {
  return weightedFailures(state, now) >= MAX_FAILURES_PER_HOUR;
}

export type IssueRefusal = 'cooldown' | 'window' | 'locked_out';

/**
 * Whether a new code may be issued, and the state to store if it is.
 *
 * Returns the next state rather than mutating, so the caller writes exactly once inside its
 * transaction and there is no half-applied counter if the write fails.
 */
export function evaluateIssue(
  state: ThrottleState, now: Date,
): { allowed: boolean; refusal?: IssueRefusal; next: ThrottleState } {
  if (isLockedOut(state, now)) return { allowed: false, refusal: 'locked_out', next: state };
  if (elapsed(state.last_issued_at, now) < COOLDOWN_SECONDS * 1000) {
    return { allowed: false, refusal: 'cooldown', next: state };
  }

  // A window that has run out starts again from this request, rather than being extended — so the
  // limit is "3 per 15 minutes", not "3 ever, with a slowly sliding reprieve".
  const windowExpired = elapsed(state.window_started_at, now) >= ISSUE_WINDOW_MS;
  const windowStart = windowExpired ? now : state.window_started_at!;
  const issued = windowExpired ? 0 : state.issued_in_window;

  if (issued >= MAX_PER_WINDOW) return { allowed: false, refusal: 'window', next: state };

  return {
    allowed: true,
    next: { ...state, last_issued_at: now, window_started_at: windowStart, issued_in_window: issued + 1 },
  };
}

/** The state to store after a failed confirmation. */
export function evaluateFailure(state: ThrottleState, now: Date): ThrottleState {
  const { start, prev, current } = rollFailures(state, now);
  return {
    ...state,
    failed_window_started_at: start ?? now,
    failed_in_prev_window: start ? prev : 0,
    failed_in_hour: current + 1,
  };
}

// ─── Persistence ───

const TABLE = 'password_reset_throttle';

function toState(row: any): ThrottleState {
  if (!row) return { ...EMPTY_STATE };
  return {
    last_issued_at: row.last_issued_at ? new Date(row.last_issued_at) : null,
    window_started_at: row.window_started_at ? new Date(row.window_started_at) : null,
    issued_in_window: Number(row.issued_in_window) || 0,
    failed_window_started_at: row.failed_window_started_at ? new Date(row.failed_window_started_at) : null,
    failed_in_hour: Number(row.failed_in_hour) || 0,
    failed_in_prev_window: Number(row.failed_in_prev_window) || 0,
  };
}

/**
 * Claim one issuance for this user, or refuse. Atomic.
 *
 * The advisory lock is not decoration. Postgres is MVCC, so two requests arriving together each
 * read the state from before the other started, both see room in the window, and both issue — which
 * is precisely the multiplier the window exists to prevent. `utils/locks.ts` documents the pattern;
 * this is the same check-then-write shape as `applyLeave`.
 */
export async function reserveIssue(userId: number, now = new Date()): Promise<{ allowed: boolean; refusal?: IssueRefusal }> {
  return db.transaction(async (trx) => {
    await advisoryXactLock(trx, LOCK.PASSWORD_RESET, userId);
    const state = toState(await trx(TABLE).where('user_id', userId).first());
    const verdict = evaluateIssue(state, now);
    if (!verdict.allowed) return { allowed: false, refusal: verdict.refusal };

    await trx(TABLE).insert({
      user_id: userId,
      last_issued_at: verdict.next.last_issued_at,
      window_started_at: verdict.next.window_started_at,
      issued_in_window: verdict.next.issued_in_window,
      failed_window_started_at: verdict.next.failed_window_started_at,
      failed_in_hour: verdict.next.failed_in_hour,
      failed_in_prev_window: verdict.next.failed_in_prev_window,
      updated_at: trx.fn.now(),
    }).onConflict('user_id').merge();

    return { allowed: true };
  });
}

/** True when this account is out of failure budget and must not be allowed to try a code. */
export async function lockedOut(userId: number, now = new Date()): Promise<boolean> {
  const state = toState(await db(TABLE).where('user_id', userId).first());
  return isLockedOut(state, now);
}

/** Record one failed confirmation. */
export async function recordFailure(userId: number, now = new Date()): Promise<void> {
  await db.transaction(async (trx) => {
    await advisoryXactLock(trx, LOCK.PASSWORD_RESET, userId);
    const next = evaluateFailure(toState(await trx(TABLE).where('user_id', userId).first()), now);
    await trx(TABLE).insert({
      user_id: userId,
      last_issued_at: next.last_issued_at,
      window_started_at: next.window_started_at,
      issued_in_window: next.issued_in_window,
      failed_window_started_at: next.failed_window_started_at,
      failed_in_hour: next.failed_in_hour,
      failed_in_prev_window: next.failed_in_prev_window,
      updated_at: trx.fn.now(),
    }).onConflict('user_id').merge();
  });
}

/**
 * Clear a user's budget after a successful reset — they have proved control of the mailbox.
 *
 * Takes the same lock as its neighbours. Without it the delete does not serialise against an
 * in-flight `recordFailure`, which re-inserts the row afterwards and re-locks an account the reset
 * had just freed — leaving someone who has genuinely recovered their password unable to try again.
 */
export async function clearThrottle(userId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await advisoryXactLock(trx, LOCK.PASSWORD_RESET, userId);
    await trx(TABLE).where('user_id', userId).del();
  });
}
