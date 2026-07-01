import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import db from '../config/database';
import { ValidationError, NotFoundError } from '../utils/errors';

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

  const [id] = await db('biometric_logs').insert({
    employee_code: log.employee_code,
    employee_id: employee?.id || null,
    log_datetime: log.log_datetime,
    log_time: log.log_time,
    device_sn: log.device_sn,
    downloaded_at: log.downloaded_at || null,
    status: employee ? 'pending' : 'unmatched',
  });

  return { id, matched: !!employee, employee_name: employee ? `${employee.first_name} ${employee.last_name}` : null };
}

export async function receivePunchBatch(logs: PunchLog[]) {
  if (!Array.isArray(logs) || logs.length === 0) throw new ValidationError('Logs array is required and must not be empty');
  if (logs.length > 1000) throw new ValidationError('Maximum 1000 logs per batch');

  const results = { received: 0, matched: 0, unmatched: 0, errors: [] as string[] };

  const employeeCodes = [...new Set(logs.map(l => l.employee_code))];
  const employees = await db('employees').whereIn('employee_code', employeeCodes);
  const empMap = new Map(employees.map((e: any) => [e.employee_code, e]));

  const deviceSns = [...new Set(logs.map(l => l.device_sn))];
  for (const sn of deviceSns) await upsertDevice(sn);

  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    try {
      validatePunchLog(log);
      const employee = empMap.get(log.employee_code);

      await db('biometric_logs').insert({
        employee_code: log.employee_code,
        employee_id: employee?.id || null,
        log_datetime: log.log_datetime,
        log_time: log.log_time,
        device_sn: log.device_sn,
        downloaded_at: log.downloaded_at || null,
        status: employee ? 'pending' : 'unmatched',
      });

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
  const targetDate = date || new Date().toISOString().split('T')[0];

  const logs = await db('biometric_logs')
    .where('is_processed', false)
    .whereNotNull('employee_id')
    .where('status', 'pending')
    .whereBetween('log_datetime', [`${targetDate} 00:00:00`, `${targetDate} 23:59:59`])
    .orderBy('log_datetime', 'asc');

  if (logs.length === 0) return { processed: 0, records_created: 0, records_updated: 0 };

  const grouped = new Map<number, typeof logs>();
  for (const log of logs) {
    const existing = grouped.get(log.employee_id) || [];
    existing.push(log);
    grouped.set(log.employee_id, existing);
  }

  let recordsCreated = 0;
  let recordsUpdated = 0;
  const processedIds: number[] = [];

  for (const [employeeId, empLogs] of grouped) {
    const sorted = empLogs.sort((a: any, b: any) => a.log_datetime.localeCompare(b.log_datetime));
    const checkIn = sorted[0].log_datetime;
    const checkOut = sorted.length > 1 ? sorted[sorted.length - 1].log_datetime : null;

    let workingHours: number | null = null;
    if (checkIn && checkOut) {
      const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
      workingHours = Math.round((diff / (1000 * 60 * 60)) * 100) / 100;
    }

    const status = workingHours && workingHours >= 4 ? (workingHours >= 7 ? 'present' : 'half_day') : 'present';

    const existing = await db('attendance_records')
      .where('employee_id', employeeId)
      .where('date', targetDate)
      .first();

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

    processedIds.push(...sorted.map((l: any) => l.id));
  }

  if (processedIds.length > 0) {
    await db('biometric_logs').whereIn('id', processedIds).update({ is_processed: true, status: 'processed', updated_at: db.fn.now() });
  }

  return { processed: processedIds.length, records_created: recordsCreated, records_updated: recordsUpdated, date: targetDate };
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
  const targetDate = date || new Date().toISOString().split('T')[0];

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
