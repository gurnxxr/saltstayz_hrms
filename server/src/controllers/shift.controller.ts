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

// ─── Employee → shift mapping ───

export async function listShiftAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.listShiftAssignments({
      search: req.query.search ? String(req.query.search) : undefined,
      property: req.query.property ? String(req.query.property) : undefined,
      unassigned: req.query.unassigned === 'true',
    }));
  } catch (err) { next(err); }
}

export async function getEmployeeShiftHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.getEmployeeShiftHistory(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}

export async function assignShift(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await shiftService.assignShift(req.body, req.user!.userId));
  } catch (err) { next(err); }
}

export async function removeShiftAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await shiftService.removeShiftAssignment(Number(req.params.id)));
  } catch (err) { next(err); }
}

// ─── Employee self-service: my shift + change requests ───

export async function getMyShiftOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.employeeId) return res.status(400).json({ error: 'No employee profile linked to this account' });
    const [overview, shift_types] = await Promise.all([
      changeReq.getMyShiftOverview(req.user!.employeeId),
      changeReq.listActiveShiftTypes(),
    ]);
    res.json({ ...overview, shift_types });
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

