import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as attendanceService from '../services/attendance.service';

export async function getMyCalendar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    res.json(await attendanceService.getMyCalendar(req.user!.employeeId!, month));
  } catch (err) { next(err); }
}

export async function getMonthSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    res.json(await attendanceService.getMonthSummary(req.user!.employeeId!, month));
  } catch (err) { next(err); }
}

export async function uploadAttendanceCsv(req: AuthRequest, res: Response, next: NextFunction) {
  const fileName = req.file?.originalname || null;
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const csv = req.file.buffer.toString('utf-8');
    const result = await attendanceService.uploadAttendanceCsv(csv);

    const processed = result.created + result.updated;
    const status: 'success' | 'partial' = (result.skipped > 0 || result.unmatched.length > 0 || !processed) ? 'partial' : 'success';
    await attendanceService.logAttendanceUpload({
      uploaded_by: req.user?.userId ?? null,
      uploaded_by_email: req.user?.email ?? null,
      file_name: fileName,
      rows_total: result.total,
      rows_created: result.created,
      rows_updated: result.updated,
      rows_skipped: result.skipped,
      unmatched_count: result.unmatched.length,
      date_from: result.dates[0] ?? null,
      date_to: result.dates[result.dates.length - 1] ?? null,
      dates_count: result.dates.length,
      locations: result.locations.join(', ') || null,
      status,
    });
    // Clear today's upload reminders now that an upload has landed.
    await attendanceService.resolveTodaysReminders();

    res.json(result);
  } catch (err: any) {
    // Record the failed attempt so it shows in the history, then surface the error.
    await attendanceService.logAttendanceUpload({
      uploaded_by: req.user?.userId ?? null,
      uploaded_by_email: req.user?.email ?? null,
      file_name: fileName,
      rows_total: 0, rows_created: 0, rows_updated: 0, rows_skipped: 0, unmatched_count: 0,
      dates_count: 0, status: 'failed', error_note: err?.message?.slice(0, 500) || 'Upload failed',
    });
    next(err);
  }
}

export async function getUploadLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await attendanceService.listAttendanceUploadLogs(limit));
  } catch (err) { next(err); }
}

export async function getPropertySummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    res.json(await attendanceService.getPropertySummary(date));
  } catch (err) { next(err); }
}

export async function getPropertyEmployees(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const property = req.query.property as string;
    const status = req.query.status as string | undefined;
    if (!property) return res.status(400).json({ error: 'property query param is required' });
    res.json(await attendanceService.getPropertyEmployees(date, property, status));
  } catch (err) { next(err); }
}

export async function getAvailableDates(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await attendanceService.getAvailableDates());
  } catch (err) { next(err); }
}
