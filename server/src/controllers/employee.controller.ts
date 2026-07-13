import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as employeeService from '../services/employee.service';

export async function listEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await employeeService.listEmployees({
      search: req.query.search as string,
      status: req.query.status as string,
      branch: req.query.branch as string,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    }));
  } catch (err) { next(err); }
}

export async function getEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await employeeService.getEmployee(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function getMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.employeeId) {
      return res.status(400).json({ error: 'No employee profile linked to this account' });
    }
    res.json(await employeeService.getEmployee(req.user.employeeId));
  } catch (err) { next(err); }
}

export async function createEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await employeeService.createEmployee(req.body));
  } catch (err) { next(err); }
}

export async function updateEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await employeeService.updateEmployee(Number(req.params.id), req.body));
  } catch (err) { next(err); }
}

export async function bulkUploadEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  const fileName = req.file?.originalname || null;
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const csv = req.file.buffer.toString('utf-8');
    const result = await employeeService.bulkUploadEmployees(csv);

    await employeeService.logEmployeeUpload({
      uploaded_by: req.user?.userId ?? null,
      uploaded_by_email: req.user?.email ?? null,
      file_name: fileName,
      rows_total: result.total,
      rows_created: result.created,
      rows_updated: result.updated,
      rows_skipped: result.skipped,
      errors: result.errors,
      status: result.skipped > 0 ? 'partial' : 'success',
    });

    res.json(result);
  } catch (err: any) {
    // Record the failed attempt so it shows in history, then surface the error.
    await employeeService.logEmployeeUpload({
      uploaded_by: req.user?.userId ?? null,
      uploaded_by_email: req.user?.email ?? null,
      file_name: fileName,
      rows_total: 0, rows_created: 0, rows_updated: 0, rows_skipped: 0,
      status: 'failed', error_note: err?.message?.slice(0, 500) || 'Upload failed',
    });
    next(err);
  }
}

export async function getEmployeeUploadLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await employeeService.listEmployeeUploadLogs(limit));
  } catch (err) { next(err); }
}

export async function updateMyProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user?.employeeId) {
      return res.status(400).json({ error: 'No employee profile linked to this account' });
    }
    res.json(await employeeService.updateMyProfile(req.user.employeeId, req.body));
  } catch (err) { next(err); }
}

export async function deleteEmployee(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await employeeService.deleteEmployee(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function getManagers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await employeeService.getManagers());
  } catch (err) { next(err); }
}
