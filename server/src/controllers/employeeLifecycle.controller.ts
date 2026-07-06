import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/employeeLifecycle.service';

export async function getOptions(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getOptions()); } catch (err) { next(err); }
}

export async function listEmployees(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listEmployees()); } catch (err) { next(err); }
}

// ─── Promotion ───

export async function listPromotions(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listPromotions()); } catch (err) { next(err); }
}

export async function createPromotion(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.createPromotion(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

// ─── Transfer ───

export async function listTransfers(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listTransfers()); } catch (err) { next(err); }
}

export async function createTransfer(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.createTransfer(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

// ─── Exit Interview ───

export async function listExitInterviews(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listExitInterviews({ status: req.query.status as string })); } catch (err) { next(err); }
}

export async function scheduleExitInterview(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.scheduleExitInterview(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function completeExitInterview(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.completeExitInterview(Number(req.params.id), req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}
