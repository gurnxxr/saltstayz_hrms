import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as payslip from '../services/payslip.service';
import * as structures from '../services/salaryStructure.service';
import { computePayableDays } from '../services/payableDays.service';
import { generatePayslipPdf } from '../services/payslipPdf.service';
import { ValidationError } from '../utils/errors';
import type { ComputedPayslip } from '../services/payslip.service';

function requireEmployeeId(req: AuthRequest): number {
  if (!req.user?.employeeId) {
    throw new ValidationError('No employee profile linked to this account');
  }
  return req.user.employeeId;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function sendPdf(res: Response, computed: ComputedPayslip & { id?: number }) {
  const buffer = await generatePayslipPdf({
    employeeName: computed.employee.name,
    employeeCode: computed.employee.employee_code,
    designation: computed.employee.designation,
    department: computed.employee.department,
    branch: computed.employee.branch,
    monthLabel: computed.monthLabel,
    payDate: fmtDate(computed.payDate),
    breakdown: computed.breakdown,
  });
  const safeName = computed.employee.name.replace(/\s+/g, '_');
  const filename = `Payslip_${safeName}_${computed.monthLabel.replace(/\s+/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

// ─── Self-service (current user) ───

export async function getMySetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.getAssignment(requireEmployeeId(req)) ?? null);
  } catch (err) { next(err); }
}

/** Employee's own salary structure — component lines, base, breakdown, CTC (read-only). */
export async function getMyStructure(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.getEmployeeStructure(requireEmployeeId(req)));
  } catch (err) { next(err); }
}

export async function computeMyPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    // Self-service is read-only and only serves a LOCKED (published) month's snapshot.
    res.json(await payslip.getSelfServicePayslip(
      employeeId, Number(req.query.month), Number(req.query.year),
    ));
  } catch (err) { next(err); }
}

export async function downloadMyPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    const computed = await payslip.getSelfServicePayslip(
      employeeId, Number(req.query.month), Number(req.query.year),
    );
    await sendPdf(res, computed);
  } catch (err) { next(err); }
}

export async function listMyHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.listPayslipHistory(requireEmployeeId(req)));
  } catch (err) { next(err); }
}

export async function downloadMyHistoryPdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    // requireLocked: employees can only download a published (locked) month.
    const computed = await payslip.getPayslipSnapshot(Number(req.params.id), employeeId, true);
    await sendPdf(res, computed);
  } catch (err) { next(err); }
}

// ─── HR / Finance / Admin: structure assignments ───

export async function listAssignments(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.listAssignments());
  } catch (err) { next(err); }
}

export async function getAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.getAssignment(Number(req.params.employeeId)) ?? null);
  } catch (err) { next(err); }
}

export async function upsertAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.upsertAssignment(Number(req.params.employeeId), req.body, req.user?.userId ?? null));
  } catch (err) { next(err); }
}

export async function removeAssignment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await structures.removeAssignment(Number(req.params.employeeId)));
  } catch (err) { next(err); }
}

export async function computeEmployeePayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Locked month → byte-identical stored snapshot; draft → live compute.
    res.json(await payslip.getPayslipForStaff(
      Number(req.params.employeeId), Number(req.query.month), Number(req.query.year),
    ));
  } catch (err) { next(err); }
}

export async function downloadEmployeePayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const computed = await payslip.getPayslipForStaff(
      Number(req.params.employeeId), Number(req.query.month), Number(req.query.year),
    );
    await sendPdf(res, computed);
  } catch (err) { next(err); }
}

/** Day-by-day payable-days trace for the review dialog. */
export async function getPayableDays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await computePayableDays(
      Number(req.params.employeeId), Number(req.query.month), Number(req.query.year),
    ));
  } catch (err) { next(err); }
}

// ─── Payroll runs (bulk + review + lock) ───

export async function listRuns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.listRuns());
  } catch (err) { next(err); }
}

export async function getRunDetails(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.getRunDetails(Number(req.query.month), Number(req.query.year)));
  } catch (err) { next(err); }
}

export async function upsertAdjustment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.upsertAdjustment(
      Number(req.params.employeeId), Number(req.body.month), Number(req.body.year),
      req.body, req.user?.userId ?? null,
    ));
  } catch (err) { next(err); }
}

export async function exportRegister(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    const csv = await payslip.getSalaryRegister(month, year);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Salary_Register_${year}_${String(month).padStart(2, '0')}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
}

export async function runPayroll(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await payslip.runPayroll(
      Number(req.body.month), Number(req.body.year), req.user?.userId ?? null,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function lockRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.lockRun(
      Number(req.body.month), Number(req.body.year), req.user?.userId ?? null, req.body.confirm === true,
    ));
  } catch (err) { next(err); }
}

export async function unlockRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.unlockRun(
      Number(req.body.month), Number(req.body.year), req.user?.userId ?? null, req.body.reason,
    ));
  } catch (err) { next(err); }
}
