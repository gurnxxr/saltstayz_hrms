import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { ApiKeyRequest } from '../middleware/apikey';
import * as bioService from '../services/biometric.service';

// ─── External endpoints (API key auth) ───

export const receivePunch = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.receivePunch(req.body);
    res.status(201).json(result);
  } catch (e) { next(e); }
};

export const receivePunchBatch = async (req: ApiKeyRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.receivePunchBatch(req.body.logs || req.body);
    res.json(result);
  } catch (e) { next(e); }
};

// ─── Internal endpoints (JWT auth) ───

export const processLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.processLogs(req.query.date as string);
    res.json(result);
  } catch (e) { next(e); }
};

export const getLogs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.getLogs({
      date: req.query.date as string,
      employee_code: req.query.employee_code as string,
      status: req.query.status as string,
      device_sn: req.query.device_sn as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json(result);
  } catch (e) { next(e); }
};

export const getLogStats = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.getLogStats(req.query.date as string);
    res.json(result);
  } catch (e) { next(e); }
};

export const listDevices = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await bioService.listDevices());
  } catch (e) { next(e); }
};

// ─── API Key management (admin only) ───

export const createApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await bioService.createApiKey(req.body.name);
    res.status(201).json(result);
  } catch (e) { next(e); }
};

export const listApiKeys = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await bioService.listApiKeys());
  } catch (e) { next(e); }
};

export const revokeApiKey = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await bioService.revokeApiKey(Number(req.params.id));
    res.json({ message: 'API key revoked' });
  } catch (e) { next(e); }
};
