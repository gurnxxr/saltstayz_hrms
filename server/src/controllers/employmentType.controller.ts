import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as service from '../services/employmentType.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listEmploymentTypes()); } catch (err) { next(err); }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getEmploymentType(Number(req.params.id))); } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.createEmploymentType(req.body)); } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.updateEmploymentType(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.deleteEmploymentType(Number(req.params.id))); } catch (err) { next(err); }
}

export async function exportCsv(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const csv = await service.exportEmploymentTypesCsv();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Employment_Types_${stamp}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
}

export async function importCsv(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json(await service.importEmploymentTypesCsv(req.file.buffer.toString('utf-8')));
  } catch (err) { next(err); }
}
