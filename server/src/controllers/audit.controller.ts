import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/audit.service';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.list({
      search: req.query.search as string,
      module: req.query.module as string,
      action: req.query.action as string,
      from: req.query.from as string,
      to: req.query.to as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }));
  } catch (err) { next(err); }
}

export async function meta(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.meta());
  } catch (err) { next(err); }
}
