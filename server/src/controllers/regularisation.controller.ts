import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/regularisation.service';
import * as settingsService from '../services/regularisationSettings.service';
import { businessToday } from '../utils/businessDate';

/**
 * The guardrails, plus the date the server will judge a request against.
 *
 * `today` rides along because the client cannot work it out. The deadline is compared against the
 * BUSINESS date (see requestRegularisation), and a browser computing its own — whether from UTC or
 * from wherever the employee happens to be sitting — can disagree by a day. That disagreement is
 * not cosmetic here: the request form uses this to bound its date picker, so a client a day behind
 * offers dates the server then refuses, and the employee gets a rejection for a day the form
 * itself suggested.
 *
 * Sending it costs nothing and removes the second clock entirely. It also means the business
 * timezone stays a server concern; nothing on the client has to know what it is.
 */
export async function getSettings(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ ...(await settingsService.getRegularisationSettings()), today: businessToday() });
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
