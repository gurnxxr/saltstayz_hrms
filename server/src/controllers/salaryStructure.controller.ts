import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/salaryStructure.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listStructures());
  } catch (err) { next(err); }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.getStructure(Number(req.params.jobTitleId)));
  } catch (err) { next(err); }
}

export async function upsert(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.upsertStructure(Number(req.params.jobTitleId), req.body));
  } catch (err) { next(err); }
}
