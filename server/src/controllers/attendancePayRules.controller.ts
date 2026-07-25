import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/attendancePayRules.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listAttendancePayRules());
  } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.updateAttendancePayRule(String(req.params.code), req.body, req.user!.userId));
  } catch (err) { next(err); }
}
