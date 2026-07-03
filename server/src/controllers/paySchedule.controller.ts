import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/paySchedule.service';

export async function getPaySchedule(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.getPaySchedule());
  } catch (err) {
    next(err);
  }
}

export async function updatePaySchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.updatePaySchedule(req.body, req.user!.userId));
  } catch (err) {
    next(err);
  }
}
