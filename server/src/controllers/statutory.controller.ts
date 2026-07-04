import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/statutory.service';

export async function getStatutory(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getAllStatutory()); } catch (err) { next(err); }
}

/** Resolved EPF/ESI/LWF rates for a city/state — used by salary previews. */
export async function getRates(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getStatutoryRates(req.query.city ? String(req.query.city) : null)); } catch (err) { next(err); }
}

export async function saveEpf(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.saveEpf(req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function saveEsi(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.saveEsi(req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function saveBonus(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.saveBonus(req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function savePt(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.savePtState(String(req.params.state), req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function saveLwf(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.saveLwf(String(req.params.state), req.body, req.user!.userId)); } catch (err) { next(err); }
}

export async function addMinimumWage(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.addMinimumWage(req.body, req.user!.userId)); } catch (err) { next(err); }
}
