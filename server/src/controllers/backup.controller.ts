import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { runBackup, listBackups } from '../services/backup.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(listBackups());
  } catch (err) { next(err); }
}

export async function run(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await runBackup());
  } catch (err) { next(err); }
}
