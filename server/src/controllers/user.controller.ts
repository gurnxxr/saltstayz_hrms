import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as userService from '../services/user.service';

export async function listUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await userService.listUsers({
      search: req.query.search as string,
      role_id: req.query.role_id as string,
      is_active: req.query.is_active as string,
    }));
  } catch (err) { next(err); }
}

export async function getUser(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.getUser(Number(req.params.id))); } catch (err) { next(err); }
}

export async function createUser(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await userService.createUser(req.body)); } catch (err) { next(err); }
}

export async function updateUser(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.updateUser(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function resetPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.resetPassword(Number(req.params.id), req.body.password)); } catch (err) { next(err); }
}

export async function deleteUser(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.deleteUser(Number(req.params.id))); } catch (err) { next(err); }
}

export async function getRoles(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.getRoles()); } catch (err) { next(err); }
}

export async function getUnlinkedEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.getUnlinkedEmployees()); } catch (err) { next(err); }
}

export async function listCredentials(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.listCredentials()); } catch (err) { next(err); }
}

export async function getAccessMatrix(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await userService.getAccessMatrix()); } catch (err) { next(err); }
}
