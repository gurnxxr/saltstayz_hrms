import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as shiftService from '../services/shift.service';

// ─── Employee self-service: my current shift (shown on the dashboard) ───

export async function getMyShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getMyShift(req.user!.employeeId));
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

export async function saveRoster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.saveRosterCells(Number(req.body.property_id), req.body.cells, req.user!.userId));
  } catch (err) { next(err); }
}

export async function copyPreviousWeek(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { property_id, week_start, week_end } = req.body;
    res.json(await shiftService.copyPreviousWeek(Number(property_id), week_start, week_end, req.user!.userId));
  } catch (err) { next(err); }
}

export async function publishRoster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { property_id, week_start, week_end } = req.body;
    res.json(await shiftService.publishRoster(Number(property_id), week_start, week_end, req.user!.userId));
  } catch (err) { next(err); }
}

export async function unpublishRoster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { property_id, week_start, week_end } = req.body;
    res.json(await shiftService.unpublishRoster(Number(property_id), week_start, week_end));
  } catch (err) { next(err); }
}

