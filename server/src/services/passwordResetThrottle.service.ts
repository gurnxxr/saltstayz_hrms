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
/** Failed confirmations before the account stops accepting codes for the rest of the hour. */
export const MAX_FAILURES_PER_HOUR = 15;
export const FAILURE_WINDOW_MS = 60 * 60 * 1000;

export interface ThrottleState {
  last_issued_at: Date | null;
  window_started_at: Date | null;
  issued_in_window: number;
  failed_window_started_at: Date | null;
  failed_in_hour: number;
}

export const EMPTY_STATE: ThrottleState = {
  last_issued_at: null,
  window_started_at: null,
  issued_in_window: 0,
  failed_window_started_at: null,
  failed_in_hour: 0,
};

const elapsed = (from: Date | null, now: Date) => (from ? now.getTime() - from.getTime() : Infinity);

/** True when this account has burned its hourly failure budget. Checked before a code is accepted. */
export function isLockedOut(state: ThrottleState, now: Date): boolean {
  if (elapsed(state.failed_window_started_at, now) >= FAILURE_WINDOW_MS) return false; // window rolled
  return state.failed_in_hour >= MAX_FAILURES_PER_HOUR;
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
  const expired = elapsed(state.failed_window_started_at, now) >= FAILURE_WINDOW_MS;
  return {
    ...state,
    failed_window_started_at: expired ? now : state.failed_window_started_at,
    failed_in_hour: (expired ? 0 : state.failed_in_hour) + 1,
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
      updated_at: trx.fn.now(),
    }).onConflict('user_id').merge();
  });
}

/** Clear a user's budget after a successful reset — they have proved control of the mailbox. */
export async function clearThrottle(userId: number): Promise<void> {
  await db(TABLE).where('user_id', userId).del();
}
