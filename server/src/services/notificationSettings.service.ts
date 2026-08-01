import db from '../config/database';
import { ValidationError } from '../utils/errors';
import {
  AUDIENCE_META, Audience, EVENTS, getEvent, isAudience,
} from './notificationEvents';

const TABLE = 'notification_settings';

/**
 * The grid behind Admin → Notifications: every event, and which audiences are ticked.
 *
 * The catalogue is the source of truth for the rows; the table only holds the ticks. An event
 * added to notificationEvents.ts therefore shows up here immediately, unticked, with no backfill.
 */
export async function getGrid() {
  const rows = await db(TABLE).where('enabled', true).select('event_key', 'audience');

  const ticked = new Map<string, string[]>();
  for (const r of rows) {
    if (!ticked.has(r.event_key)) ticked.set(r.event_key, []);
    ticked.get(r.event_key)!.push(r.audience);
  }

  return {
    audiences: AUDIENCE_META,
    events: EVENTS.map((e) => ({
      ...e,
      // Scoped audiences need an employee to resolve against, so a system event can only ever
      // reach the three role tiers. The client greys the rest; this is what it greys them from.
      selectableAudiences: e.carriesEmployee
        ? AUDIENCE_META.map((a) => a.key)
        : AUDIENCE_META.filter((a) => !a.scoped).map((a) => a.key),
      enabled: ticked.get(e.key) ?? [],
    })),
  };
}

/** Replaces the ticked audiences for one event. */
export async function setEventAudiences(eventKey: string, audiences: unknown) {
  const event = getEvent(eventKey);
  if (!event) throw new ValidationError(`Unknown notification event: ${eventKey}`);
  if (!Array.isArray(audiences)) throw new ValidationError('audiences must be an array');

  const wanted = [...new Set(audiences.map(String))];
  for (const a of wanted) {
    if (!isAudience(a)) throw new ValidationError(`Unknown audience: ${a}`);
    // Mirror of the greyed-out cell. Enforced here too: the UI is a convenience, not the rule.
    if (!event.carriesEmployee && AUDIENCE_META.find((m) => m.key === a)?.scoped) {
      throw new ValidationError(
        `"${event.label}" is not about a particular employee, so it cannot notify their ${a.replace(/_/g, ' ')}.`,
      );
    }
  }

  await db.transaction(async (trx) => {
    await trx(TABLE).where('event_key', eventKey).del();
    if (wanted.length) {
      await trx(TABLE).insert(
        wanted.map((audience) => ({ event_key: eventKey, audience, enabled: true })),
      );
    }
  });

  return { event_key: eventKey, enabled: wanted as Audience[] };
}

// ─── Activity ───

/**
 * How many of each thing happened, over a period.
 *
 * Counted from the source tables by their own timestamps, deliberately NOT from `notifications`.
 * Counting notifications would report only what somebody happened to subscribe to, and would
 * multiply each event by its number of recipients — so the answer would change when you ticked a
 * box. These figures are true regardless of who is being told.
 */
const ACTIVITY_SOURCES: Array<{ label: string; group: string; table: string; column?: string }> = [
  { label: 'Leave requests raised', group: 'Leave', table: 'leave_requests' },
  { label: 'Leave encashments raised', group: 'Leave', table: 'leave_encashments' },
  { label: 'Regularisations raised', group: 'Attendance', table: 'attendance_regularisations' },
  { label: 'Shift change requests', group: 'Shifts', table: 'employee_shift_change_requests' },
  { label: 'Hiring exceptions raised', group: 'Manpower', table: 'manpower_exceptions' },
  { label: 'Status changes (PIP / left / absconding)', group: 'People', table: 'employee_status_history' },
  { label: 'Transfers', group: 'People', table: 'employee_transfers' },
  { label: 'Exits initiated', group: 'People', table: 'offboarding_cases' },
];

/** Monday-based start of the current week, as YYYY-MM-DD. */
function startOfWeek(today: Date): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // getUTCDay(): 0 = Sunday. Shift so Monday is the first day.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export async function getActivity() {
  const now = new Date();
  const thisWeek = startOfWeek(now);
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  const countSince = async (table: string, column: string, from: string, to?: string) => {
    const q = db(table).whereRaw(`${column}::date >= ?`, [from]);
    if (to) q.whereRaw(`${column}::date < ?`, [to]);
    const row = await q.count('* as c').first();
    return Number((row as any)?.c ?? 0);
  };

  const rows = [];
  for (const src of ACTIVITY_SOURCES) {
    const col = src.column ?? 'created_at';
    // A table that has not been created yet (or was renamed) must not take the whole page down.
    try {
      rows.push({
        label: src.label,
        group: src.group,
        this_week: await countSince(src.table, col, thisWeek),
        this_month: await countSince(src.table, col, `${thisMonth}-01`),
        last_month: await countSince(src.table, col, `${lastMonth}-01`, `${thisMonth}-01`),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[activity] ${src.table} failed:`, (err as Error).message);
    }
  }

  return { week_starting: thisWeek, month: thisMonth, last_month: lastMonth, rows };
}
