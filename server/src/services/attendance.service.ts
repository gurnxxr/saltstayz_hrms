import db from '../config/database';
import { ValidationError } from '../utils/errors';
import { JwtPayload } from '../types';
import { notify } from './notification.service';
import { getEmployeeRegion } from './leave.service';
import { getPaySchedule } from './paySchedule.service';
import { overnightHours, judgeDay } from './attendance.calc';
import { pickAssignmentFor } from './shiftPattern';

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * The shift whose hour thresholds are allowed to judge a date — or null when none are.
 *
 * Both attendance paths call this, so they cannot apply different gates to the same day. That
 * was the whole point of collapsing the two engines: previously the upload applied a shift's
 * absent/half-day hours with neither gate, while the daily catch-up pass applied both — so the
 * pass that exists to correct the upload would skip exactly the days the upload got wrong.
 *
 * Two gates, and they are the reason this is a function rather than a lookup:
 *  - a shift's rules do not exist before its own effective date;
 *  - a shift with auto-attendance switched off does not judge anyone by hours at all.
 */
function applicableRules(list: any[] | undefined, date: string, today: string) {
  const chosen = pickAssignmentFor(list ?? [], date, today);
  if (!chosen) return null;
  if (!chosen.enable_auto_attendance) return null;
  if (chosen.shift_effective_from && String(chosen.shift_effective_from).slice(0, 10) > date) return null;
  return chosen;
}

/**
 * Re-checks a day's attendance against the shift's hour thresholds.
 *
 * The upload already applies these when it writes a day, so this is a catch-up pass: it fixes
 * days whose shift rules changed after the file was loaded, and days that arrived by some
 * other route. It resolves the shift exactly the way the upload and the payroll calendar do —
 * the dated assignment in effect on that date — so all three agree.
 *
 * Leave, an approved regularisation, and punch-based verdicts (a short or missed punch) are
 * never overwritten. Neither is a day whose shift has no hours configured: treating "not
 * configured" as "present" is how correctly-identified half-days and absences used to be
 * wiped. Runs daily for yesterday, plus on demand from Admin → Attendance for any date.
 */
export async function autoMarkAttendance(date?: string) {
  const target = date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows = await db('attendance_records as ar')
    .where('ar.date', target)
    .whereNotNull('ar.working_hours')
    // Leave + punch-derived verdicts are authoritative — this pass never overwrites them.
    .whereNotIn('ar.status', ['on_leave', 'miss_punch', 'short_punch'])
    // An HR/manager-approved regularisation is authoritative too — never re-derive it.
    .whereRaw('COALESCE(ar.is_regularised, false) = false')
    .select('ar.id', 'ar.employee_id', 'ar.status', 'ar.working_hours');
  if (!rows.length) return { date: target, scanned: 0, updated: 0 };

  // One query for every assignment in play, resolved per employee in memory. A plain join
  // would now multiply rows, since an employee can have several dated assignments.
  const empIds = [...new Set(rows.map((r: any) => r.employee_id))];
  // Deliberately NOT filtered by enable_auto_attendance. That flag belongs to the shift the
  // employee turns out to be on, and filtering here would remove rows from the timeline before
  // it is resolved — leaving the fallback to land on a superseded or not-yet-started shift and
  // judge the day by rules that don't apply to it. Resolve first, then decide.
  const assignRows = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', empIds)
    .select('a.employee_id', 'a.effective_from', 'st.absent_hours', 'st.half_day_hours',
      'st.enable_auto_attendance', 'st.effective_from as shift_effective_from')
    .orderBy(['a.employee_id', 'a.effective_from']);

  const byEmp = new Map<number, any[]>();
  for (const a of assignRows) {
    if (!byEmp.has(a.employee_id)) byEmp.set(a.employee_id, []);
    byEmp.get(a.employee_id)!.push(a);
  }
  const shiftFor = (employeeId: number) => applicableRules(byEmp.get(employeeId), target, todayStr());

  let updated = 0;
  let scanned = 0;
  for (const r of rows) {
    const shift = shiftFor(r.employee_id);
    if (!shift) continue; // no shift, or auto-attendance off for it
    const absent = Number(shift.absent_hours) || 0;
    const half = Number(shift.half_day_hours) || 0;
    if (absent <= 0 && half <= 0) continue; // nothing to judge against
    scanned += 1;

    // Same judgement the upload used. These rows already have both punches (working_hours is
    // set and the punch-based verdicts are excluded above), so only the ladder can apply.
    const status = judgeDay({
      hasIn: true, hasOut: true,
      workedHours: Number(r.working_hours) || 0,
      shiftHours: 0, graceMinutes: 0,
      absentHours: absent, halfDayHours: half,
    });
    if (status !== r.status) {
      await db('attendance_records').where('id', r.id).update({ status, updated_at: db.fn.now() });
      updated += 1;
    }
  }
  return { date: target, scanned, updated };
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
      if (region?.state) this.orWhere('state', region.state);
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
      db.raw("SUM(CASE WHEN status = 'hhd' THEN 1 ELSE 0 END) as hhd"),
      db.raw("SUM(CASE WHEN status = 'miss_punch' THEN 1 ELSE 0 END) as miss_punch"),
      db.raw("SUM(CASE WHEN status = 'short_punch' THEN 1 ELSE 0 END) as short_punch"),
      db.raw("SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as on_leave"),
      // working_hours is a float column; Postgres only defines round(numeric, int), so cast.
      db.raw("ROUND(AVG(working_hours)::numeric, 1) as avg_working_hours")
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
  explicitStatus?: 'hhd' | null; // an explicit day-type from the file, overriding the punch verdict
}

/** Recognised explicit day-type codes that can ride in on the CSV's status/remark column,
 *  overriding the punch-derived verdict. Currently just HHD — a half-day holiday, paid ½. */
function mapExplicitStatus(raw: string): 'hhd' | null {
  const t = (raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (t === 'hhd' || t === 'half_day_holiday' || t === 'half-day_holiday') return 'hhd';
  return null;
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
  // Optional explicit status/remark column — lets an admin day-type (e.g. HHD, a half-day
  // holiday) ride in on the biometric file and override the punch-derived verdict.
  const statusIdx = header.findIndex(h => h === 'status' || h === 'attendance_status' || h === 'day_status' || h === 'remark' || h === 'remarks');

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
    const explicitStatus = statusIdx !== -1 ? mapExplicitStatus(cols[statusIdx]) : null;

    // A miss punch has only one time — require an employee, a date, and at least one
    // punch OR a recognised explicit day-type (e.g. HHD, which needn't carry punches).
    if (!empCode || !rawDate || (!rawIn && !rawOut && !explicitStatus)) {
      parseErrors.push(`Row ${i + 1}: missing employee, date, or any punch time`);
      continue;
    }

    try {
      const date = parseDDMMYY(rawDate);
      const location = locIdx !== -1 ? (cols[locIdx] || '').trim() : '';
      rows.push({ empCode, date, checkIn: (rawIn || '').trim(), checkOut: (rawOut || '').trim(), location, explicitStatus });
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
  // Every dated assignment for everyone in the file, in one query. The shift in effect on a
  // date is then resolved in memory — the same rule the payroll calendar uses, so attendance
  // and pay can't disagree about which shift someone was on.
  const assignRows = empIds.length ? await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', empIds)
    .select('a.employee_id', 'a.effective_from', 'st.start_time', 'st.end_time',
      'st.ends_next_day', 'st.absent_hours', 'st.half_day_hours',
      'st.enable_auto_attendance', 'st.effective_from as shift_effective_from')
    .orderBy(['a.employee_id', 'a.effective_from']) : [];

  const assignmentsByEmp = new Map<number, any[]>();
  for (const a of assignRows) {
    if (!assignmentsByEmp.has(a.employee_id)) assignmentsByEmp.set(a.employee_id, []);
    assignmentsByEmp.get(a.employee_id)!.push(a);
  }
  const today = todayStr();
  /** Which shift they were on — used for the punch window (start/end times). */
  const shiftFor = (employeeId: number, date: string) =>
    pickAssignmentFor(assignmentsByEmp.get(employeeId) ?? [], date, today);
  /** Whether that shift's hour thresholds may judge the day — the same gates the daily pass uses. */
  const rulesFor = (employeeId: number, date: string) =>
    applicableRules(assignmentsByEmp.get(employeeId), date, today);

  for (const row of rows) {
    const employeeId = empMap.get(row.empCode);
    if (!employeeId) {
      results.skipped++;
      if (!results.unmatched.includes(row.empCode)) results.unmatched.push(row.empCode);
      continue;
    }

    const rawIn = !!row.checkIn;
    const rawOut = !!row.checkOut;
    // An identical First_In / Last_Out is a single swipe the biometric export
    // duplicated into both columns — treat it as one punch (a miss punch), not a
    // full 24h "present" day.
    const duplicatePunch = rawIn && rawOut && row.checkIn === row.checkOut;
    const hasIn = rawIn;
    const hasOut = rawOut && !duplicatePunch;

    const worked = (hasIn && hasOut) ? overnightHours(row.checkIn, row.checkOut) : 0;
    const shift = shiftFor(employeeId, row.date);
    const shiftHours = shift ? overnightHours(shift.start_time, shift.end_time) : 0;
    // The punch window comes from the shift regardless; the hour ladder only applies when the
    // shift's rules are actually in force on this date. Without this the upload would judge by
    // thresholds the daily catch-up pass skips, and nothing would ever reconcile the two.
    const rules = rulesFor(employeeId, row.date);

    // One verdict, from the shift's own rules: the punch-based judgement first, then the
    // shift's hour thresholds. Previously a separate daily job applied those thresholds
    // afterwards, using a different shift lookup. An explicit day-type from the file
    // (e.g. HHD) overrides the punch-derived verdict entirely.
    const status = row.explicitStatus || judgeDay({
      hasIn, hasOut, workedHours: worked,
      shiftHours: shiftHours || standardDayHours,
      graceMinutes,
      absentHours: Number(rules?.absent_hours) || 0,
      halfDayHours: Number(rules?.half_day_hours) || 0,
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
      // HR-authoritative days must never be overwritten by a biometric re-upload:
      // an approved leave (status='on_leave') OR an HR/manager-approved regularisation
      // (is_regularised). Overwriting either silently reverts a corrected day back to
      // its raw punch-derived status — i.e. re-docks approved pay. Leave the record
      // exactly as HR set it and count it skipped.
      if (existing.status === 'on_leave' || existing.is_regularised) {
        results.skipped++;
        continue;
      }
      await db('attendance_records').where('id', existing.id).update({
        check_in: checkInDatetime,
        check_out: checkOutDatetime,
        working_hours: workingHours,
        status,
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
    .whereRaw('created_at::date = ?', [todayStr()])
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
      .whereRaw('created_at::date = ?', [todayStr()])
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
      .whereRaw('created_at::date = ?', [todayStr()])
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
      db.raw("SUM(CASE WHEN ar.status = 'hhd' THEN 1 ELSE 0 END) as hhd"),
      db.raw("SUM(CASE WHEN ar.status = 'miss_punch' THEN 1 ELSE 0 END) as miss_punch"),
      db.raw("SUM(CASE WHEN ar.status = 'short_punch' THEN 1 ELSE 0 END) as short_punch"),
      db.raw("SUM(CASE WHEN ar.status = 'on_leave' THEN 1 ELSE 0 END) as on_leave"),
      // working_hours is a float column; Postgres only defines round(numeric, int), so cast.
      db.raw("ROUND(AVG(ar.working_hours)::numeric, 1) as avg_hours")
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
