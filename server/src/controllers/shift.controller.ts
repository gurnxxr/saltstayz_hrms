import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as shiftService from '../services/shift.service';
import * as changeReq from '../services/shiftChangeRequest.service';

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
    const { property_id, week_start, week_end, employee_ids } = req.body;
    const scope = Array.isArray(employee_ids) && employee_ids.length ? employee_ids.map(Number) : undefined;
    res.json(await shiftService.copyPreviousWeek(Number(property_id), week_start, week_end, req.user!.userId, scope));
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

// ─── Employee self-service: my roster + shift-change requests ───

export async function getMyRoster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const [upcoming, shift_types] = await Promise.all([
      changeReq.getMyUpcomingShifts(req.user!.employeeId),
      changeReq.listActiveShiftTypes(),
    ]);
    res.json({ upcoming, shift_types });
  } catch (err) { next(err); }
}

export async function listMyChangeRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.employeeId) return res.json([]);
    res.json(await changeReq.listMyChangeRequests(req.user!.employeeId));
  } catch (err) { next(err); }
}

export async function createMyChangeRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    res.status(201).json(await changeReq.createChangeRequest(req.user!.employeeId, req.body));
  } catch (err) { next(err); }
}

// ─── Manager / HR: review shift-change requests ───

export async function listChangeRequests(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'pending';
    res.json(await changeReq.listChangeRequestsForApprover(req.user!.employeeId, req.user!.roleName, status));
  } catch (err) { next(err); }
}

export async function decideChangeRequest(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const approve = req.body.approve === true || req.body.decision === 'approve';
    res.json(await changeReq.decideChangeRequest(
      Number(req.params.id),
      { employeeId: req.user!.employeeId, userId: req.user!.userId, roleName: req.user!.roleName },
      approve,
      req.body.note,
    ));
  } catch (err) { next(err); }
}

