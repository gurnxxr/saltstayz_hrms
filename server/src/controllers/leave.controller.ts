import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { ValidationError } from '../utils/errors';
import * as leaveService from '../services/leave.service';
import * as encashmentService from '../services/leaveEncashment.service';
import * as templateService from '../services/leaveTemplate.service';

/**
 * The signed-in user's own employee record, or a 400.
 *
 * Admin and finance logins are not always linked to an employee, and passing that null through
 * to a self-service query matches no rows — which used to look like an empty result rather than
 * a missing profile. Mirrors `requireEmployeeId` in payroll.controller.ts.
 */
function requireEmployeeId(req: AuthRequest): number {
  if (!req.user?.employeeId) {
    throw new ValidationError('No employee profile is linked to this account.');
  }
  return req.user.employeeId;
}

// ─── Leave Templates (Control Panel → Templates / By Employee) ───
export async function listLeaveTemplates(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.listTemplates()); } catch (err) { next(err); }
}
export async function getLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.getTemplate(Number(req.params.id))); } catch (err) { next(err); }
}
export async function createLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await templateService.createTemplate(req.body)); } catch (err) { next(err); }
}
export async function updateLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.updateTemplate(Number(req.params.id), req.body)); } catch (err) { next(err); }
}
export async function deleteLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.deleteTemplate(Number(req.params.id))); } catch (err) { next(err); }
}
export async function listLeaveTemplateAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.listTemplateAssignments({ search: req.query.search ? String(req.query.search) : undefined })); } catch (err) { next(err); }
}
export async function listLeaveTemplateDepartments(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.listDepartmentCoverage()); } catch (err) { next(err); }
}
export async function setEmployeeLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.setEmployeeTemplate(Number(req.params.employeeId), Number(req.body.template_id))); } catch (err) { next(err); }
}
export async function bulkAssignLeaveTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await templateService.bulkAssignTemplate(req.body.employee_ids, Number(req.body.template_id))); } catch (err) { next(err); }
}

// Scoped to the caller: types their department can't take are hidden from the
// apply screen's dropdown. Users without an employee record see the full list.
export async function getLeaveTypes(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getLeaveTypes(req.user!.employeeId ?? undefined)); } catch (err) { next(err); }
}

export async function getLeavePeriods(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getLeavePeriods()); } catch (err) { next(err); }
}

export async function getMyBalances(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getMyBalances(req.user!.employeeId!)); } catch (err) { next(err); }
}

export async function getBalancesOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getBalancesOverview({
      period_id: req.query.period_id ? Number(req.query.period_id) : undefined,
      search: req.query.search as string,
      branch: req.query.branch as string,
      dept: req.query.dept as string,
    }));
  } catch (err) { next(err); }
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

// ─── Leaves module (admin): apply on behalf ───

export async function applyLeaveFor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await leaveService.applyLeave(Number(req.params.employeeId), req.body));
  } catch (err) { next(err); }
}

// ─── Leaves module (admin): types & periods (Control Panel) ───

export async function getAllLeaveTypes(_req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.getAllLeaveTypes()); } catch (err) { next(err); }
}

export async function createLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await leaveService.createLeaveType(req.body)); } catch (err) { next(err); }
}

export async function updateLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.updateLeaveType(Number(req.params.id), req.body)); } catch (err) { next(err); }
}

export async function deleteLeaveType(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.deleteLeaveType(Number(req.params.id))); } catch (err) { next(err); }
}

export async function createLeavePeriod(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await leaveService.createLeavePeriod(req.body)); } catch (err) { next(err); }
}

export async function setCurrentPeriod(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.setCurrentPeriod(Number(req.params.id))); } catch (err) { next(err); }
}

// ─── Leaves module (admin): entitlements (Allocation) ───

export async function getEntitlements(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getEntitlements({
      period_id: Number(req.query.period_id),
      search: req.query.search as string,
      branch: req.query.branch as string,
    }));
  } catch (err) { next(err); }
}

export async function upsertEntitlement(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.upsertEntitlement(req.body)); } catch (err) { next(err); }
}

export async function bulkAllocate(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await leaveService.bulkAllocate(req.body)); } catch (err) { next(err); }
}

// ─── Leaves module (admin): encashments ───

export async function listEncashments(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await encashmentService.listEncashments({ status: req.query.status as string })); } catch (err) { next(err); }
}

export async function createEncashment(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await encashmentService.createEncashment(req.body, req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function approveEncashment(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json(await encashmentService.approveEncashment(Number(req.params.id), req.user?.userId ?? null)); } catch (err) { next(err); }
}

export async function rejectEncashment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await encashmentService.rejectEncashment(
      Number(req.params.id), req.user?.userId ?? null, req.body?.rejection_reason,
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
      state: req.query.state as string,
      scope: req.query.scope as string,
      year: req.query.year as string,
    }));
  } catch (err) { next(err); }
}

export async function getMyHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await leaveService.getMyHolidays(requireEmployeeId(req), req.query.year as string));
  } catch (err) { next(err); }
}

export async function createHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.status(201).json(await leaveService.createHoliday(req.body)); } catch (err) { next(err); }
}

/** How many active employees a SAVED holiday reaches. */
export async function getHolidayReach(req: AuthRequest, res: Response, next: NextFunction) {
  try { res.json({ reaches_count: await leaveService.getHolidayReach(Number(req.params.id)) }); }
  catch (err) { next(err); }
}

/** How many a scope WOULD reach — so the form can warn before anything is saved. */
export async function previewHolidayReach(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({
      reaches_count: await leaveService.countHolidayReach({
        is_national: !!req.body.is_national,
        state: req.body.state ?? null,
        all_departments: !!req.body.all_departments,
        department_ids: Array.isArray(req.body.department_ids) ? req.body.department_ids.map(Number) : [],
        all_properties: !!req.body.all_properties,
        property_ids: Array.isArray(req.body.property_ids) ? req.body.property_ids.map(Number) : [],
      }),
    });
  } catch (err) { next(err); }
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
    // Multipart carries everything as strings, so the id arrays arrive JSON-encoded.
    const idList = (raw: unknown): number[] => {
      if (Array.isArray(raw)) return raw.map(Number);
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(Number) : [];
        } catch { return []; }
      }
      return [];
    };
    const isTrue = (v: unknown) => v === 'true' || v === true;
    const result = await leaveService.uploadHolidaysCSV(csvText, {
      is_national: isTrue(req.body.is_national),
      state: req.body.state ? String(req.body.state) : undefined,
      all_departments: isTrue(req.body.all_departments),
      department_ids: idList(req.body.department_ids),
      all_properties: isTrue(req.body.all_properties),
      property_ids: idList(req.body.property_ids),
      mode: req.body.mode === 'replace' ? 'replace' : 'append',
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
