import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as leaveService from '../services/leave.service';

export async function getLeaveTypes(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getLeaveTypes()); } catch (err) { next(err); }
}

export async function getLeavePeriods(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getLeavePeriods()); } catch (err) { next(err); }
}

export async function getMyBalances(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getMyBalances(req.user!.employeeId!)); } catch (err) { next(err); }
}

export async function getMyLeaves(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getMyLeaves(req.user!.employeeId!, {
      status: req.query.status as string,
      leave_type_id: req.query.leave_type_id as string,
    }));
  } catch (err) { next(err); }
}

export async function applyLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await leaveService.applyLeave(req.user!.employeeId!, req.body));
  } catch (err) { next(err); }
}

export async function cancelLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.cancelLeave(Number(req.params.id), req.user!.employeeId!));
  } catch (err) { next(err); }
}

export async function getPendingApprovals(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getPendingApprovals(req.user!.employeeId!, req.user!.roleName));
  } catch (err) { next(err); }
}

export async function getAllLeaves(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getAllLeaves({
      status: req.query.status as string,
      employee_id: req.query.employee_id as string,
      branch_name: req.query.branch_name as string,
    }));
  } catch (err) { next(err); }
}

export async function approveLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.approveLeave(Number(req.params.id), req.user!.employeeId!, req.user!.roleName));
  } catch (err) { next(err); }
}

export async function rejectLeave(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.rejectLeave(
      Number(req.params.id), req.user!.employeeId!, req.user!.roleName, req.body.rejection_reason
    ));
  } catch (err) { next(err); }
}

// ─── Regions ───

export async function listRegions(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.listRegions()); } catch (err) { next(err); }
}

export async function createRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await leaveService.createRegion(req.body)); } catch (err) { next(err); }
}

export async function updateRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.updateRegion(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function deleteRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.deleteRegion(Number(req.params.id))); } catch (err) { next(err); }
}

export async function listPropertiesWithRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.listPropertiesWithRegion()); } catch (err) { next(err); }
}

export async function setPropertyRegion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const regionId = req.body.region_id != null && req.body.region_id !== '' ? Number(req.body.region_id) : null;
    res.json(await leaveService.setPropertyRegion(Number(req.params.id), regionId));
  } catch (err) { next(err); }
}

// ─── Holidays ───

export async function getHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getHolidays({
      region_id: req.query.region_id as string,
      scope: req.query.scope as string,
      year: req.query.year as string,
    }));
  } catch (err) { next(err); }
}

export async function getMyHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getMyHolidays(req.user!.employeeId!, req.query.year as string)); } catch (err) { next(err); }
}

export async function createHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await leaveService.createHoliday(req.body)); } catch (err) { next(err); }
}

export async function updateHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.updateHoliday(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function uploadHolidaysCSV(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }
    const csvText = req.file.buffer.toString('utf-8');
    const result = await leaveService.uploadHolidaysCSV(csvText, {
      is_national: req.body.is_national === 'true' || req.body.is_national === true,
      region_id: req.body.region_id != null && req.body.region_id !== '' ? Number(req.body.region_id) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await leaveService.deleteHoliday(Number(req.params.id));
    res.json({ message: 'Holiday deleted' });
  } catch (err) { next(err); }
}
