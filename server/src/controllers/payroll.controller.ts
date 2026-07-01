import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as payslip from '../services/payslip.service';
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
    res.json(await payslip.getSalarySetup(requireEmployeeId(req)) ?? null);
  } catch (err) { next(err); }
}

export async function computeMyPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    res.json(await payslip.computeForEmployee(
      employeeId, Number(req.query.month), Number(req.query.year),
    ));
  } catch (err) { next(err); }
}

export async function generateMyPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    const result = await payslip.generatePayslip(
      employeeId, Number(req.body.month), Number(req.body.year), req.user?.userId ?? null,
    );
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function downloadMyPayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = requireEmployeeId(req);
    const computed = await payslip.computeForEmployee(
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
    const computed = await payslip.getPayslipSnapshot(Number(req.params.id), employeeId);
    await sendPdf(res, computed);
  } catch (err) { next(err); }
}

// ─── HR / Finance / Admin ───

export async function listSalarySetups(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.listSalarySetups());
  } catch (err) { next(err); }
}

export async function getSalarySetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.getSalarySetup(Number(req.params.employeeId)) ?? null);
  } catch (err) { next(err); }
}

export async function upsertSalarySetup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.upsertSalarySetup(Number(req.params.employeeId), req.body));
  } catch (err) { next(err); }
}

export async function computeEmployeePayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.computeForEmployee(
      Number(req.params.employeeId), Number(req.query.month), Number(req.query.year),
    ));
  } catch (err) { next(err); }
}

export async function downloadEmployeePayslip(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const computed = await payslip.computeForEmployee(
      Number(req.params.employeeId), Number(req.query.month), Number(req.query.year),
    );
    await sendPdf(res, computed);
  } catch (err) { next(err); }
}

// ─── Payroll runs (bulk + lock) ───

export async function listRuns(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.listRuns());
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
      Number(req.body.month), Number(req.body.year), req.user?.userId ?? null,
    ));
  } catch (err) { next(err); }
}

export async function unlockRun(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await payslip.unlockRun(Number(req.body.month), Number(req.body.year)));
  } catch (err) { next(err); }
}
