import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/regularisation.service';
import * as settingsService from '../services/regularisationSettings.service';

export async function getSettings(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await settingsService.getRegularisationSettings());
  } catch (err) { next(err); }
}

export async function updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await settingsService.updateRegularisationSettings(req.body, req.user!.userId));
  } catch (err) { next(err); }
}

export async function requestRegularisation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await service.requestRegularisation(req.user!.employeeId!, req.body));
  } catch (err) { next(err); }
}

export async function getMyRegularisations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.getMyRegularisations(req.user!.employeeId!));
  } catch (err) { next(err); }
}

export async function getPendingRegularisations(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.getPendingRegularisations(req.user!.employeeId!, req.user!.roleName));
  } catch (err) { next(err); }
}

export async function getRegularisationLog(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.getRegularisationLog(req.user!.employeeId!, req.user!.roleName));
  } catch (err) { next(err); }
}

export async function approveRegularisation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.approveRegularisation(Number(req.params.id), req.user!.employeeId!, req.user!.roleName));
  } catch (err) { next(err); }
}

export async function rejectRegularisation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.rejectRegularisation(
      Number(req.params.id), req.user!.employeeId!, req.user!.roleName, req.body?.reviewer_comment,
    ));
  } catch (err) { next(err); }
}
