import db from '../config/database';
import { getEvent, isAudience } from './notificationEvents';
import { resolveAudience } from './notificationScope.service';

const TABLE = 'notifications';

export interface NotificationPayload {
  type: string;
  title: string;
  message?: string;
  link?: string | null;
}

/**
 * Creates a notification for a specific user. Fire-and-forget: never throws into
 * the calling operation. This is the single delivery seam — an email/SMS provider
 * can be invoked here later without changing any call site.
 */
export async function notify(userId: number | null | undefined, p: NotificationPayload): Promise<void> {
  if (!userId) return;
  try {
    await db(TABLE).insert({
      user_id: userId,
      type: p.type,
      title: p.title,
      message: p.message ?? null,
      link: p.link ?? null,
    });
    // Future: if an email provider is configured, dispatch here using the same payload.
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] failed:', (err as Error).message);
  }
}

/** Notifies the active user account linked to an employee, if one exists. */
export async function notifyEmployee(employeeId: number | null | undefined, p: NotificationPayload): Promise<void> {
  if (!employeeId) return;
  try {
    const user = await db('users').where({ employee_id: employeeId, is_active: true }).first();
    if (user) await notify(user.id, p);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifyEmployee] failed:', (err as Error).message);
  }
}

/** Delivers one payload to many users in a single insert. */
async function notifyMany(userIds: number[], p: NotificationPayload): Promise<void> {
  if (!userIds.length) return;
  await db(TABLE).insert(userIds.map((user_id) => ({
    user_id,
    type: p.type,
    title: p.title,
    message: p.message ?? null,
    link: p.link ?? null,
  })));
}

export interface EmitContext {
  /** The employee the event is about. Required for the three property-scoped audiences. */
  employeeId?: number | null;
  /**
   * Whoever performed the action, excluded from the fan-out. Telling someone what they just did is
   * noise, and for an event that exists as a second pair of eyes — locking payroll over a warning —
   * notifying only the person who did it defeats the entire point.
   *
   * Two fields rather than one because the two id spaces are genuinely different and confusing them
   * is a bug this codebase has already had (see regularisation.service.ts:359). Controllers hold a
   * user id; several services only ever see an employee id. Pass whichever you actually have.
   */
  actorUserId?: number | null;
  actorEmployeeId?: number | null;
  payload: NotificationPayload;
}

/**
 * Announces that something happened. Who hears about it is a setting, not a decision made here.
 *
 * Call sites name an EVENT; `notification_settings` names the audiences; notificationScope turns
 * those into actual people for this particular employee. That indirection is the point — before
 * it, "also tell finance" was a code change.
 *
 * Same fire-and-forget contract as notify(): this must never throw into the business operation
 * that triggered it. Call it AFTER the transaction commits, never inside — see the note at
 * regularisation.service.ts:345 for what reading on a different pooled connection costs.
 */
export async function emit(eventKey: string, ctx: EmitContext): Promise<void> {
  try {
    if (!getEvent(eventKey)) {
      // A typo'd key would otherwise be a notification that silently never fires.
      console.error(`[emit] unknown event key: ${eventKey}`);
      return;
    }

    const audiences: string[] = await db('notification_settings')
      .where({ event_key: eventKey, enabled: true })
      .pluck('audience');
    if (!audiences.length) return;

    const recipients = new Set<number>();
    for (const audience of audiences) {
      if (!isAudience(audience)) continue;
      const ids = await resolveAudience(audience, { employeeId: ctx.employeeId });
      if (!ids.length) {
        // Nobody holds this audience for this employee — a typo'd branch_name, an unstaffed
        // cluster. Say so: a notification that resolves to nobody is the failure being fixed.
        console.warn(`[emit] ${eventKey}: audience '${audience}' resolved to nobody`);
        continue;
      }
      ids.forEach((id) => recipients.add(Number(id)));
    }

    if (ctx.actorUserId) recipients.delete(Number(ctx.actorUserId));
    if (ctx.actorEmployeeId) {
      const actor = await db('users').where('employee_id', ctx.actorEmployeeId).first();
      if (actor) recipients.delete(Number(actor.id));
    }
    await notifyMany([...recipients], ctx.payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[emit] ${eventKey} failed:`, (err as Error).message);
  }
}

// ─── Read side ───

export async function list(userId: number, limit = 20) {
  return db(TABLE).where('user_id', userId)
    .orderBy('created_at', 'desc').orderBy('id', 'desc')
    .limit(Math.min(50, limit));
}

export async function unreadCount(userId: number): Promise<number> {
  const row = await db(TABLE).where({ user_id: userId, is_read: false }).count('id as c').first();
  return Number((row as any)?.c ?? 0);
}

export async function markRead(userId: number, id: number) {
  await db(TABLE).where({ id, user_id: userId }).update({ is_read: true });
  return { message: 'Marked read' };
}

export async function markAllRead(userId: number) {
  await db(TABLE).where({ user_id: userId, is_read: false }).update({ is_read: true });
  return { message: 'All marked read' };
}
