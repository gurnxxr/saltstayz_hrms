import db from '../config/database';
import { ValidationError } from '../utils/errors';
import { JwtPayload } from '../types';
import { notify } from './notification.service';
import { getEmployeeRegion } from './leave.service';
import { getPaySchedule } from './paySchedule.service';
import { overnightHours, deriveAttendanceStatus } from './attendance.calc';

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Auto attendance (Shift Type thresholds): re-derives the status of attendance
 * records from their working hours for employees whose assigned shift type has
 * auto attendance enabled — hours below the absent threshold mark Absent, below
 * the half-day threshold mark Half Day, otherwise Present. A zero threshold
 * disables that rule (per the Shift Type spec); on_leave records and dates
 * before the shift's "Process Attendance After" are never touched. Runs daily
 * for yesterday, plus on demand from Admin → Attendance for any date.
 */
export async function autoMarkAttendance(date?: string) {
  const target = date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await db('attendance_records as ar')
    .join('employee_shift_assignments as esa', 'esa.employee_id', 'ar.employee_id')
    .join('shift_types as st', 'st.id', 'esa.shift_type_id')
    .where('ar.date', target)
    .where('st.enable_auto_attendance', true)
    .whereNotNull('ar.working_hours')
    // Leave + punch-derived statuses are authoritative — the threshold job never overwrites them.
    .whereNotIn('ar.status', ['on_leave', 'miss_punch', 'short_punch'])
    .where(function (this: any) {
      this.whereNull('st.process_attendance_after').orWhere('st.process_attendance_after', '<=', target);
    })
    .select('ar.id', 'ar.status', 'ar.working_hours', 'st.half_day_threshold', 'st.absent_threshold');

  let updated = 0;
  for (const r of rows) {
    const hours = Number(r.working_hours) || 0;
    const absentT = Number(r.absent_threshold) || 0;
    const halfT = Number(r.half_day_threshold) || 0;
    let status = 'present';
    if (absentT > 0 && hours < absentT) status = 'absent';
    else if (halfT > 0 && hours < halfT) status = 'half_day';
    if (status !== r.status) {
      await db('attendance_records').where('id', r.id).update({ status, updated_at: db.fn.now() });
      updated += 1;
    }
  }
  return { date: target, scanned: rows.length, updated };
}

export async function getMyCalendar(employeeId: number, month: string) {
  // month format: "2026-06"
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;

  const records = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [startDate, endDate])
    .select('id', 'date', 'status', 'check_in', 'check_out', 'working_hours', 'is_regularised')
    .orderBy('date', 'asc');

  // Also fetch approved leaves for this month
  const leaves = await db('leave_requests as lr')
    .join('leave_types as lt', 'lt.id', 'lr.leave_type_id')
    .where('lr.employee_id', employeeId)
    .where('lr.status', 'approved')
    .where('lr.start_date', '<=', endDate)
    .where('lr.end_date', '>=', startDate)
    .select('lr.start_date', 'lr.end_date', 'lt.name as leave_type');

  // Fetch holidays for this month — national + the employee's region only.
  const region = await getEmployeeRegion(employeeId);
  const holidays = await db('holidays')
    .whereBetween('date', [startDate, endDate])
    .where(function () {
      this.where('is_national', true);
      if (region?.region_id) this.orWhere('region_id', region.region_id);
    })
    .select('date', 'name')
    .orderBy('date', 'asc');

  return { records, leaves, holidays };
}

export async function getMonthSummary(employeeId: number, month: string) {
  const startDate = `${month}-01`;
  const endDate = `${month}-31`;

  const summary = await db('attendance_records')
    .where('employee_id', employeeId)
    .whereBetween('date', [startDate, endDate])
    .select(
      db.raw("COUNT(*) as total"),
      db.raw("SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present"),
      db.raw("SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent"),
      db.raw("SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_day"),
      db.raw("SUM(CASE WHEN status = 'miss_punch' THEN 1 ELSE 0 END) as miss_punch"),
      db.raw("SUM(CASE WHEN status = 'short_punch' THEN 1 ELSE 0 END) as short_punch"),
      db.raw("SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as on_leave"),
      db.raw("ROUND(AVG(working_hours), 1) as avg_working_hours")
    )
    .first();

  return summary;
}

// ─── CSV Upload: Bulk attendance from biometric file ───

interface AttendanceRow {
  empCode: string;
  date: string;       // YYYY-MM-DD (converted from dd-mm-yy)
  checkIn: string;    // HH:mm
  checkOut: string;   // HH:mm
  location: string;   // property/location (optional in CSV)
}

function parseDDMMYY(raw: string): string {
  const cleaned = raw.trim().replace(/[/]/g, '-');
  const parts = cleaned.split('-');
  if (parts.length !== 3) throw new Error(`Invalid date format: "${raw}"`);

  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  let year = parts[2];
  if (year.length === 2) year = (Number(year) > 50 ? '19' : '20') + year;

  return `${year}-${month}-${day}`;
}

export async function uploadAttendanceCsv(csvContent: string) {
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new ValidationError('CSV must have a header row and at least one data row');

  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));

  const empIdx = header.findIndex(h => h === 'emp_code' || h === 'empcode' || h === 'emp code' || h === 'employee_code');
  const dateIdx = header.findIndex(h => h === 'access_date' || h === 'access_date_(dd-mm-yy)' || h === 'date');
  const inIdx = header.findIndex(h => h === 'first_in_time' || h === 'first_in_time_(hh:mm)' || h === 'check_in' || h === 'in_time');
  const outIdx = header.findIndex(h => h === 'last_out_time' || h === 'last_out_time_(hh:mm)' || h === 'check_out' || h === 'out_time');
  const locIdx = header.findIndex(h => h === 'location' || h === 'property' || h === 'branch' || h === 'site');

  if (empIdx === -1) throw new ValidationError('CSV must have an "Emp Code" column');
  if (dateIdx === -1) throw new ValidationError('CSV must have an "Access Date" column');
  if (inIdx === -1) throw new ValidationError('CSV must have a "First_In_time" column');
  if (outIdx === -1) throw new ValidationError('CSV must have a "Last_Out_time" column');

  const rows: AttendanceRow[] = [];
  const parseErrors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const empCode = cols[empIdx];
    const rawDate = cols[dateIdx];
    const rawIn = cols[inIdx];
    const rawOut = cols[outIdx];

    // A miss punch has only one time — require an employee, a date, and at
    // least one punch (rows with neither punch carry no signal and are skipped).
    if (!empCode || !rawDate || (!rawIn && !rawOut)) {
      parseErrors.push(`Row ${i + 1}: missing employee, date, or any punch time`);
      continue;
    }

    try {
      const date = parseDDMMYY(rawDate);
      const location = locIdx !== -1 ? (cols[locIdx] || '').trim() : '';
      rows.push({ empCode, date, checkIn: (rawIn || '').trim(), checkOut: (rawOut || '').trim(), location });
    } catch (e: any) {
      parseErrors.push(`Row ${i + 1}: ${e.message}`);
    }
  }

  if (rows.length === 0) throw new ValidationError('No valid rows found in CSV');

  const empCodes = [...new Set(rows.map(r => r.empCode))];
  const employees = await db('employees').whereIn('employee_code', empCodes);
  const empMap = new Map(employees.map((e: any) => [e.employee_code, e.id]));

  const dates = [...new Set(rows.map(r => r.date))].sort();
  const locations = [...new Set(rows.map(r => r.location).filter(Boolean))].sort();

  const results = {
    total: rows.length,
    updated: 0,
    created: 0,
    skipped: 0,
    unmatched: [] as string[],
    errors: parseErrors,
    dates,
    locations,
  };

  // ── Attendance policy + shift resolution (batched) ──
  const schedule = await getPaySchedule();
  const graceMinutes = schedule.grace_minutes;
  const standardDayHours = schedule.standard_day_hours;

  const empIds = [...new Set([...empMap.values()])];
  // Dated roster wins; fall back to the employee's standing shift assignment.
  const rosterRows = empIds.length ? await db('shift_rosters as r')
    .join('shift_types as st', 'st.id', 'r.shift_type_id')
    .whereIn('r.employee_id', empIds).whereIn('r.date', dates)
    .select('r.employee_id', 'r.date', 'st.start_time', 'st.end_time') : [];
  const shiftByKey = new Map<string, any>(
    rosterRows.map((r: any) => [`${r.employee_id}|${String(r.date).slice(0, 10)}`, r]));
  const assignRows = empIds.length ? await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', empIds)
    .select('a.employee_id', 'st.start_time', 'st.end_time') : [];
  const shiftByEmp = new Map<number, any>(assignRows.map((r: any) => [r.employee_id, r]));

  for (const row of rows) {
    const employeeId = empMap.get(row.empCode);
    if (!employeeId) {
      results.skipped++;
      if (!results.unmatched.includes(row.empCode)) results.unmatched.push(row.empCode);
      continue;
    }

    const hasIn = !!row.checkIn;
    const hasOut = !!row.checkOut;
    const worked = overnightHours(row.checkIn, row.checkOut); // 0 when a punch is missing
    const shift = shiftByKey.get(`${employeeId}|${row.date}`) ?? shiftByEmp.get(employeeId);
    const shiftHours = shift ? overnightHours(shift.start_time, shift.end_time) : 0;

    const status = deriveAttendanceStatus({
      hasIn, hasOut, workedHours: worked,
      shiftHours: shiftHours || standardDayHours,
      graceMinutes,
    });

    const checkInDatetime = hasIn ? `${row.date} ${row.checkIn}:00` : null;
    const checkOutDatetime = hasOut ? `${row.date} ${row.checkOut}:00` : null;
    const workingHours = (hasIn && hasOut) ? worked : null;
    const location = row.location || null;

    const existing = await db('attendance_records')
      .where('employee_id', employeeId)
      .where('date', row.date)
      .first();

    if (existing) {
      // An approved leave (status='on_leave', written by leave approval) is
      // HR-authoritative — a stray biometric punch must not overwrite it. Keep the
      // leave status; still capture the punch times for the record.
      const nextStatus = existing.status === 'on_leave' ? 'on_leave' : status;
      await db('attendance_records').where('id', existing.id).update({
        check_in: checkInDatetime,
        check_out: checkOutDatetime,
        working_hours: workingHours,
        status: nextStatus,
        ...(location ? { location } : {}),
        updated_at: db.fn.now(),
      });
      results.updated++;
    } else {
      await db('attendance_records').insert({
        employee_id: employeeId,
        date: row.date,
        check_in: checkInDatetime,
        check_out: checkOutDatetime,
        working_hours: workingHours,
        status,
        location,
      });
      results.created++;
    }
  }

  return results;
}

// ─── Upload logs (audit history) + daily reminder ───

export interface UploadLogEntry {
  uploaded_by?: number | null;
  uploaded_by_email?: string | null;
  file_name?: string | null;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  unmatched_count: number;
  date_from?: string | null;
  date_to?: string | null;
  dates_count: number;
  locations?: string | null;
  status: 'success' | 'partial' | 'failed';
  error_note?: string | null;
}

export async function logAttendanceUpload(entry: UploadLogEntry) {
  try {
    await db('attendance_upload_logs').insert(entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[attendance upload log] failed:', (err as Error).message);
  }
}

export async function listAttendanceUploadLogs(limit = 50) {
  return db('attendance_upload_logs')
    .select('*')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(Math.min(200, limit));
}

/** True if a (non-failed) attendance upload was recorded today. */
export async function wasAttendanceUploadedToday(): Promise<boolean> {
  const row = await db('attendance_upload_logs')
    .whereRaw('date(created_at) = ?', [todayStr()])
    .whereNot('status', 'failed')
    .first();
  return !!row;
}

/**
 * Lazily ensures the logged-in HR/Admin user has today's "upload attendance"
 * reminder — created once per day, and only while no upload has happened today.
 * Called when notifications are fetched (no scheduler needed).
 */
export async function ensureDailyAttendanceReminder(user: JwtPayload): Promise<void> {
  try {
    if (await wasAttendanceUploadedToday()) return;
    const existing = await db('notifications')
      .where('user_id', user.userId)
      .where('type', 'attendance_upload_reminder')
      .whereRaw('date(created_at) = ?', [todayStr()])
      .first();
    if (existing) return;
    await notify(user.userId, {
      type: 'attendance_upload_reminder',
      title: "Upload today's attendance",
      message: 'Daily reminder: please upload the attendance file in Admin → Attendance.',
      link: '/admin/attendance',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[attendance reminder] failed:', (err as Error).message);
  }
}

/** Marks today's reminder notifications read once an upload is done. */
export async function resolveTodaysReminders(): Promise<void> {
  try {
    await db('notifications')
      .where('type', 'attendance_upload_reminder')
      .where('is_read', false)
      .whereRaw('date(created_at) = ?', [todayStr()])
      .update({ is_read: true });
  } catch {
    /* non-fatal */
  }
}

// ─── Admin: Property-level attendance view ───

export async function getPropertySummary(date: string) {
  // Group by the attendance location when present, otherwise the employee's branch
  const rows = await db('attendance_records as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.date', date)
    .where('e.is_active', true)
    .select(
      db.raw("COALESCE(ar.location, e.branch_name) as branch_name"),
      db.raw("COUNT(*) as total"),
      db.raw("SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) as present"),
      db.raw("SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) as absent"),
      db.raw("SUM(CASE WHEN ar.status = 'half_day' THEN 1 ELSE 0 END) as half_day"),
      db.raw("SUM(CASE WHEN ar.status = 'miss_punch' THEN 1 ELSE 0 END) as miss_punch"),
      db.raw("SUM(CASE WHEN ar.status = 'short_punch' THEN 1 ELSE 0 END) as short_punch"),
      db.raw("SUM(CASE WHEN ar.status = 'on_leave' THEN 1 ELSE 0 END) as on_leave"),
      db.raw("ROUND(AVG(ar.working_hours), 1) as avg_hours")
    )
    .groupByRaw("COALESCE(ar.location, e.branch_name)")
    .orderByRaw("COALESCE(ar.location, e.branch_name)");

  const totalActive = await db('employees').where('is_active', true).count('* as c').first();
  const totalWithAttendance = await db('attendance_records as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.date', date)
    .where('e.is_active', true)
    .count('* as c')
    .first();

  return {
    date,
    total_active: Number((totalActive as any)?.c || 0),
    total_marked: Number((totalWithAttendance as any)?.c || 0),
    properties: rows,
  };
}

export async function getPropertyEmployees(date: string, branchName: string, status?: string) {
  const query = db('employees as e')
    .leftJoin('attendance_records as ar', function () {
      this.on('ar.employee_id', 'e.id').andOnVal('ar.date', date);
    })
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.is_active', true)
    .whereRaw("COALESCE(ar.location, e.branch_name) = ?", [branchName])
    .select(
      'e.id',
      'e.employee_code',
      'e.first_name',
      'e.last_name',
      'e.dept_name',
      'jt.title as designation',
      'ar.status',
      'ar.check_in',
      'ar.check_out',
      'ar.working_hours',
      db.raw("COALESCE(ar.location, e.branch_name) as location")
    )
    .orderBy('e.first_name');

  if (status) {
    if (status === 'unmarked') {
      query.whereNull('ar.id');
    } else {
      query.where('ar.status', status);
    }
  }

  return query;
}

export async function getAvailableDates() {
  const dates = await db('attendance_records')
    .select('date')
    .groupBy('date')
    .orderBy('date', 'desc')
    .limit(60);
  return dates.map((d: any) => d.date);
}
