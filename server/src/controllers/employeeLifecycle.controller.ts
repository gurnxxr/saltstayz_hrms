import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/employeeLifecycle.service';
import * as assets from '../services/asset.service';

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

// ─── Company Assets: catalog + register ───

export async function listAssetTypes(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await assets.listAssetTypes(req.query.all === '1')); } catch (err) { next(err); }
}

export async function createAssetType(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await assets.createAssetType(req.body)); } catch (err) { next(err); }
}

export async function updateAssetType(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await assets.updateAssetType(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function listAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await assets.listAssignments({
      employee_id: req.query.employee_id ? Number(req.query.employee_id) : undefined,
      status: req.query.status as string,
    }));
  } catch (err) { next(err); }
}

export async function getOutstandingAssets(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await assets.getOutstandingAssets(Number(req.params.employeeId))); } catch (err) { next(err); }
}

export async function createAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await assets.createAssignment(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function updateAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await assets.updateAssignment(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function returnAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await assets.returnAssignment(Number(req.params.id), req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function deleteAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try { await assets.deleteAssignment(Number(req.params.id)); res.json({ ok: true }); } catch (err) { next(err); }
}
