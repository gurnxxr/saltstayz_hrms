import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import * as attendanceService from '../services/attendance.service';
import * as gridService from '../services/attendanceGrid.service';
import * as registerService from '../services/attendanceRegister.service';

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

/** Import HR's wide "marked grid" dashboard (.xlsx or .csv), where each cell is a day-code. */
export async function uploadMarkedGrid(req: AuthRequest, res: Response, next: NextFunction) {
  const fileName = req.file?.originalname || null;
  try {
    if (!req.file) return res.status(400).json({ error: 'Attendance sheet is required' });
    const month = (req.body?.month || req.query?.month || '').toString().slice(0, 7) || undefined;
    const result = await gridService.uploadMarkedGrid(req.file.buffer, fileName || 'upload.csv', month);

    const processed = result.created + result.updated;
    const status: 'success' | 'partial' =
      (result.skipped > 0 || result.unmatched.length > 0 || result.unrecognized.length > 0 || !processed) ? 'partial' : 'success';
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
      locations: null,
      status,
    });
    await attendanceService.resolveTodaysReminders();

    res.json(result);
  } catch (err: any) {
    await attendanceService.logAttendanceUpload({
      uploaded_by: req.user?.userId ?? null,
      uploaded_by_email: req.user?.email ?? null,
      file_name: fileName,
      rows_total: 0, rows_created: 0, rows_updated: 0, rows_skipped: 0, unmatched_count: 0,
      dates_count: 0, status: 'failed', error_note: err?.message?.slice(0, 500) || 'Grid upload failed',
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

/**
 * A blank marked grid, in the exact shape the importer parses.
 *
 * Sent as a download rather than JSON the client assembles: it needs the live roster and the
 * month's dates, and rebuilding that in the browser would be a second definition of the file
 * format to keep in step with the parser.
 */
export async function downloadMarkedGridTemplate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    const csv = await gridService.buildMarkedGridTemplate(month);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance_grid_${month}.csv"`);
    res.send(csv);
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

// ─── Attendance Register (admin) ───

/** Parsed once so the list, the grid and the export can never read the query differently. */
function registerFilters(req: AuthRequest): registerService.RegisterFilters {
  const str = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
  return {
    month: str('month'),
    property: str('property'),
    // `branch_unit`, never `branch` — every other filter spelled `branch` in this system means
    // the property, and colliding with that would point this at the wrong column.
    branch_unit: str('branch_unit'),
    department: str('department'),
    search: str('search'),
  };
}

export async function getRegister(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await registerService.getRegister({
      ...registerFilters(req),
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 25,
    }));
  } catch (err) { next(err); }
}

export async function getRegisterGrid(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json(await registerService.getDayGrid({
      ...registerFilters(req),
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 25,
    }));
  } catch (err) { next(err); }
}

export async function exportRegister(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filters = registerFilters(req);
    const csv = await registerService.exportRegisterCsv(filters);
    const month = filters.month || new Date().toISOString().slice(0, 7);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Attendance_Register_${month}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
}

/**
 * One employee's month, day by day — the drill-down.
 *
 * Reuses getMyCalendar, which already takes an employee id and already resolves leave, scoped
 * holidays and the working calendar. Only the HTTP layer was missing: the existing /my-calendar
 * route hard-wires req.user.employeeId, so there was no way to look at anybody else.
 */
export async function getEmployeeMonth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const employeeId = Number(req.query.employeeId);
    if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    res.json(await attendanceService.getMyCalendar(employeeId, month));
  } catch (err) { next(err); }
}
