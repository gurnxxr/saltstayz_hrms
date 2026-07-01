import db from '../config/database';

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

/** Broadcasts to every active user holding a given role (e.g. all HR). */
export async function notifyRole(roleName: string, p: NotificationPayload): Promise<void> {
  try {
    const users = await db('users as u')
      .join('roles as r', 'r.id', 'u.role_id')
      .where('r.name', roleName).where('u.is_active', true)
      .pluck('u.id');
    for (const uid of users) await notify(uid, p);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifyRole] failed:', (err as Error).message);
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
