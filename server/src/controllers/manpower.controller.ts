import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as svc from '../services/manpower.service';

// ─── Availability / scope helpers ───

export async function getAvailability(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const a = await svc.computeAvailability(Number(req.query.property_id), Number(req.query.job_title_id));
    res.json(a);
  } catch (err) { next(err); }
}

export async function listScopedProperties(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.listScopedProperties(req.user!)); } catch (err) { next(err); }
}

// ─── Sanctions ───

export async function listSanctions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listSanctions({
      property_id: req.query.property_id ? Number(req.query.property_id) : undefined,
      cluster_id: req.query.cluster_id ? Number(req.query.cluster_id) : undefined,
      job_title_id: req.query.job_title_id ? Number(req.query.job_title_id) : undefined,
    }, req.user!));
  } catch (err) { next(err); }
}

export async function upsertSanction(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.upsertSanction(req.body, req.user!)); } catch (err) { next(err); }
}

export async function setSanctionLock(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.setSanctionLock(Number(req.params.id), !!req.body.locked, req.user!)); } catch (err) { next(err); }
}

export async function upsertSanctionBand(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.upsertSanctionBand(Number(req.body.property_id), Number(req.body.job_title_id), req.body.band_min, req.body.band_max, req.user!)); } catch (err) { next(err); }
}

// ─── Property-level budgets ───

export async function listPropertyBudgets(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listPropertyBudgets({ cluster_id: req.query.cluster_id ? Number(req.query.cluster_id) : undefined }, req.user!));
  } catch (err) { next(err); }
}

export async function upsertPropertyBudget(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.upsertPropertyBudget(Number(req.params.id), req.body, req.user!)); } catch (err) { next(err); }
}

// ─── Admin property console ───

export async function getPropertyConsole(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.getPropertyConsole(Number(req.query.property_id))); } catch (err) { next(err); }
}

export async function setEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.setEmployeeSalary(Number(req.params.id), req.body.monthly_ctc, req.user!)); } catch (err) { next(err); }
}

// ─── Hires ───

export async function createHire(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await svc.createHire(req.body, req.user!)); } catch (err) { next(err); }
}

// ─── Employees / status ───

export async function listEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listEmployees({
      property_id: req.query.property_id ? Number(req.query.property_id) : undefined,
      job_title_id: req.query.job_title_id ? Number(req.query.job_title_id) : undefined,
      status: req.query.status as string,
      search: req.query.search as string,
    }, req.user!));
  } catch (err) { next(err); }
}

export async function changeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.changeStatus(Number(req.params.id), req.body.status, req.body, req.user!));
  } catch (err) { next(err); }
}

export async function getStatusHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.getStatusHistory(Number(req.params.id))); } catch (err) { next(err); }
}

// ─── Exceptions ───

export async function listExceptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listExceptions({
      status: req.query.status as string,
      mine: req.query.mine === 'true',
    }, req.user!));
  } catch (err) { next(err); }
}

export async function createException(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await svc.createException(req.body, req.user!)); } catch (err) { next(err); }
}

export async function approveException(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.approveException(Number(req.params.id), req.user!, req.body.admin_note)); } catch (err) { next(err); }
}

export async function rejectException(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.rejectException(Number(req.params.id), req.user!, req.body.admin_note)); } catch (err) { next(err); }
}

// ─── Clusters ───

export async function listClusters(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.listClusters()); } catch (err) { next(err); }
}

export async function upsertCluster(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.upsertCluster(req.body)); } catch (err) { next(err); }
}

export async function setPropertyCluster(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.setPropertyCluster(Number(req.params.id), req.body.cluster_id ?? null)); } catch (err) { next(err); }
}

export async function listClusterHrUsers(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.listClusterHrUsers()); } catch (err) { next(err); }
}

export async function getUserClusters(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.getUserClusters(Number(req.params.id))); } catch (err) { next(err); }
}

export async function setUserClusters(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await svc.setUserClusters(Number(req.params.id), req.body.cluster_ids || [])); } catch (err) { next(err); }
}
