import db from '../config/database';
import { getMonthSummary } from './attendance.service';
import { getMyBalances, getMyLeaves } from './leave.service';
import { LIVE_VACANCY_STATUSES } from './recruitment.service';
// An odd home for a four-line regex — it would sit better in utils/businessDate — but it is
// already exported for exactly this purpose, and moving it would change its default from the UTC
// month to the business month for every other caller. Worth doing, separately.
import { assertMonth } from './attendanceRegister.service';

// ─── Layer 1: KPI Strip ───

export async function getKpiStrip() {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  const totalActive = await db('employees').where('is_active', true).count('* as c').first();
  const headcount = Number(totalActive?.c ?? 0);

  // Attrition MTD
  const exitsMtd = await db('employee_exits')
    .whereBetween('exit_date', [monthStart, today])
    .count('* as c').first();
  const exitCount = Number(exitsMtd?.c ?? 0);
  const attritionMtd = headcount > 0 ? ((exitCount / (headcount + exitCount)) * 100) : 0;

  // Attendance rate today
  const attendanceToday = await db('attendance_records')
    .where('date', today)
    .select(
      db.raw("count(*) as total"),
      db.raw("sum(case when status = 'present' or status = 'half_day' then 1 else 0 end) as present")
    ).first();
  const attendanceRate = headcount > 0
    ? ((Number(attendanceToday?.present ?? 0) / headcount) * 100) : 0;

  // Open positions
  const openPos = await db('vacancies').whereIn('status', LIVE_VACANCY_STATUSES)
    .select(db.raw("coalesce(sum(positions - filled), 0) as c")).first();

  // Absenteeism MTD
  const workingDaysMtd = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .count('* as c').first();
  const absentMtd = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .where('status', 'absent')
    .count('* as c').first();
  const totalWorkingDays = Number(workingDaysMtd?.c ?? 0);
  const absenteeismRate = totalWorkingDays > 0
    ? ((Number(absentMtd?.c ?? 0) / totalWorkingDays) * 100) : 0;

  // Late arrival MTD — check_in after 10:00
  const totalCheckins = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .whereNotNull('check_in')
    .count('* as c').first();
  const lateCheckins = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .whereNotNull('check_in')
    .where(db.raw("substr(check_in, 12, 5) > '10:00'"))
    .count('* as c').first();
  const totalCi = Number(totalCheckins?.c ?? 0);
  const lateRate = totalCi > 0
    ? ((Number(lateCheckins?.c ?? 0) / totalCi) * 100) : 0;

  return {
    totalHeadcount: headcount,
    attritionMtd: Math.round(attritionMtd * 10) / 10,
    attritionExitsMtd: exitCount,
    attendanceRateToday: Math.round(attendanceRate * 10) / 10,
    presentToday: Number(attendanceToday?.present ?? 0),
    openPositions: Number(openPos?.c ?? 0),
    absenteeismRateMtd: Math.round(absenteeismRate * 10) / 10,
    lateArrivalRateMtd: Math.round(lateRate * 10) / 10,
    lateCountMtd: Number(lateCheckins?.c ?? 0),
    totalCheckinsMtd: totalCi,
  };
}

// ─── Section A: Workforce Overview ───

export async function getWorkforceOverview() {
  const totalActive = await db('employees').where('is_active', true).count('* as c').first();
  const headcount = Number(totalActive?.c ?? 0);

  const byProperty = await db('employees')
    .where('is_active', true)
    .select('branch_name as property')
    .count('* as count')
    .groupBy('branch_name')
    .orderBy('count', 'desc');

  // Headcount by department, seeded with the whole Departments catalog so the
  // chart tracks the catalog: a newly created department shows immediately (at 0)
  // and a deleted one drops off. Unioned with any off-catalog dept_name employees
  // still carry, so no headcount is lost.
  const [deptCatalog, deptCounts] = await Promise.all([
    db('departments').whereNotNull('name').pluck('name'),
    db('employees').where('is_active', true).whereNotNull('dept_name')
      .select('dept_name as department').count('* as count').groupBy('dept_name'),
  ]);
  const deptMap = new Map<string, number>();
  for (const name of deptCatalog) { const n = String(name ?? '').trim(); if (n && !deptMap.has(n)) deptMap.set(n, 0); }
  for (const r of deptCounts as any[]) { const n = String(r.department ?? '').trim(); if (n) deptMap.set(n, (deptMap.get(n) ?? 0) + Number(r.count)); }
  const byDepartment = [...deptMap.entries()]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));

  const propertyCount = await db('employees')
    .where('is_active', true)
    .countDistinct('branch_name as c').first();

  // Employee-to-room ratio — we don't have rooms data, return staff per property
  const staffByProperty = await db('employees')
    .where('is_active', true)
    .whereNotNull('branch_name')
    .select('branch_name as property')
    .count('* as staff')
    .groupBy('branch_name')
    .orderBy('branch_name');

  // Open positions by property/department
  const openPositions = await db('vacancies as v')
    .leftJoin('properties as p', 'p.id', 'v.property_id')
    .leftJoin('departments as d', 'd.id', 'v.department_id')
    .leftJoin('job_titles as jt', 'jt.id', 'v.job_title_id')
    .whereIn('v.status', LIVE_VACANCY_STATUSES)
    .where(db.raw('v.positions > v.filled'))
    .select(
      'p.name as property',
      'd.name as department',
      'jt.title as role',
      'v.created_at',
      db.raw('v.positions - v.filled as open_count')
    )
    .orderBy('v.created_at', 'asc');

  const today = new Date();
  const positionsWithDays = openPositions.map((p: any) => ({
    ...p,
    days_open: Math.floor((today.getTime() - new Date(p.created_at).getTime()) / 86400000),
  }));

  return {
    totalEmployees: headcount,
    propertyCount: Number(propertyCount?.c ?? 0),
    byProperty,
    byDepartment,
    staffByProperty,
    openPositions: positionsWithDays,
  };
}

// ─── Section B: Attrition Analysis ───

export async function getAttritionAnalysis(dateFrom: string, dateTo: string) {
  const totalActive = await db('employees').where('is_active', true).count('* as c').first();
  const activeCount = Number(totalActive?.c ?? 0);

  // Total exits in range
  const exits = await db('employee_exits')
    .whereBetween('exit_date', [dateFrom, dateTo])
    .count('* as c').first();
  const exitCount = Number(exits?.c ?? 0);
  const attritionRate = activeCount > 0 ? ((exitCount / (activeCount + exitCount)) * 100) : 0;

  // Monthly trend — last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const trendStart = sixMonthsAgo.toISOString().split('T')[0];

  const monthlyTrend = await db('employee_exits')
    .where('exit_date', '>=', trendStart)
    .select(
      db.raw("substr(exit_date, 1, 7) as month"),
      db.raw("count(*) as exits")
    )
    .groupBy(db.raw("substr(exit_date, 1, 7)"))
    .orderBy('month');

  // By property
  const byProperty = await db('employee_exits as ee')
    .join('employees as e', 'e.id', 'ee.employee_id')
    .whereBetween('ee.exit_date', [dateFrom, dateTo])
    .whereNotNull('e.branch_name')
    .select(
      'e.branch_name as property',
      db.raw("count(*) as exits")
    )
    .groupBy('e.branch_name')
    .orderBy('exits', 'desc');

  // By department
  const byDepartment = await db('employee_exits as ee')
    .join('employees as e', 'e.id', 'ee.employee_id')
    .whereBetween('ee.exit_date', [dateFrom, dateTo])
    .whereNotNull('e.dept_name')
    .select(
      'e.dept_name as department',
      db.raw("count(*) as exits")
    )
    .groupBy('e.dept_name')
    .orderBy('exits', 'desc');

  // By reason
  const byReason = await db('employee_exits')
    .whereBetween('exit_date', [dateFrom, dateTo])
    .select('exit_reason as reason')
    .count('* as count')
    .groupBy('exit_reason')
    .orderBy('count', 'desc');

  return {
    totalExits: exitCount,
    attritionRate: Math.round(attritionRate * 10) / 10,
    monthlyTrend,
    byProperty,
    byDepartment,
    byReason,
  };
}

// ─── Section C: Attendance & Productivity ───

export async function getAttendanceProductivity(dateFrom: string, dateTo: string) {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.slice(0, 7) + '-01';

  // Today's attendance by property
  const todayByProperty = await db('attendance_records as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.date', today)
    .where('e.is_active', true)
    .whereNotNull('e.branch_name')
    .select(
      'e.branch_name as property',
      db.raw("count(*) as total"),
      db.raw("sum(case when ar.status = 'present' or ar.status = 'half_day' then 1 else 0 end) as present"),
      db.raw("sum(case when ar.status = 'absent' then 1 else 0 end) as absent"),
      db.raw("sum(case when ar.status = 'on_leave' then 1 else 0 end) as on_leave"),
      db.raw("round(100.0 * sum(case when ar.status = 'present' or ar.status = 'half_day' then 1 else 0 end) / count(*), 1) as pct_present")
    )
    .groupBy('e.branch_name')
    .orderBy('e.branch_name');

  // Daily attendance trend (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const trendStart = thirtyDaysAgo.toISOString().split('T')[0];

  const totalActive = await db('employees').where('is_active', true).count('* as c').first();
  const headcount = Number(totalActive?.c ?? 0);

  const dailyTrend = await db('attendance_records')
    .where('date', '>=', trendStart)
    .select(
      'date',
      db.raw("count(*) as total"),
      db.raw("sum(case when status = 'present' or status = 'half_day' then 1 else 0 end) as present"),
      db.raw("sum(case when status = 'absent' then 1 else 0 end) as absent")
    )
    .groupBy('date')
    .orderBy('date');

  const dailyTrendWithPct = dailyTrend.map((d: any) => ({
    ...d,
    pct: headcount > 0 ? Math.round((Number(d.present) / headcount) * 1000) / 10 : 0,
  }));

  // Late arrival trend (last 30 days)
  const lateTrend = await db('attendance_records')
    .where('date', '>=', trendStart)
    .whereNotNull('check_in')
    .select(
      'date',
      db.raw("count(*) as total_checkins"),
      db.raw("sum(case when substr(check_in, 12, 5) > '10:00' then 1 else 0 end) as late_count")
    )
    .groupBy('date')
    .orderBy('date');

  // Average late arrival time MTD
  const avgLate = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .whereNotNull('check_in')
    .where(db.raw("substr(check_in, 12, 5) > '10:00'"))
    .select(db.raw("substr(check_in, 12, 5) as time"))
    .limit(500);

  let avgLateTime = '--:--';
  if (avgLate.length > 0) {
    const totalMins = avgLate.reduce((sum: number, r: any) => {
      const [h, m] = (r.time || '00:00').split(':').map(Number);
      return sum + h * 60 + m;
    }, 0);
    const avg = Math.round(totalMins / avgLate.length);
    avgLateTime = `${String(Math.floor(avg / 60)).padStart(2, '0')}:${String(avg % 60).padStart(2, '0')}`;
  }

  // MTD absenteeism
  const mtdAbsent = await db('attendance_records')
    .whereBetween('date', [monthStart, today])
    .select(
      db.raw("count(*) as total"),
      db.raw("sum(case when status = 'absent' then 1 else 0 end) as absent")
    ).first();
  const absenteeismMtd = Number(mtdAbsent?.total) > 0
    ? Math.round((Number(mtdAbsent?.absent ?? 0) / Number(mtdAbsent?.total)) * 1000) / 10 : 0;

  // Today's overall
  const todaySummary = await db('attendance_records')
    .where('date', today)
    .select(
      db.raw("count(*) as total"),
      db.raw("sum(case when status = 'present' or status = 'half_day' then 1 else 0 end) as present")
    ).first();
  const todayPct = headcount > 0
    ? Math.round((Number(todaySummary?.present ?? 0) / headcount) * 1000) / 10 : 0;

  return {
    todayPct,
    absenteeismMtd,
    todayByProperty,
    dailyTrend: dailyTrendWithPct,
    lateTrend,
    avgLateTime,
    headcount,
  };
}

// ─── Section D: Property-Wise Employee Status ───

export async function getPropertyEmployeeStatus(
  statusTab: string,
  date: string,
  property?: string,
  department?: string,
  page: number = 1,
  limit: number = 25
) {
  const offset = (page - 1) * limit;

  if (statusTab === 'exited') {
    let query = db('employee_exits as ee')
      .join('employees as e', 'e.id', 'ee.employee_id')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .select(
        'e.branch_name as property',
        'e.first_name', 'e.last_name',
        'e.employee_code',
        'jt.title as role',
        'e.dept_name as department',
        'ee.exit_date as last_working_day',
        'ee.exit_reason as exit_type'
      )
      .orderBy('ee.exit_date', 'desc');

    if (property) query = query.where('e.branch_name', property);
    if (department) query = query.where('e.dept_name', department);

    const countQ = query.clone().clearSelect().clearOrder().count('* as c').first();
    const rows = await query.limit(limit).offset(offset);
    const total = Number((await countQ)?.c ?? 0);

    return { rows, total, page, limit };
  }

  // on_leave is sourced from approved leave requests overlapping the date
  if (statusTab === 'on_leave') {
    let query = db('leave_requests as lr')
      .join('employees as e', 'e.id', 'lr.employee_id')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .leftJoin('leave_types as lt', 'lt.id', 'lr.leave_type_id')
      .where('lr.status', 'approved')
      .where('lr.start_date', '<=', date)
      .where('lr.end_date', '>=', date)
      .where('e.is_active', true)
      .select(
        'e.branch_name as property',
        'e.first_name', 'e.last_name', 'e.employee_code',
        'jt.title as role', 'e.dept_name as department',
        'lt.name as leave_type', 'lr.start_date', 'lr.end_date',
      )
      .orderBy('e.branch_name')
      .orderBy('e.first_name');

    if (property) query = query.where('e.branch_name', property);
    if (department) query = query.where('e.dept_name', department);

    const countQ = query.clone().clearSelect().clearOrder().count('* as c').first();
    const rows = await query.limit(limit).offset(offset);
    const total = Number((await countQ)?.c ?? 0);
    return { rows, total, page, limit };
  }

  // present, absent
  const statusMap: Record<string, string[]> = {
    present: ['present', 'half_day'],
    absent: ['absent'],
  };
  const statuses = statusMap[statusTab] || ['present'];

  let query = db('attendance_records as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('ar.date', date)
    .where('e.is_active', true)
    .whereIn('ar.status', statuses)
    .select(
      'e.branch_name as property',
      'e.first_name', 'e.last_name',
      'e.employee_code',
      'jt.title as role',
      'e.dept_name as department',
      'ar.check_in',
      'ar.check_out',
      'ar.status',
      'ar.working_hours'
    )
    .orderBy('e.branch_name')
    .orderBy('e.first_name');

  if (property) query = query.where('e.branch_name', property);
  if (department) query = query.where('e.dept_name', department);

  const countQ = query.clone().clearSelect().clearOrder().count('* as c').first();
  const rows = await query.limit(limit).offset(offset);
  const total = Number((await countQ)?.c ?? 0);

  return { rows, total, page, limit };
}

// ─── Property Analytics summary (counts per property for a given day) ───

export async function getPropertyAnalytics(dateParam?: string) {
  // Dates that actually have attendance — used for the picker and to default to
  // the most recent day with data (rather than "today", which is often empty).
  const availableDates: string[] = await db('attendance_records')
    .distinct('date')
    .orderBy('date', 'desc')
    .limit(60)
    .pluck('date');

  const fallback = new Date().toISOString().split('T')[0];
  const date = dateParam || availableDates[0] || fallback;

  // Active headcount per property
  const headcounts = await db('employees')
    .where('is_active', true)
    .whereNotNull('branch_name')
    .select('branch_name as property')
    .count('* as headcount')
    .groupBy('branch_name');

  // Attendance for the selected day per property/location (uploaded attendance
  // location takes precedence over the employee's home branch).
  const attendance = await db('attendance_records as ar')
    .join('employees as e', 'e.id', 'ar.employee_id')
    .where('ar.date', date)
    .where('e.is_active', true)
    .select(
      db.raw("COALESCE(ar.location, e.branch_name) as property"),
      db.raw("sum(case when ar.status = 'present' or ar.status = 'half_day' then 1 else 0 end) as present"),
      db.raw("sum(case when ar.status = 'absent' then 1 else 0 end) as absent"),
    )
    .groupByRaw("COALESCE(ar.location, e.branch_name)");

  // On-leave comes from approved leave requests overlapping the date (not attendance)
  const onLeave = await db('leave_requests as lr')
    .join('employees as e', 'e.id', 'lr.employee_id')
    .where('lr.status', 'approved')
    .where('lr.start_date', '<=', date)
    .where('lr.end_date', '>=', date)
    .where('e.is_active', true)
    .whereNotNull('e.branch_name')
    .select('e.branch_name as property')
    .count('* as on_leave')
    .groupBy('e.branch_name');

  // All-time exits per property
  const exits = await db('employee_exits as ee')
    .join('employees as e', 'e.id', 'ee.employee_id')
    .whereNotNull('e.branch_name')
    .select('e.branch_name as property')
    .count('* as exited')
    .groupBy('e.branch_name');

  type Row = {
    property: string; headcount: number; present: number; absent: number;
    on_leave: number; exited: number;
  };
  const map = new Map<string, Row>();
  const ensure = (p: string): Row => {
    if (!map.has(p)) {
      map.set(p, { property: p, headcount: 0, present: 0, absent: 0, on_leave: 0, exited: 0 });
    }
    return map.get(p)!;
  };

  headcounts.forEach((h: any) => { ensure(h.property).headcount = Number(h.headcount); });
  attendance.forEach((a: any) => {
    const r = ensure(a.property);
    r.present = Number(a.present);
    r.absent = Number(a.absent);
  });
  onLeave.forEach((l: any) => { ensure(l.property).on_leave = Number(l.on_leave); });
  exits.forEach((x: any) => { ensure(x.property).exited = Number(x.exited); });

  const byProperty = Array.from(map.values())
    .map((r) => {
      const unmarked = Math.max(0, r.headcount - r.present - r.absent - r.on_leave);
      const pct_present = r.headcount > 0 ? Math.round((1000 * r.present) / r.headcount) / 10 : 0;
      return {
        property: r.property,
        headcount: r.headcount,
        present: r.present,
        absent: r.absent,
        on_leave: r.on_leave,
        unmarked,
        exited: r.exited,
        pct_present,
      };
    })
    .sort((a, b) => b.headcount - a.headcount);

  const totals = byProperty.reduce(
    (t, r) => ({
      headcount: t.headcount + r.headcount,
      present: t.present + r.present,
      absent: t.absent + r.absent,
      on_leave: t.on_leave + r.on_leave,
      unmarked: t.unmarked + r.unmarked,
      exited: t.exited + r.exited,
    }),
    { headcount: 0, present: 0, absent: 0, on_leave: 0, unmarked: 0, exited: 0 },
  );
  const pct_present = totals.headcount > 0
    ? Math.round((1000 * totals.present) / totals.headcount) / 10 : 0;

  return { date, availableDates, totals: { ...totals, pct_present }, byProperty };
}

// ─── Layer 3: Drilldown ───

export async function getDrilldown(
  type: string,
  filter: string,
  dateFrom?: string,
  dateTo?: string
) {
  // type: property, department, exit_property, exit_department
  // filter: the property name or department name
  if (type === 'property') {
    return db('employees as e')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .where('e.is_active', true)
      .where('e.branch_name', filter)
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'jt.title as role', 'e.dept_name as department',
        'e.date_of_joining', 'e.phone', 'e.email'
      )
      .orderBy('e.first_name');
  }

  if (type === 'department') {
    return db('employees as e')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .where('e.is_active', true)
      .where('e.dept_name', filter)
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'jt.title as role', 'e.branch_name as property',
        'e.date_of_joining', 'e.phone', 'e.email'
      )
      .orderBy('e.first_name');
  }

  if (type === 'exit_property') {
    return db('employee_exits as ee')
      .join('employees as e', 'e.id', 'ee.employee_id')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .where('e.branch_name', filter)
      .modify((qb: any) => {
        if (dateFrom && dateTo) qb.whereBetween('ee.exit_date', [dateFrom, dateTo]);
      })
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'jt.title as role', 'e.dept_name as department',
        'ee.exit_date', 'ee.exit_reason', 'e.phone', 'e.email'
      )
      .orderBy('ee.exit_date', 'desc');
  }

  if (type === 'exit_department') {
    return db('employee_exits as ee')
      .join('employees as e', 'e.id', 'ee.employee_id')
      .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
      .where('e.dept_name', filter)
      .modify((qb: any) => {
        if (dateFrom && dateTo) qb.whereBetween('ee.exit_date', [dateFrom, dateTo]);
      })
      .select(
        'e.id', 'e.employee_code', 'e.first_name', 'e.last_name',
        'jt.title as role', 'e.branch_name as property',
        'ee.exit_date', 'ee.exit_reason', 'e.phone', 'e.email'
      )
      .orderBy('ee.exit_date', 'desc');
  }

  return [];
}

// ─── Keep old endpoints for backward compat ───

export async function getHeadcountSummary() {
  const total = await db('employees').where('is_active', true).count('* as count').first();

  const byBranch = await db('employees')
    .where('is_active', true)
    .whereNotNull('branch_name')
    .select('branch_name as property')
    .count('* as count')
    .groupBy('branch_name')
    .orderBy('count', 'desc');

  const byDepartment = await db('employees')
    .where('is_active', true)
    .whereNotNull('dept_name')
    .select('dept_name as department')
    .count('* as count')
    .groupBy('dept_name')
    .orderBy('count', 'desc');

  const byJobTitle = await db('employees')
    .join('job_titles', 'job_titles.id', 'employees.job_title_id')
    .where('employees.is_active', true)
    .select('job_titles.title as job_title')
    .count('* as count')
    .groupBy('job_titles.id')
    .orderBy('count', 'desc')
    .limit(10);

  return {
    total: total?.count ?? 0,
    byProperty: byBranch,
    byDepartment,
    byCategory: [],
    byJobTitle,
  };
}

export async function getAttendanceSummary(dateFrom: string, dateTo: string) {
  const summary = await db('attendance_records')
    .whereBetween('date', [dateFrom, dateTo])
    .select(
      db.raw("count(*) as total_records"),
      db.raw("sum(case when status = 'present' then 1 else 0 end) as present"),
      db.raw("sum(case when status = 'absent' then 1 else 0 end) as absent"),
      db.raw("sum(case when status = 'half_day' then 1 else 0 end) as half_day"),
      db.raw("sum(case when status = 'on_leave' then 1 else 0 end) as on_leave"),
      // working_hours is a float column; Postgres only defines round(numeric, int), so cast.
      db.raw("round(avg(working_hours)::numeric, 1) as avg_working_hours")
    )
    .first();

  const byProperty = await db('attendance_records')
    .join('employees', 'employees.id', 'attendance_records.employee_id')
    .whereBetween('attendance_records.date', [dateFrom, dateTo])
    .whereNotNull('employees.branch_name')
    .select(
      'employees.branch_name as property',
      db.raw("count(*) as total"),
      db.raw("sum(case when attendance_records.status = 'present' then 1 else 0 end) as present"),
      db.raw("round(100.0 * sum(case when attendance_records.status = 'present' then 1 else 0 end) / count(*), 1) as attendance_pct")
    )
    .groupBy('employees.branch_name');

  const dailyTrend = await db('attendance_records')
    .whereBetween('date', [dateFrom, dateTo])
    .select(
      'date',
      db.raw("sum(case when status = 'present' then 1 else 0 end) as present"),
      db.raw("sum(case when status = 'absent' then 1 else 0 end) as absent"),
      db.raw("count(*) as total")
    )
    .groupBy('date')
    .orderBy('date');

  return { summary, byProperty, dailyTrend };
}

export async function getLeaveSummary(dateFrom: string, dateTo: string) {
  const byType = await db('leave_requests')
    .join('leave_types', 'leave_types.id', 'leave_requests.leave_type_id')
    .whereBetween('leave_requests.start_date', [dateFrom, dateTo])
    .select(
      'leave_types.name as leave_type',
      db.raw("count(*) as requests"),
      db.raw("sum(leave_requests.days) as total_days"),
      db.raw("sum(case when leave_requests.status = 'approved' then 1 else 0 end) as approved"),
      db.raw("sum(case when leave_requests.status = 'rejected' then 1 else 0 end) as rejected"),
      db.raw("sum(case when leave_requests.status = 'pending' then 1 else 0 end) as pending")
    )
    .groupBy('leave_types.id');

  const byProperty = await db('leave_requests')
    .join('employees', 'employees.id', 'leave_requests.employee_id')
    .whereBetween('leave_requests.start_date', [dateFrom, dateTo])
    .whereNotNull('employees.branch_name')
    .select(
      'employees.branch_name as property',
      db.raw("sum(leave_requests.days) as total_days"),
      db.raw("count(*) as requests")
    )
    .groupBy('employees.branch_name');

  const monthlyTrend = await db('leave_requests')
    .whereBetween('start_date', [dateFrom, dateTo])
    .where('status', 'approved')
    .select(
      db.raw("substr(start_date, 1, 7) as month"),
      db.raw("sum(days) as total_days"),
      db.raw("count(*) as requests")
    )
    .groupBy(db.raw("substr(start_date, 1, 7)"))
    .orderBy('month');

  return { byType, byProperty, monthlyTrend };
}

export async function getRecruitmentSummary() {
  const vacancyStats = await db('vacancies')
    .select(
      db.raw("count(*) as total_vacancies"),
      db.raw("sum(case when status in ('new_role','listed') then 1 else 0 end) as open_vacancies"),
      db.raw("sum(positions) as total_positions"),
      db.raw("sum(filled) as total_filled")
    )
    .first();

  const pipelineStages = await db('candidates')
    .select('stage')
    .count('* as count')
    .groupBy('stage');

  const byProperty = await db('vacancies')
    .join('properties', 'properties.id', 'vacancies.property_id')
    .select(
      'properties.name as property',
      db.raw("count(*) as vacancies"),
      db.raw("sum(vacancies.positions) as positions"),
      db.raw("sum(vacancies.filled) as filled")
    )
    .groupBy('properties.id');

  return { vacancyStats, pipelineStages, byProperty };
}

export async function getAttritionSummary(dateFrom: string, dateTo: string) {
  return getAttritionAnalysis(dateFrom, dateTo);
}

export async function getDashboardOverview() {
  const today = new Date().toISOString().split('T')[0];
  const totalEmployees = await db('employees').where('is_active', true).count('* as count').first();

  const presentToday = await db('attendance_records')
    .where('date', today)
    .where('status', 'present')
    .count('* as count')
    .first();

  const onLeaveToday = await db('leave_requests')
    .where('status', 'approved')
    .where('start_date', '<=', today)
    .where('end_date', '>=', today)
    .count('* as count')
    .first();

  const pendingLeaves = await db('leave_requests')
    .where('status', 'pending')
    .count('* as count')
    .first();

  const openVacancies = await db('vacancies')
    .whereIn('status', LIVE_VACANCY_STATUSES)
    .count('* as count')
    .first();

  // Active pipeline only — a candidate archived on rejection has left recruitment, so
  // counting them would make "Total Candidates" drift up and never come back down.
  const totalCandidates = await db('candidates').where('archived', false).count('* as count').first();

  const recentHires = await db('employees')
    .where('is_active', true)
    .orderBy('date_of_joining', 'desc')
    .limit(5)
    .select('id', 'first_name', 'last_name', 'date_of_joining', 'employee_code');

  return {
    totalEmployees: totalEmployees?.count ?? 0,
    presentToday: presentToday?.count ?? 0,
    onLeaveToday: onLeaveToday?.count ?? 0,
    pendingLeaves: pendingLeaves?.count ?? 0,
    openVacancies: openVacancies?.count ?? 0,
    totalCandidates: totalCandidates?.count ?? 0,
    recentHires,
  };
}

// ─── Personal analytics (the logged-in employee's own attendance & leave) ───

/** IST calendar month (YYYY-MM), offset months back. Day-pinned to avoid month overflow. */
function istMonth(offset = 0): string {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short' });
}

const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * Every code `getMonthSummary` buckets, in the order the screens show them.
 *
 * This list used to be four long — present, absent, half_day, on_leave — while getMonthSummary
 * returned eight. The four it dropped (no_punch, short_punch, miss_punch, hhd) still counted
 * towards `total`, so the dashboard tiles could not add up to the month and the percentage divided
 * by days no tile showed. Mirrors client/src/lib/attendanceCodes.ts.
 */
const SUMMARY_CODES = [
  'present', 'no_punch', 'half_day', 'short_punch', 'miss_punch', 'hhd', 'absent', 'on_leave',
] as const;

async function attendanceForMonth(employeeId: number, month: string) {
  const s: any = await getMonthSummary(employeeId, month);
  const counts = Object.fromEntries(
    SUMMARY_CODES.map((code) => [code, Number(s?.[code] ?? 0)]),
  ) as Record<(typeof SUMMARY_CODES)[number], number>;

  const total = Number(s?.total ?? 0);
  const avg_working_hours = Number(s?.avg_working_hours ?? 0) || 0;

  // Days the person was expected to work. Approved leave is not a failure to attend, so scoring
  // attendance against a denominator that includes it reports 0% for somebody on sanctioned leave
  // all month. Null (not 0) when there were no working days at all, so the client can say so
  // rather than render a damning zero.
  const working_days = Math.max(0, total - counts.on_leave);
  return {
    ...counts,
    total,
    working_days,
    avg_working_hours,
    present_pct: working_days > 0 ? pctOf(counts.present, working_days) : null,
  };
}

const ZERO_ATTENDANCE = {
  ...Object.fromEntries(SUMMARY_CODES.map((c) => [c, 0])) as Record<(typeof SUMMARY_CODES)[number], number>,
  total: 0, working_days: 0, avg_working_hours: 0, present_pct: null as number | null,
};

async function leaveBalancesFor(employeeId: number) {
  let balances: any[] = [];
  try { balances = await getMyBalances(employeeId); } catch { balances = []; }
  // getMyBalances returns EffectiveBalance rows (allocated / available / taken / pending).
  // "Used" here is whatever no longer counts as available, so used + remaining === total
  // for both allocation sources: an entitlement's used_days counter, or (taken + pending)
  // on the default_days path where pending reserves balance.
  return balances.map((b: any) => {
    const total_days = Number(b.allocated ?? 0);
    const remaining = Math.max(0, Number(b.available ?? 0));
    return { leave_type: b.leave_type, total_days, used_days: Math.max(0, total_days - remaining), remaining, is_paid: !!b.is_paid };
  });
}

/**
 * One employee's own attendance and leave for a month.
 *
 * `monthArg` is optional and defaults to the current IST month, which is what every caller sent
 * before it existed — so adding it changed nothing for them. Validated here rather than in the
 * controller so the guard travels with the function: without it an unparseable month becomes the
 * bounds 'abc-01'..'abc-31' and returns a silently empty month instead of an error.
 *
 * `month` stays in the response as the honest echo of which month was actually answered.
 */
export async function getMyOverview(employeeId: number | null, monthArg?: string) {
  const month = monthArg ? assertMonth(monthArg) : istMonth(0);
  if (!employeeId) {
    return { month, attendance: { ...ZERO_ATTENDANCE }, leave: { balances: [], total_days: 0, used_days: 0, remaining: 0, pending_count: 0 } };
  }

  const attendance = await attendanceForMonth(employeeId, month);
  const balances = await leaveBalancesFor(employeeId);
  const total_days = balances.reduce((a, b) => a + b.total_days, 0);
  const used_days = balances.reduce((a, b) => a + b.used_days, 0);

  let pending_count = 0;
  try { pending_count = (await getMyLeaves(employeeId, { status: 'pending' })).length; } catch { pending_count = 0; }

  return {
    month,
    attendance,
    leave: { balances, total_days, used_days, remaining: Math.max(0, total_days - used_days), pending_count },
  };
}

export async function getMyTrends(employeeId: number | null, months = 6) {
  const n = Math.min(Math.max(1, months), 12);
  const list = Array.from({ length: n }, (_, i) => istMonth(n - 1 - i)); // oldest → newest

  if (!employeeId) {
    return {
      attendanceTrend: list.map((m) => ({ month: m, label: monthLabel(m), ...ZERO_ATTENDANCE })),
      leaveByType: [],
    };
  }

  const attendanceTrend = [];
  for (const m of list) {
    attendanceTrend.push({ month: m, label: monthLabel(m), ...(await attendanceForMonth(employeeId, m)) });
  }

  const balances = await leaveBalancesFor(employeeId);
  const leaveByType = balances.map((b) => ({ leave_type: b.leave_type, used: b.used_days, remaining: b.remaining, total: b.total_days }));

  return { attendanceTrend, leaveByType };
}
