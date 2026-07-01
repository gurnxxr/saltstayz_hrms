import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/offboarding.service';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listCases({ status: req.query.status as string, search: req.query.search as string }));
  } catch (err) { next(err); }
}

export async function stats(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.getStats()); } catch (err) { next(err); }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.getCase(Number(req.params.id))); } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await svc.createCase(req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.updateCase(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function saveFnF(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.saveFnF(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function complete(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.completeCase(Number(req.params.id))); } catch (err) { next(err); }
}

export async function toggleItem(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.toggleItem(Number(req.params.itemId), req.user!.userId)); } catch (err) { next(err); }
}

export async function addItem(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await svc.addItem(Number(req.params.id), req.body.category, req.body.item_name)); } catch (err) { next(err); }
}

export async function deleteItem(req: AuthRequest, res: Response, next: NextFunction) {
  try { await svc.deleteItem(Number(req.params.itemId)); res.json({ message: 'Item removed' }); } catch (err) { next(err); }
}
