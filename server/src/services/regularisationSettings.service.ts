import db from '../config/database';
import { ValidationError } from '../utils/errors';

// Org-wide attendance-regularisation guardrails. One singleton row lives in
// `regularisation_settings` (migration 029), which is also where the reasoning for each
// field lives.

const TABLE = 'regularisation_settings';

/**
 * The regularisation types an admin is allowed to put in `allowed_types`.
 *
 * Deliberately NOT imported from regularisation.service — that module imports this one, and
 * pointing them at each other would be a circular import. They also answer different questions:
 * this is "what may be OFFERED to an employee", while TYPE_TO_STATUS over there is "what the
 * chosen type MEANS once applied". Keep the two lists in step; TYPE_TO_STATUS must contain a
 * mapping for every code named here or an approval would have nothing to write.
 *
 * 'absent' is missing on purpose and is rejected by name below. An approved regularisation is
 * paid in full (payableDays reads is_regularised first), so offering "mark me absent" would be a
 * route to being paid for a day the employee themselves said they did not work. The full
 * reasoning is at regularisation.service.ts:36-39.
 */
export const SELECTABLE_TYPES = ['np', 'mp', 'sp', 'present'] as const;

/**
 * The longest range one request may cover, and the hard ceiling on `max_range_days`.
 *
 * This is not a taste question. requestRegularisation enforces the monthly cap by checking only
 * the START and END months of the requested range, on the stated grounds that a request spanning
 * at most 31 days can only touch two months. Allow a longer range and a request could span three
 * or more, and every month in the middle would skip its cap entirely. Raising this ceiling means
 * rewriting that check first.
 */
const RANGE_CEILING = 31;

/**
 * Outer bound on the deadline, in days after the attendance month ends.
 *
 * Kept to one month so "which attendance months are still open" stays a question about at most
 * the current month and the one before it — which is what both the refusal message and the date
 * picker's lower bound assume. A site that genuinely wants corrections open for longer wants no
 * deadline at all, which is what clearing the field does.
 */
const CUTOFF_CEILING = 31;

export interface RegularisationSettings {
  /** Days after the attendance month ends that corrections close. Null = no deadline. */
  cutoff_days_after_month_end: number | null;
  monthly_request_limit: number;
  max_range_days: number;
  allowed_types: string[];
}

const DEFAULTS: RegularisationSettings = {
  cutoff_days_after_month_end: 2,
  monthly_request_limit: 3,
  max_range_days: RANGE_CEILING,
  allowed_types: [...SELECTABLE_TYPES],
};

function parseRow(row: any) {
  if (!row) return { ...DEFAULTS };
  let allowed_types = DEFAULTS.allowed_types;
  try {
    const parsed = JSON.parse(row.allowed_types);
    // Drop anything no longer selectable rather than trusting the stored list: a code retired
    // from SELECTABLE_TYPES must stop being offered even though old rows still name it.
    if (Array.isArray(parsed)) {
      const kept = parsed.filter((t: any) => (SELECTABLE_TYPES as readonly string[]).includes(String(t)));
      if (kept.length) allowed_types = kept.map(String);
    }
  } catch {
    /* keep default */
  }
  return {
    id: row.id,
    // Null survives as null — it is the "no deadline" setting, not a missing value.
    cutoff_days_after_month_end: row.cutoff_days_after_month_end == null
      ? null : Number(row.cutoff_days_after_month_end),
    monthly_request_limit: Number(row.monthly_request_limit),
    max_range_days: Number(row.max_range_days),
    allowed_types,
    updated_by: row.updated_by,
    updated_at: row.updated_at,
  };
}

/**
 * The date on which corrections for `date`'s attendance month close, inclusive — a request
 * raised ON the cutoff is still in time.
 *
 * The arithmetic looks off by one and is not: `m` from a YYYY-MM-DD string is 1-based, while the
 * Date constructor's month is 0-based, so passing `m` names the FOLLOWING month. Day 0 of that
 * month is then the last day of this one, which is exactly what `days = 0` should mean ("fix it
 * before the month is out"). Month 12 rolls into January of the next year on its own.
 *
 * UTC throughout, like eachDate in regularisation.service, so no timezone can shift the date.
 */
export function cutoffDateFor(date: string, days: number): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, days)).toISOString().slice(0, 10);
}

export async function getRegularisationSettings() {
  const row = await db(TABLE).orderBy('id').first();
  return parseRow(row);
}

export async function updateRegularisationSettings(input: any, userId?: number) {
  const existing = await db(TABLE).orderBy('id').first();
  // A save is a MERGE onto the stored settings: any field the form omits keeps its stored value
  // (falling back to DEFAULTS only when there is no row yet).
  const current = parseRow(existing);

  // `!= null` is the usual test for "did the form send this", and it is WRONG for the deadline:
  // null is the setting that means "no deadline", so treating it as absent would make the opt-out
  // unreachable — you could turn a deadline on and never turn it off again. Presence of the KEY
  // is the question, so ask that instead.
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(input ?? {}, key);

  let cutoff = current.cutoff_days_after_month_end;
  if (sent('cutoff_days_after_month_end')) {
    const raw = input.cutoff_days_after_month_end;
    // '' comes back from an emptied number input; treat it as the same clearing gesture as null.
    if (raw === null || raw === '') {
      cutoff = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > CUTOFF_CEILING) {
        throw new ValidationError(`The regularisation deadline must be a whole number of days between 0 and ${CUTOFF_CEILING}, or blank for no deadline.`);
      }
      cutoff = n;
    }
  }

  let limit = current.monthly_request_limit;
  if (input?.monthly_request_limit != null) {
    limit = Number(input.monthly_request_limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 31) {
      throw new ValidationError('The monthly request limit must be a whole number between 1 and 31.');
    }
  }

  let range = current.max_range_days;
  if (input?.max_range_days != null) {
    range = Number(input.max_range_days);
    if (!Number.isInteger(range) || range < 1 || range > RANGE_CEILING) {
      throw new ValidationError(`A request can cover between 1 and ${RANGE_CEILING} days.`);
    }
  }

  let types = current.allowed_types;
  if (input?.allowed_types !== undefined) {
    if (!Array.isArray(input.allowed_types)) throw new ValidationError('Allowed regularisation types must be a list.');
    const raw: string[] = input.allowed_types.map((t: any) => String(t));
    if (raw.includes('absent')) {
      throw new ValidationError('"Absent" cannot be made requestable: an approved regularisation is paid in full, so it would let someone be paid for a day they said they did not work.');
    }
    const unknown = raw.filter((t: string) => !(SELECTABLE_TYPES as readonly string[]).includes(t));
    if (unknown.length) throw new ValidationError(`Unknown regularisation type: ${unknown.join(', ')}.`);
    const unique: string[] = [...new Set(raw)];
    if (!unique.length) {
      throw new ValidationError('At least one regularisation type must stay available, otherwise nobody can raise a correction.');
    }
    types = unique;
  }

  const patch = {
    cutoff_days_after_month_end: cutoff,
    monthly_request_limit: limit,
    max_range_days: range,
    allowed_types: JSON.stringify(types),
    updated_by: userId || null,
    updated_at: db.fn.now(),
  };

  // Singleton upsert (existing fetched above).
  if (existing) await db(TABLE).where('id', existing.id).update(patch);
  else await db(TABLE).insert(patch);

  return getRegularisationSettings();
}
