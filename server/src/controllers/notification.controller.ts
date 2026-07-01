import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/notification.service';
import { ensureDailyAttendanceReminder } from '../services/attendance.service';

const ATTENDANCE_REMINDER_ROLES = ['admin', 'chro', 'hr'];

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Lazily surface the daily "upload attendance" reminder for HR/Admin (no scheduler needed).
    if (ATTENDANCE_REMINDER_ROLES.includes(req.user!.roleName)) {
      await ensureDailyAttendanceReminder(req.user!);
    }
    res.json(await svc.list(req.user!.userId));
  } catch (err) { next(err); }
}

export async function unreadCount(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ count: await svc.unreadCount(req.user!.userId) }); } catch (err) { next(err); }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.markRead(req.user!.userId, Number(req.params.id))); } catch (err) { next(err); }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.markAllRead(req.user!.userId)); } catch (err) { next(err); }
}
