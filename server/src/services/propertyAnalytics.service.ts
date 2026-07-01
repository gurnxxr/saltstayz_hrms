import db from '../config/database';
import { JwtPayload } from '../types';
import { getScope, suggestedSalary, listPropertyBudgets } from './manpower.service';

// ─────────────────────────────────────────────────────────────────────────────
// Property Analytics — sanctioned vs committed budget & headcount, salary variance,
// attrition, backfill, and the exception log. Per property / cluster / org-wide.
// All reads are scoped per-user (admin/chro: all; cluster_hr: their clusters;
// property_manager: their property).
// ─────────────────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const today = () => new Date().toISOString().split('T')[0];

interface Filters { cluster_id?: number; property_id?: number; }

async function scopeNames(user: JwtPayload): Promise<string[] | null> {
  const scope = await getScope(user);
  if (scope.all) return null; // null = no restriction
  return scope.propertyNames.length ? scope.propertyNames : ['__none__'];
}

// committed (Σ monthly_ctc) + filled (count) per (branch_name, job_title_id), non-Left
async function committedMap() {
  const agg = await db('employees')
    .whereNot('employment_status', 'left')
    .select('branch_name', 'job_title_id')
    .sum({ committed: 'monthly_ctc' })
    .count({ cnt: '*' })
    .groupBy('branch_name', 'job_title_id');
  const map = new Map<string, { committed: number; filled: number }>();
  for (const a of agg as any[]) {
    map.set(`${a.branch_name}|${a.job_title_id}`, { committed: round2(Number(a.committed || 0)), filled: Number(a.cnt || 0) });
  }
  return map;
}

async function sanctionRows(filters: Filters, names: string[] | null) {
  const q = db('manpower_sanctions as s')
    .join('properties as p', 'p.id', 's.property_id')
    .join('job_titles as jt', 'jt.id', 's.job_title_id')
    .leftJoin('clusters as c', 'c.id', 'p.cluster_id')
    .select('s.*', 'p.name as property_name', 'p.cluster_id', 'c.name as cluster_name', 'jt.title as job_title');
  if (names) q.whereIn('p.name', names);
  if (filters.property_id) q.where('s.property_id', filters.property_id);
  if (filters.cluster_id) q.where('p.cluster_id', filters.cluster_id);
  return q;
}

// ─── Budget: sanctioned vs committed vs remaining (property / cluster / org) ───

export async function budgetOverview(filters: Filters, user: JwtPayload) {
  // Property-level budgets (explicit Budget-Control override, else role roll-up) —
  // the same source the Manpower module table uses, so analytics stays consistent.
  let rows = await listPropertyBudgets({ cluster_id: filters.cluster_id }, user) as any[];
  if (filters.property_id) rows = rows.filter((r) => r.property_id === filters.property_id);

  const byClusterMap = new Map<string, any>();
  const totals = { sanctioned_amount: 0, committed_amount: 0, sanctioned_headcount: 0, filled: 0 };

  for (const r of rows) {
    totals.sanctioned_amount += r.sanctioned_budget_monthly;
    totals.committed_amount += r.committed_amount;
    totals.sanctioned_headcount += r.sanctioned_headcount;
    totals.filled += r.filled_headcount;

    const cKey = r.cluster_name || 'Unassigned';
    if (!byClusterMap.has(cKey)) byClusterMap.set(cKey, { cluster: cKey, sanctioned_amount: 0, committed_amount: 0, sanctioned_headcount: 0, filled: 0 });
    const cr = byClusterMap.get(cKey);
    cr.sanctioned_amount += r.sanctioned_budget_monthly; cr.committed_amount += r.committed_amount;
    cr.sanctioned_headcount += r.sanctioned_headcount; cr.filled += r.filled_headcount;
  }

  const finalize = (r: any) => ({
    ...r,
    sanctioned_amount: round2(r.sanctioned_amount),
    committed_amount: round2(r.committed_amount),
    remaining_amount: round2(r.sanctioned_amount - r.committed_amount),
    open: r.sanctioned_headcount - r.filled,
    utilization_pct: r.sanctioned_amount > 0 ? round2((r.committed_amount / r.sanctioned_amount) * 100) : 0,
    over_budget: r.committed_amount > r.sanctioned_amount,
    over_headcount: r.filled > r.sanctioned_headcount,
  });

  return {
    totals: finalize(totals),
    byProperty: rows.map((r) => ({
      property: r.property_name, cluster: r.cluster_name || 'Unassigned',
      sanctioned_amount: r.sanctioned_budget_monthly, committed_amount: r.committed_amount,
      remaining_amount: r.remaining_budget, sanctioned_headcount: r.sanctioned_headcount,
      filled: r.filled_headcount, open: r.remaining_slots, utilization_pct: r.utilization_pct,
      over_budget: r.over_budget, over_headcount: r.over_headcount,
    })).sort((a, b) => b.committed_amount - a.committed_amount),
    byCluster: Array.from(byClusterMap.values()).map(finalize).sort((a, b) => b.committed_amount - a.committed_amount),
  };
}

// ─── Headcount sanctioned / filled / open, by role ───

export async function headcountByRole(filters: Filters, user: JwtPayload) {
  const names = await scopeNames(user);
  const [sanctions, cm] = await Promise.all([sanctionRows(filters, names), committedMap()]);
  const byRole = new Map<string, any>();
  for (const s of sanctions as any[]) {
    const m = cm.get(`${s.property_name}|${s.job_title_id}`) || { committed: 0, filled: 0 };
    if (!byRole.has(s.job_title)) byRole.set(s.job_title, { role: s.job_title, sanctioned_headcount: 0, filled: 0, sanctioned_amount: 0, committed_amount: 0 });
    const r = byRole.get(s.job_title);
    r.sanctioned_headcount += Number(s.sanctioned_headcount);
    r.filled += m.filled;
    r.sanctioned_amount += Number(s.sanctioned_budget_monthly);
    r.committed_amount += m.committed;
  }
  return Array.from(byRole.values()).map((r) => ({
    ...r,
    open: r.sanctioned_headcount - r.filled,
    sanctioned_amount: round2(r.sanctioned_amount),
    committed_amount: round2(r.committed_amount),
  })).sort((a, b) => b.sanctioned_headcount - a.sanctioned_headcount);
}

// ─── Salary variance: committed above sanctioned band, by hire and by HR ───

export async function salaryVariance(filters: Filters, user: JwtPayload) {
  const names = await scopeNames(user);
  const q = db('employees as e')
    .join('manpower_sanctions as s', function () {
      this.on('s.job_title_id', '=', 'e.job_title_id');
    })
    .join('properties as p', function () {
      this.on('p.id', '=', 's.property_id').andOn('p.name', '=', 'e.branch_name');
    })
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('users as cu', 'cu.id', 'e.created_by_user_id')
    .leftJoin('users as au', 'au.id', 'e.approved_by_user_id')
    .whereNot('e.employment_status', 'left')
    .whereNotNull('e.monthly_ctc')
    .whereRaw('e.monthly_ctc > s.band_max')
    .select(
      'e.id', 'e.first_name', 'e.last_name', 'e.employee_code', 'e.branch_name',
      'jt.title as job_title', 'e.monthly_ctc', 's.band_max',
      db.raw('(e.monthly_ctc - s.band_max) as variance'),
      'cu.email as hired_by', 'au.email as approved_by'
    );
  if (names) q.whereIn('e.branch_name', names);
  if (filters.property_id) q.where('p.id', filters.property_id);
  if (filters.cluster_id) q.where('p.cluster_id', filters.cluster_id);
  const hires = await q.orderBy('variance', 'desc');

  const byHr = new Map<string, { hired_by: string; total_variance: number; count: number }>();
  let total = 0;
  for (const h of hires as any[]) {
    const v = round2(Number(h.variance));
    total += v;
    const key = h.hired_by || 'Unknown';
    if (!byHr.has(key)) byHr.set(key, { hired_by: key, total_variance: 0, count: 0 });
    const r = byHr.get(key)!; r.total_variance = round2(r.total_variance + v); r.count += 1;
  }
  return {
    total_variance: round2(total),
    count: hires.length,
    byHire: hires.map((h: any) => ({ ...h, variance: round2(Number(h.variance)), monthly_ctc: Number(h.monthly_ctc), band_max: Number(h.band_max) })),
    byHr: Array.from(byHr.values()).sort((a, b) => b.total_variance - a.total_variance),
  };
}

// ─── Attrition: rate, short-notice exits, avg tenure (window = last N months) ───

export async function attrition(filters: Filters, user: JwtPayload, months = 12) {
  const names = await scopeNames(user);
  const since = new Date(); since.setMonth(since.getMonth() - months);
  const sinceStr = since.toISOString().split('T')[0];

  const scopeWhere = (qb: any, col = 'e.branch_name') => {
    if (names) qb.whereIn(col, names);
    if (filters.property_id) qb.where('p.id', filters.property_id);
    if (filters.cluster_id) qb.where('p.cluster_id', filters.cluster_id);
  };

  // Left within the window
  const leftQ = db('employees as e').leftJoin('properties as p', 'p.name', 'e.branch_name')
    .where('e.employment_status', 'left').where('e.last_working_day', '>=', sinceStr);
  scopeWhere(leftQ);
  const leftRows = await leftQ.select('e.id', 'e.date_of_joining', 'e.last_working_day', 'e.branch_name', 'e.job_title_id');

  // Active now
  const activeQ = db('employees as e').leftJoin('properties as p', 'p.name', 'e.branch_name')
    .whereNot('e.employment_status', 'left');
  scopeWhere(activeQ);
  const activeCount = Number((await activeQ.count({ c: '*' }).first())?.c || 0);

  const leftCount = leftRows.length;
  const denom = leftCount + activeCount;

  let tenureSum = 0, tenureN = 0;
  for (const r of leftRows as any[]) {
    if (r.date_of_joining && r.last_working_day) {
      const days = (new Date(r.last_working_day).getTime() - new Date(r.date_of_joining).getTime()) / 86400000;
      if (days >= 0) { tenureSum += days; tenureN += 1; }
    }
  }

  // Short-notice: gap between the move to on_notice/left and the last working day < 15 days
  let shortNotice = 0;
  if (leftRows.length) {
    const ids = leftRows.map((r: any) => r.id);
    const hist = await db('employee_status_history')
      .whereIn('employee_id', ids).whereIn('to_status', ['on_notice', 'left'])
      .select('employee_id', 'created_at').orderBy('created_at', 'asc');
    const firstNotice = new Map<number, string>();
    for (const h of hist as any[]) if (!firstNotice.has(h.employee_id)) firstNotice.set(h.employee_id, h.created_at);
    for (const r of leftRows as any[]) {
      const noticed = firstNotice.get(r.id);
      if (noticed && r.last_working_day) {
        const gap = (new Date(r.last_working_day).getTime() - new Date(noticed).getTime()) / 86400000;
        if (gap < 15) shortNotice += 1;
      }
    }
  }

  return {
    window_months: months,
    left_count: leftCount,
    active_count: activeCount,
    attrition_rate_pct: denom > 0 ? round2((leftCount / denom) * 100) : 0,
    short_notice_count: shortNotice,
    avg_tenure_months: tenureN > 0 ? round2((tenureSum / tenureN) / 30.4375) : 0,
  };
}

// ─── Backfill: positions freed by Left, still open ───

export async function backfill(filters: Filters, user: JwtPayload) {
  const names = await scopeNames(user);
  const q = db('employees as e')
    .leftJoin('properties as p', 'p.name', 'e.branch_name')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.open_to_backfill', true)
    .select('e.id', 'e.first_name', 'e.last_name', 'e.branch_name', 'jt.title as job_title', 'e.last_working_day');
  if (names) q.whereIn('e.branch_name', names);
  if (filters.property_id) q.where('p.id', filters.property_id);
  if (filters.cluster_id) q.where('p.cluster_id', filters.cluster_id);
  const rows = await q.orderBy('e.last_working_day', 'asc');
  const now = Date.now();
  const list = (rows as any[]).map((r) => ({
    ...r,
    days_open: r.last_working_day ? Math.max(0, Math.round((now - new Date(r.last_working_day).getTime()) / 86400000)) : null,
  }));
  return {
    open_count: list.length,
    avg_days_open: list.length ? round2(list.reduce((s, r) => s + (r.days_open || 0), 0) / list.length) : 0,
    positions: list,
  };
}

// ─── Exception log: count + ₹ value of approvals ───

export async function exceptionLog(filters: Filters, user: JwtPayload) {
  const names = await scopeNames(user);
  const base = () => {
    const q = db('manpower_exceptions as x').join('properties as p', 'p.id', 'x.property_id');
    if (names) q.whereIn('p.name', names);
    if (filters.property_id) q.where('x.property_id', filters.property_id);
    if (filters.cluster_id) q.where('p.cluster_id', filters.cluster_id);
    return q;
  };
  const byStatus = await base().select('x.status').count({ cnt: '*' }).sum({ value: 'x.variance_amount' }).groupBy('x.status');
  const summary: Record<string, { count: number; value: number }> = { pending: { count: 0, value: 0 }, approved: { count: 0, value: 0 }, rejected: { count: 0, value: 0 } };
  for (const r of byStatus as any[]) summary[r.status] = { count: Number(r.cnt || 0), value: round2(Number(r.value || 0)) };

  const recent = await base()
    .join('job_titles as jt', 'jt.id', 'x.job_title_id')
    .leftJoin('users as ru', 'ru.id', 'x.requested_by')
    .select('x.*', 'p.name as property_name', 'jt.title as job_title', 'ru.email as requested_by_email')
    .orderBy('x.created_at', 'desc').limit(50);

  return { summary, recent };
}

// expose for parity with other analytics consumers
export { suggestedSalary };
