import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/moduleAccess.service';

export async function searchEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.searchEmployees(req.query.q as string));
  } catch (err) { next(err); }
}

export async function getEmployeeAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.getEmployeeAccess(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}

export async function setEmployeeAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // allowed: true | false | null (null clears the override → role default)
    const { module, allowed } = req.body;
    res.json(await svc.setEmployeeAccess(
      Number(req.params.employeeId), module, allowed === null ? null : !!allowed, req.user?.userId ?? null,
    ));
  } catch (err) { next(err); }
}

export async function resetEmployeeAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.resetEmployeeAccess(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}
