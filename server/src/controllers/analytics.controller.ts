import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as analyticsService from '../services/analytics.service';

export async function getDashboardOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getDashboardOverview());
  } catch (err) { next(err); }
}

// ─── Personal analytics (logged-in employee's own data) ───

export async function getMyOverview(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Express turns a repeated key into an ARRAY — `?month=a&month=b` arrives as ['a','b'], which
    // String() would flatten to "a,b" and the validator would reject with a confusing message.
    // Anything that is not a single string is simply absent, and the service defaults to now.
    // Validating there rather than here keeps the guard travelling with the function.
    const month = typeof req.query.month === 'string' ? req.query.month : undefined;
    res.json(await analyticsService.getMyOverview(req.user!.employeeId ?? null, month));
  } catch (err) { next(err); }
}

export async function getMyTrends(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const months = req.query.months ? Number(req.query.months) : 6;
    res.json(await analyticsService.getMyTrends(req.user!.employeeId ?? null, months));
  } catch (err) { next(err); }
}

export async function getHeadcount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getHeadcountSummary());
  } catch (err) { next(err); }
}

export async function getAttendance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    const today = new Date();
    const dateFrom = (from as string) || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const dateTo = (to as string) || today.toISOString().split('T')[0];
    res.json(await analyticsService.getAttendanceSummary(dateFrom, dateTo));
  } catch (err) { next(err); }
}

export async function getLeaves(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    const today = new Date();
    const dateFrom = (from as string) || new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
    const dateTo = (to as string) || today.toISOString().split('T')[0];
    res.json(await analyticsService.getLeaveSummary(dateFrom, dateTo));
  } catch (err) { next(err); }
}

export async function getRecruitment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getRecruitmentSummary());
  } catch (err) { next(err); }
}

export async function getAttrition(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    const today = new Date();
    const dateFrom = (from as string) || new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
    const dateTo = (to as string) || today.toISOString().split('T')[0];
    res.json(await analyticsService.getAttritionSummary(dateFrom, dateTo));
  } catch (err) { next(err); }
}

// ─── New v2 endpoints ───

export async function getKpiStrip(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getKpiStrip());
  } catch (err) { next(err); }
}

export async function getWorkforceOverview(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getWorkforceOverview());
  } catch (err) { next(err); }
}

export async function getAttritionAnalysis(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    const today = new Date();
    const dateFrom = (from as string) || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const dateTo = (to as string) || today.toISOString().split('T')[0];
    res.json(await analyticsService.getAttritionAnalysis(dateFrom, dateTo));
  } catch (err) { next(err); }
}

export async function getAttendanceProductivity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;
    const today = new Date();
    const dateFrom = (from as string) || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const dateTo = (to as string) || today.toISOString().split('T')[0];
    res.json(await analyticsService.getAttendanceProductivity(dateFrom, dateTo));
  } catch (err) { next(err); }
}

export async function getPropertyEmployeeStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { tab, date, property, department, page } = req.query;
    const today = new Date().toISOString().split('T')[0];
    res.json(await analyticsService.getPropertyEmployeeStatus(
      (tab as string) || 'present',
      (date as string) || today,
      property as string | undefined,
      department as string | undefined,
      Number(page) || 1,
    ));
  } catch (err) { next(err); }
}

export async function getPropertyAnalytics(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await analyticsService.getPropertyAnalytics(req.query.date as string | undefined));
  } catch (err) { next(err); }
}

export async function getDrilldown(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { type, filter, from, to } = req.query;
    if (!type || !filter) return res.status(400).json({ error: 'type and filter are required' });
    res.json(await analyticsService.getDrilldown(
      type as string,
      filter as string,
      from as string | undefined,
      to as string | undefined,
    ));
  } catch (err) { next(err); }
}
