import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as shiftService from '../services/shift.service';

// ─── Employee self-service: my shift + request a change ───

export async function getMyShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getMyShift(req.user!.employeeId));
  } catch (err) { next(err); }
}

export async function listMyShiftChangeRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getMyShiftChangeRequests(req.user!.userId));
  } catch (err) { next(err); }
}

export async function createMyShiftChangeRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.createMyShiftChangeRequest(
      req.user!.userId,
      req.user!.employeeId,
      Number(req.body.shift_type_id),
      req.body.reason,
    ));
  } catch (err) { next(err); }
}

// ─── Shift Types ───

export async function listShiftTypes(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listShiftTypes());
  } catch (err) { next(err); }
}

export async function getShiftType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getShiftType(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function createShiftType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.createShiftType(req.body));
  } catch (err) { next(err); }
}

export async function updateShiftType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.updateShiftType(Number(req.params.id), req.body));
  } catch (err) { next(err); }
}

export async function deleteShiftType(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.deleteShiftType(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function listHolidayLists(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listHolidayLists());
  } catch (err) { next(err); }
}

// ─── Shift Locations ───

export async function listShiftLocations(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listShiftLocations());
  } catch (err) { next(err); }
}

export async function createShiftLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.createShiftLocation(req.body));
  } catch (err) { next(err); }
}

export async function updateShiftLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.updateShiftLocation(Number(req.params.id), req.body));
  } catch (err) { next(err); }
}

export async function deleteShiftLocation(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.deleteShiftLocation(Number(req.params.id)));
  } catch (err) { next(err); }
}

// ─── Shift Schedules ───

export async function listShiftSchedules(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const shiftTypeId = req.query.shift_type_id ? Number(req.query.shift_type_id) : undefined;
    res.json(await shiftService.listShiftSchedules(shiftTypeId));
  } catch (err) { next(err); }
}

export async function getShiftSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getShiftSchedule(Number(req.params.id)));
  } catch (err) { next(err); }
}

export async function createShiftSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.createShiftSchedule(req.body));
  } catch (err) { next(err); }
}

export async function updateShiftSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.updateShiftSchedule(Number(req.params.id), req.body));
  } catch (err) { next(err); }
}

export async function deleteShiftSchedule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.deleteShiftSchedule(Number(req.params.id)));
  } catch (err) { next(err); }
}

// ─── Roster ───

export async function getWeeklyRoster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { property_id, week_start, week_end } = req.query;
    if (!property_id || !week_start || !week_end) {
      return res.status(400).json({ error: 'property_id, week_start, week_end are required' });
    }
    res.json(await shiftService.getWeeklyRoster(
      Number(property_id),
      week_start as string,
      week_end as string
    ));
  } catch (err) { next(err); }
}

export async function getPropertyEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getPropertyEmployees(Number(req.params.propertyId)));
  } catch (err) { next(err); }
}

export async function assignShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.assignShift({
      ...req.body,
      assigned_by: req.user!.userId,
    }));
  } catch (err) { next(err); }
}

export async function bulkAssignShifts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const assignments = req.body.assignments.map((a: any) => ({
      ...a,
      assigned_by: req.user!.userId,
    }));
    res.status(201).json(await shiftService.bulkAssignShifts(assignments));
  } catch (err) { next(err); }
}

export async function removeShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await shiftService.removeShift(Number(req.params.id));
    res.json({ message: 'Shift removed' });
  } catch (err) { next(err); }
}

// ─── Per-employee shift assignment ───

export async function listEmployeeShifts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listEmployeeShifts(req.query.q as string));
  } catch (err) { next(err); }
}

export async function assignEmployeeShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.assignEmployeeShift(
      Number(req.params.employeeId), Number(req.body.shift_type_id), req.user?.userId ?? null,
    ));
  } catch (err) { next(err); }
}

export async function removeEmployeeShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.removeEmployeeShift(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}

// ─── Change Requests ───

export async function listChangeRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listChangeRequests({
      status: req.query.status as string,
      property_id: req.query.property_id ? Number(req.query.property_id) : undefined,
    }));
  } catch (err) { next(err); }
}

export async function createChangeRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.createChangeRequest({
      ...req.body,
      requested_by: req.user!.userId,
    }));
  } catch (err) { next(err); }
}

export async function approveChangeRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { approved } = req.body;
    res.json(await shiftService.approveChangeRequest(
      Number(req.params.id),
      req.user!.userId,
      approved
    ));
  } catch (err) { next(err); }
}
