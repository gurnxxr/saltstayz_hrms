import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/propertyAnalytics.service';

function filters(req: AuthRequest) {
  return {
    cluster_id: req.query.cluster_id ? Number(req.query.cluster_id) : undefined,
    property_id: req.query.property_id ? Number(req.query.property_id) : undefined,
  };
}

export async function budgetOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.budgetOverview(filters(req), req.user!)); } catch (err) { next(err); }
}

export async function headcountByRole(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.headcountByRole(filters(req), req.user!)); } catch (err) { next(err); }
}

export async function salaryVariance(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.salaryVariance(filters(req), req.user!)); } catch (err) { next(err); }
}

export async function attrition(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const months = req.query.months ? Number(req.query.months) : 12;
    res.json(await svc.attrition(filters(req), req.user!, months));
  } catch (err) { next(err); }
}

export async function backfill(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.backfill(filters(req), req.user!)); } catch (err) { next(err); }
}

export async function exceptionLog(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.exceptionLog(filters(req), req.user!)); } catch (err) { next(err); }
}
