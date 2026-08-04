import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../utils/errors';
import * as service from '../services/passwordReset.service';
import { isMailConfigured } from '../services/mailer';

/**
 * The only unauthenticated, state-changing controller in the application.
 *
 * `otp` is named exactly that on purpose. The audit redactor matches 'otp' as a case-insensitive
 * substring of a key name and replaces the value with [redacted], so the code never reaches
 * `audit_logs.metadata`. Renaming the field to `code` or `pin` would silently start logging it.
 */

const requestSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
});

const confirmSchema = z.object({
  email: z.string().trim().min(3).max(254).email(),
  otp: z.string().regex(/^[0-9]{6}$/),
  /**
   * Ten characters, enforced HERE rather than globally.
   *
   * `config/auth.ts` sets minPasswordLength to 4 so the seeded "1234" demo logins keep working. A
   * reset flow that inherited that would let a stranger who reached a mailbox set a four-character
   * password on an account holding salaries — the flow would be a downgrade, not a protection.
   * Raising the global minimum is the better long-term fix but breaks the bulk login creator, so
   * this path holds its own line and the legacy accounts are unaffected.
   */
  newPassword: z.string().min(10).max(128),
});

const parse = <T>(schema: z.ZodSchema<T>, body: unknown, uniformMessage?: string): T => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // On /confirm every rejection must read the same. Letting zod speak here was a hole in exactly
    // the property this endpoint is built around: "String must contain at least 10 character(s)"
    // told an attacker their CODE had been accepted and only the password was refused, and a
    // malformed OTP produced a third distinct body. /request has no such constraint — its schema
    // only checks the address shape, which the caller already knows.
    throw new ValidationError(uniformMessage || parsed.error.issues[0]?.message || 'Invalid request');
  }
  return parsed.data;
};

/** The one thing `confirm` ever says when anything at all goes wrong — schema included. */
const CONFIRM_REJECT = 'That code is not valid or has expired. Request a new one.';

/**
 * Whether a code can actually be sent from this box. An operator diagnostic, not a UI gate.
 *
 * The login screen used to ask this before offering the link, and hid it when the answer was false.
 * It no longer does — the link is always shown — so this exists to answer "is mail wired up here?"
 * without reading the deployment's environment. Booleans only: it says whether a provider is
 * configured, never which one or with what.
 */
export async function capabilities(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ password_reset: isMailConfigured() });
  } catch (err) { next(err); }
}

export async function requestReset(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = parse(requestSchema, req.body);
    // 202: we have accepted the request. Not 200 — nothing has necessarily happened, and it would
    // be wrong to imply otherwise. `service.requestReset` returns without awaiting any lookup, so
    // this response is written in the same time whether or not the address has an account.
    res.status(202).json(service.requestReset(email));
  } catch (err) { next(err); }
}

/**
 * Every confirmation takes at least this long, whatever it decides.
 *
 * `/request` closed its timing gap by answering before doing any account work. `/confirm` cannot —
 * it has to return a real verdict — and the two paths are not the same length: an unknown or
 * deactivated address throws after one query, while a real account runs a Better Auth verification
 * and a committing transaction. Left alone that is a second, quieter membership oracle. A floor
 * comfortably above the slow path makes both indistinguishable; 250ms is imperceptible to someone
 * typing a code and is well clear of the ~100ms the real path takes locally.
 */
const CONFIRM_FLOOR_MS = 250;

const holdUntilFloor = async (startedAt: number): Promise<void> => {
  const remaining = CONFIRM_FLOOR_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

export async function confirmReset(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  try {
    const { email, otp, newPassword } = parse(confirmSchema, req.body, CONFIRM_REJECT);
    const result = await service.confirmReset(email, otp, newPassword);
    await holdUntilFloor(startedAt);
    res.json(result);
  } catch (err) {
    // The failure paths are the fast ones, so this is the branch that most needs the floor.
    await holdUntilFloor(startedAt);
    next(err);
  }
}
