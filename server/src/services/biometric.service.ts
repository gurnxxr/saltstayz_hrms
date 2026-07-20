import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../config/database';
import { ValidationError, NotFoundError } from '../utils/errors';
import { getPaySchedule } from './paySchedule.service';
import { overnightHours, deriveAttendanceStatus } from './attendance.calc';

// "Today" in India — device clocks report IST. Deriving the default date from UTC
// (toISOString) rolls it a day early during the 00:00–05:30 IST window and would
// process the wrong calendar day. en-CA formats as YYYY-MM-DD.
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// ─── API Key Management ───

export async function createApiKey(name: string) {
  if (!name?.trim()) throw new ValidationError('API key name is required');

  const rawKey = 'bio_' + crypto.randomBytes(28).toString('hex');
  const keyPrefix = rawKey.slice(0, 8);
  const keyHash = await bcrypt.hash(rawKey, 12);

  const [id] = await db('biometric_api_keys').insert({ name: name.trim(), key_hash: keyHash, key_prefix: keyPrefix });
  return { id, name: name.trim(), key: rawKey, prefix: keyPrefix };
}

export async function listApiKeys() {
  return db('biometric_api_keys')
    .select('id', 'name', 'key_prefix', 'is_active', 'last_used_at', 'created_at')
    .orderBy('created_at', 'desc');
}

export async function revokeApiKey(id: number) {
  const key = await db('biometric_api_keys').where('id', id).first();
  if (!key) throw new NotFoundError('API key');
  await db('biometric_api_keys').where('id', id).update({ is_active: false, updated_at: db.fn.now() });
}

// ─── Punch Log Ingestion ───

interface PunchLog {
  employee_code: string;
  log_datetime: string;
  log_time: string;
  downloaded_at?: string;
  device_sn: string;
}

export async function receivePunch(log: PunchLog) {
  validatePunchLog(log);

  const employee = await db('employees').where('employee_code', log.employee_code).first();

  await upsertDevice(log.device_sn);

  // Idempotent ingest: a device re-transmitting its buffer must not create duplicate
  // punches. (employee_code, log_datetime, device_sn) is unique — a repeat is a no-op.
  const dupeKey = { employee_code: log.employee_code, log_datetime: log.log_datetime, device_sn: log.device_sn };
  const existing = await db('biometric_logs').where(dupeKey).first();
  if (existing) {
    return { id: existing.id, matched: !!employee, duplicate: true, employee_name: employee ? `${employee.first_name} ${employee.last_name}` : null };
  }

  // onConflict().ignore() is the race backstop if two identical punches arrive together.
  const inserted = await db('biometric_logs').insert({
    ...dupeKey,
    employee_id: employee?.id || null,
    log_time: log.log_time,
    downloaded_at: log.downloaded_at || null,
    status: employee ? 'pending' : 'unmatched',
  }).onConflict().ignore();
  const id = Array.isArray(inserted) ? inserted[0] : inserted;

  return { id: id ?? null, matched: !!employee, duplicate: false, employee_name: employee ? `${employee.first_name} ${employee.last_name}` : null };
}

export async function receivePunchBatch(logs: PunchLog[]) {
  if (!Array.isArray(logs) || logs.length === 0) throw new ValidationError('Logs array is required and must not be empty');
  if (logs.length > 1000) throw new ValidationError('Maximum 1000 logs per batch');

  const results = { received: 0, matched: 0, unmatched: 0, duplicates: 0, errors: [] as string[] };

  const employeeCodes = [...new Set(logs.map(l => l.employee_code))];
  const employees = await db('employees').whereIn('employee_code', employeeCodes);
  const empMap = new Map(employees.map((e: any) => [e.employee_code, e]));

  // Only register devices for rows that actually carry a serial. A missing device_sn is
  // a per-row validation error (reported below) — it must not abort the whole batch by
  // reaching upsertDevice(undefined) with an undefined Knex binding.
  const deviceSns = [...new Set(logs.map(l => l.device_sn).filter((s): s is string => !!s && !!String(s).trim()))];
  for (const sn of deviceSns) await upsertDevice(sn);

  // Idempotent ingest: skip punches already stored (a device re-transmitting its buffer)
  // and de-dupe within the batch. (employee_code, log_datetime, device_sn) is the key.
  const keyOf = (l: PunchLog) => `${l.employee_code}|${l.log_datetime}|${l.device_sn}`;
  const seen = new Set<string>();
  const stored = await db('biometric_logs')
    .whereIn('employee_code', employeeCodes)
    .whereIn('log_datetime', [...new Set(logs.map(l => l.log_datetime))])
    .select('employee_code', 'log_datetime', 'device_sn');
  for (const r of stored as any[]) seen.add(`${r.employee_code}|${String(r.log_datetime)}|${r.device_sn}`);

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    try {
      validatePunchLog(log);
      const employee = empMap.get(log.employee_code);

      const key = keyOf(log);
      if (seen.has(key)) { results.duplicates++; continue; }
      seen.add(key);

      await db('biometric_logs').insert({
        employee_code: log.employee_code,
        employee_id: employee?.id || null,
        log_datetime: log.log_datetime,
        log_time: log.log_time,
        device_sn: log.device_sn,
        downloaded_at: log.downloaded_at || null,
        status: employee ? 'pending' : 'unmatched',
      }).onConflict().ignore(); // race backstop against a concurrent identical batch

      results.received++;
      if (employee) results.matched++;
      else results.unmatched++;
    } catch (err: any) {
      results.errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return results;
}

// ─── Processing: Raw Logs → Attendance Records ───

export async function processLogs(date?: string) {
  const targetDate = date || istToday();
  const dayStart = `${targetDate} 00:00:00`;
  const dayEnd = `${targetDate} 23:59:59`;

  // Pending, matched logs decide which employees to (re)process and which log rows to
  // mark done. There may already be processed logs for the same day (an earlier run).
  const pending = await db('biometric_logs')
    .where('is_processed', false)
    .whereNotNull('employee_id')
    .where('status', 'pending')
    .whereBetween('log_datetime', [dayStart, dayEnd])
    .orderBy('log_datetime', 'asc');

  if (pending.length === 0) return { processed: 0, records_created: 0, records_updated: 0, records_skipped: 0, date: targetDate };

  const empIds = [...new Set(pending.map((l: any) => l.employee_id as number))];

  // Recompute check-in/out from ALL of the day's punches for these employees (already
  // processed + newly pending), NOT just the pending subset. Otherwise a second run
  // after the check-out punch arrives would recompute from that punch alone, overwrite
  // the real check-in and blank the working hours.
  const allDay = await db('biometric_logs')
    .whereNotNull('employee_id')
    .whereIn('employee_id', empIds)
    .whereBetween('log_datetime', [dayStart, dayEnd])
    .orderBy('log_datetime', 'asc');
  const byEmp = new Map<number, any[]>();
  for (const l of allDay as any[]) {
    const a = byEmp.get(l.employee_id) || [];
    a.push(l); byEmp.set(l.employee_id, a);
  }

  // Shift + grace from the same source as the CSV path, so status is derived consistently.
  const schedule = await getPaySchedule();
  const graceMinutes = schedule.grace_minutes;
  const standardDayHours = schedule.standard_day_hours;
  const rosterRows = await db('shift_rosters as r')
    .join('shift_types as st', 'st.id', 'r.shift_type_id')
    .whereIn('r.employee_id', empIds).where('r.date', targetDate)
    .select('r.employee_id', 'st.start_time', 'st.end_time');
  const shiftByEmpDate = new Map<number, any>(rosterRows.map((r: any) => [r.employee_id, r]));
  const assignRows = await db('employee_shift_assignments as a')
    .join('shift_types as st', 'st.id', 'a.shift_type_id')
    .whereIn('a.employee_id', empIds)
    .select('a.employee_id', 'st.start_time', 'st.end_time');
  const shiftByEmp = new Map<number, any>(assignRows.map((r: any) => [r.employee_id, r]));

  let recordsCreated = 0;
  let recordsUpdated = 0;
  let recordsSkipped = 0;
  const processedIds: number[] = [];

  for (const employeeId of empIds) {
    const dayLogs = (byEmp.get(employeeId) || []).sort((a: any, b: any) =>
      String(a.log_datetime).localeCompare(String(b.log_datetime)));
    const times = [...new Set(dayLogs.map((l: any) => String(l.log_datetime)))];
    const checkIn = times[0] ?? null;
    // A single distinct punch (even if the device duplicated it) is a miss punch, not a
    // full-day pair — only 2+ distinct times give a check-out.
    const checkOut = times.length > 1 ? times[times.length - 1] : null;
    const hasIn = checkIn != null;
    const hasOut = checkOut != null;

    let workingHours: number | null = null;
    if (hasIn && hasOut) {
      const diff = new Date(checkOut as string).getTime() - new Date(checkIn as string).getTime();
      workingHours = Math.round((diff / (1000 * 60 * 60)) * 100) / 100;
    }

    const shift = shiftByEmpDate.get(employeeId) ?? shiftByEmp.get(employeeId);
    const shiftHours = shift ? overnightHours(shift.start_time, shift.end_time) : 0;
    // Real ladder: present / short_punch / miss_punch (not the old inverted rule that
    // marked sub-threshold and single-punch days 'present' and never produced anything else).
    const status = deriveAttendanceStatus({
      hasIn, hasOut, workedHours: workingHours ?? 0,
      shiftHours: shiftHours || standardDayHours,
      graceMinutes,
    });

    const pendingIdsForEmp = pending.filter((l: any) => l.employee_id === employeeId).map((l: any) => l.id);
    const existing = await db('attendance_records')
      .where('employee_id', employeeId).where('date', targetDate).first();

    // HR-authoritative days (approved leave or an approved regularisation) are never
    // overwritten from punches — mark the logs processed so they don't re-queue, and skip.
    if (existing && (existing.status === 'on_leave' || existing.is_regularised)) {
      recordsSkipped++;
      processedIds.push(...pendingIdsForEmp);
      continue;
    }

    if (existing) {
      await db('attendance_records').where('id', existing.id).update({
        check_in: checkIn,
        check_out: checkOut,
        working_hours: workingHours,
        status,
        updated_at: db.fn.now(),
      });
      recordsUpdated++;
    } else {
      await db('attendance_records').insert({
        employee_id: employeeId,
        date: targetDate,
        check_in: checkIn,
        check_out: checkOut,
        working_hours: workingHours,
        status,
      });
      recordsCreated++;
    }

    processedIds.push(...pendingIdsForEmp);
  }

  if (processedIds.length > 0) {
    await db('biometric_logs').whereIn('id', processedIds).update({ is_processed: true, status: 'processed', updated_at: db.fn.now() });
  }

  return { processed: processedIds.length, records_created: recordsCreated, records_updated: recordsUpdated, records_skipped: recordsSkipped, date: targetDate };
}

// ─── Query Logs ───

export async function getLogs(filters: { date?: string; employee_code?: string; status?: string; device_sn?: string; page?: number; limit?: number }) {
  const page = filters.page || 1;
  const limit = filters.limit || 50;

  const query = db('biometric_logs as bl')
    .leftJoin('employees as e', 'e.id', 'bl.employee_id')
    .select(
      'bl.*',
      db.raw("COALESCE(e.first_name || ' ' || e.last_name, 'Unknown') as employee_name"),
      'e.employee_code as matched_code'
    )
    .orderBy('bl.log_datetime', 'desc');

  if (filters.date) {
    query.whereBetween('bl.log_datetime', [`${filters.date} 00:00:00`, `${filters.date} 23:59:59`]);
  }
  if (filters.employee_code) query.where('bl.employee_code', filters.employee_code);
  if (filters.status) query.where('bl.status', filters.status);
  if (filters.device_sn) query.where('bl.device_sn', filters.device_sn);

  const countQuery = query.clone().clearSelect().clearOrder().count('* as total').first();
  const total = await countQuery;
  const data = await query.offset((page - 1) * limit).limit(limit);

  return { data, total: Number((total as any)?.total || 0), page, limit };
}

export async function getLogStats(date?: string) {
  const targetDate = date || istToday();

  const stats = await db('biometric_logs')
    .whereBetween('log_datetime', [`${targetDate} 00:00:00`, `${targetDate} 23:59:59`])
    .select(
      db.raw('COUNT(*) as total_logs'),
      db.raw("SUM(CASE WHEN status = 'processed' THEN 1 ELSE 0 END) as processed"),
      db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
      db.raw("SUM(CASE WHEN status = 'unmatched' THEN 1 ELSE 0 END) as unmatched"),
      db.raw('COUNT(DISTINCT employee_code) as unique_employees'),
      db.raw('COUNT(DISTINCT device_sn) as devices_reporting')
    )
    .first();

  return { ...stats, date: targetDate };
}

// ─── Devices ───

export async function listDevices() {
  return db('biometric_devices').orderBy('last_seen_at', 'desc');
}

async function upsertDevice(serialNumber: string) {
  const existing = await db('biometric_devices').where('serial_number', serialNumber).first();
  if (existing) {
    await db('biometric_devices').where('id', existing.id).update({ last_seen_at: db.fn.now() });
  } else {
    await db('biometric_devices').insert({ serial_number: serialNumber, last_seen_at: db.fn.now() });
  }
}

// ─── Helpers ───

function validatePunchLog(log: PunchLog) {
  if (!log.employee_code?.trim()) throw new ValidationError('employee_code is required');
  if (!log.log_datetime?.trim()) throw new ValidationError('log_datetime is required');
  if (!log.log_time?.trim()) throw new ValidationError('log_time is required');
  if (!log.device_sn?.trim()) throw new ValidationError('device_sn is required');

  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(log.log_datetime)) {
    throw new ValidationError('log_datetime must be YYYY-MM-DD HH:mm:ss');
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(log.log_time)) {
    throw new ValidationError('log_time must be HH:mm:ss');
  }
}
