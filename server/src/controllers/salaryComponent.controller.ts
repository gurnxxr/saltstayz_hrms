import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/salaryComponent.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listSalaryComponents()); } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.createSalaryComponent(req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.updateSalaryComponent(Number(req.params.id), req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function setStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.setSalaryComponentStatus(Number(req.params.id), req.body.status, req.user!.userId)); } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.deleteSalaryComponent(Number(req.params.id))); } catch (err) { next(err); }
}
