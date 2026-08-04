import db from '../config/database';
import { auth } from '../config/auth';
import { ValidationError } from '../utils/errors';
import { isMailConfigured } from './mailer';
import { lockedOut, recordFailure, reserveIssue, clearThrottle } from './passwordResetThrottle.service';

/**
 * Self-service password reset by one-time code.
 *
 * This is the only unauthenticated, state-changing surface the application owns, and the only place
 * a stranger can act on an account they have not proved they hold. Two principles run through it.
 *
 * FIRST: it tells the caller nothing. Not whether the address is registered, not whether a code is
 * outstanding, not whether the account is active, not whether mail is working. Every path through
 * `request` returns the same body; every failure in `confirm` returns the same error. An endpoint
 * that distinguishes "no such user" from "wrong code" is a membership oracle for a staff directory,
 * and this one holds salaries.
 *
 * SECOND: Better Auth owns the cryptography and we own the policy. The code is generated, hashed,
 * expired, attempt-capped and single-used by the library — all verified rather than assumed. What
 * the library cannot do is bound guesses against ONE account across many connections, because its
 * rate limiting is per-IP and in memory. That is `passwordResetThrottle`, and it is the part that
 * turns five guesses per code into five guesses full stop.
 */

/** The one thing `request` ever says. Identical for a known address, an unknown one, or a dead mailbox. */
export const REQUEST_ACK = 'If that email address has an account, a code is on its way.';
/** The one thing `confirm` ever says when anything at all goes wrong. */
const CONFIRM_REJECT = 'That code is not valid or has expired. Request a new one.';

/**
 * Look up the account without revealing that we did.
 *
 * Matches on the lowercased address EXACTLY, because that is what Better Auth will match on when it
 * is handed the same address a moment later. A case-insensitive lookup here found accounts whose
 * stored `users.email` carries an uppercase letter; Better Auth then failed to find the same row,
 * so the code was never issued — while `reserveIssue` had already spent one of that account's three
 * codes per fifteen minutes. Half-working was worse than not working: the person got nothing and
 * their budget drained. Agreeing with Better Auth makes the two halves consistent.
 */
async function findUser(email: string) {
  return db('users')
    .where('email', email.trim().toLowerCase())
    .select('id', 'email', 'is_active', 'banned')
    .first();
}

/**
 * Is there a live code for this address?
 *
 * Consulted before charging a failed confirmation, because otherwise anyone who knows a colleague's
 * email could post fifteen junk codes and lock that person out of recovery for an hour — without a
 * code ever having been issued. The failure budget exists to bound guesses at a LIVE code; when
 * there is no code, there is nothing to guess and nothing to charge for.
 */
async function hasOutstandingCode(email: string): Promise<boolean> {
  const row = await db('verification')
    .where('identifier', `forget-password-otp-${email.trim().toLowerCase()}`)
    .where('expiresAt', '>', new Date())
    .first();
  return Boolean(row);
}

/**
 * Ask for a code.
 *
 * Never throws for anything about the account — an unknown address, a deactivated one, an exhausted
 * budget and a provider outage all return normally. The only way this rejects is a malformed body,
 * which the schema catches before we get here and which says nothing about any account.
 */
export function requestReset(email: string): { message: string } {
  // Returns SYNCHRONOUSLY, before a single query runs. Saying the same sentence is not enough if it
  // takes a different amount of time to say it: an address with an account cost a locked
  // transaction plus a TLS round-trip to the mail provider, an unknown one cost a single indexed
  // SELECT. That is a hundredfold gap — one probe per address classified it, which is exactly the
  // membership oracle this endpoint exists to avoid, against a staff directory holding Aadhaar
  // numbers and salaries. (The gap is not Better Auth being slow: with no
  // `advanced.backgroundTasks.handler` configured, its `runInBackgroundOrAwait` awaits the send
  // inline.) Doing every account-dependent step AFTER the acknowledgement removes the signal at the
  // source rather than trying to pad it away.
  pendingWork = doRequestReset(email).catch((err) => {
    console.error('[password-reset] request failed after acknowledgement:', (err as Error).message);
  });
  return { message: REQUEST_ACK };
}

/**
 * TESTS ONLY. Resolves once the detached work from the most recent `requestReset` has settled.
 *
 * The flow is deliberately fire-and-forget, so a test that asserts on what was emailed has no other
 * way to know when to look. Nothing in the running application awaits this.
 */
let pendingWork: Promise<unknown> = Promise.resolve();
export function whenRequestSettled(): Promise<unknown> { return pendingWork; }

async function doRequestReset(email: string): Promise<void> {
  // Not configured means the feature is off.
  if (!isMailConfigured()) return;

  const user = await findUser(email);
  // Unknown address, deactivated leaver, or banned account: do nothing. Offboarding sets
  // users.is_active = false, so this is what keeps a leaver from resetting their way back in.
  if (!user || user.is_active === false || user.banned === true) return;

  const { allowed } = await reserveIssue(user.id);
  if (!allowed) return;

  try {
    // Better Auth generates the code, hashes it with our pepper, stores it, and calls
    // sendVerificationOTP — which is where the mail actually goes out.
    await auth.api.requestPasswordResetEmailOTP({ body: { email: user.email } });
  } catch (err) {
    // A provider outage is only ever an operator's problem. Logged WITHOUT the address.
    console.error('[password-reset] could not issue a code:', (err as Error).message);
  }
}

/**
 * Redeem a code and set a new password.
 *
 * Every failure — unknown address, no outstanding code, wrong code, expired code, already-used
 * code, attempt-capped code, deactivated account, weak password — produces the same 400 with the
 * same sentence. The library does not do this for us: it answers 400 for a wrong code but 403 once
 * the attempt cap trips, and the difference between those two tells an attacker they have found an
 * account with a live code. Everything is flattened here.
 */
export async function confirmReset(email: string, otp: string, newPassword: string): Promise<{ message: string }> {
  const reject = () => new ValidationError(CONFIRM_REJECT);
  if (!isMailConfigured()) throw reject();

  const user = await findUser(email);
  if (!user || user.is_active === false || user.banned === true) throw reject();

  // Out of failure budget: refuse without consulting the code at all, so a locked-out account
  // cannot be used to probe which codes are live.
  if (await lockedOut(user.id)) throw reject();

  try {
    // Note the field is `password` here, not `newPassword` — the emailOTP plugin and core disagree,
    // and core's name is the one people expect. The controller accepts `newPassword` and maps it.
    await auth.api.resetPasswordEmailOTP({ body: { email: user.email, otp, password: newPassword } });
  } catch (err) {
    // Charge the failure ONLY if there was a live code to get wrong. Charging unconditionally made
    // the budget a weapon: anyone who knew a colleague's address could post fifteen junk codes and
    // deny that person self-service recovery for an hour, repeatedly, without a code ever having
    // been issued. Guessing when nothing is outstanding costs the attacker the same as it gains.
    //
    // recordFailure is deliberately not awaited inside the same expression as the throw: if the
    // throttle write itself fails, the caller must still get the uniform 400 rather than a 500 that
    // says "this address is real enough to have a throttle row".
    try {
      if (await hasOutstandingCode(user.email)) await recordFailure(user.id);
    } catch (throttleErr) {
      console.error('[password-reset] could not record a failure:', (throttleErr as Error).message);
    }
    console.error('[password-reset] confirmation refused:', (err as Error).message);
    throw reject();
  }

  // They have proved control of the mailbox; the budget that existed to protect them is spent.
  await clearThrottle(user.id);
  return { message: 'Your password has been updated. Please sign in.' };
}
