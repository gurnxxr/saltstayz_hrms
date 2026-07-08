import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import db from '../config/database';
import * as service from '../services/salaryStructure.service';

export async function list(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listStructures()); } catch (err) { next(err); }
}

export async function get(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getStructure(Number(req.params.id))); } catch (err) { next(err); }
}

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await service.createStructure(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.updateStructure(Number(req.params.id), req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.deleteStructure(Number(req.params.id))); } catch (err) { next(err); }
}

/** Live preview of a draft structure (unsaved lines) at a base. */
export async function preview(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.previewStructure(req.body)); } catch (err) { next(err); }
}

// ─── Per-employee salary structures ───

export async function listEmployeeSalary(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.listEmployeeSalary()); } catch (err) { next(err); }
}

export async function getCtcRegister(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getCtcRegister()); } catch (err) { next(err); }
}

export async function getEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.getEmployeeStructure(Number(req.params.employeeId))); } catch (err) { next(err); }
}

export async function saveEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await service.saveEmployeeStructure(Number(req.params.employeeId), req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function resetEmployeeSalary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await service.seedEmployeeStructureFromTemplate(Number(req.params.employeeId), req.body ?? {}, req.user?.userId ?? null));
  } catch (err) { next(err); }
}

/** Active catalog components for the structure builder's component picker. */
export async function componentOptions(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const rows = await db('salary_components')
      .where('status', 'active')
      .select('id', 'category', 'name', 'name_in_payslip')
      .orderBy(['category', 'sort_order']);
    res.json(rows);
  } catch (err) { next(err); }
}
