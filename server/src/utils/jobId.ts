import type { Knex } from 'knex';

/**
 * Next unique JOB ID (JOB-000123). Every employee/position gets one. Callers that
 * insert an employee should pass their transaction so the max is read consistently.
 */
export async function nextJobId(cx: Knex | Knex.Transaction): Promise<string> {
  const rows = await cx('employees').whereNotNull('job_id').where('job_id', 'like', 'JOB-%').select('job_id');
  let max = 0;
  for (const r of rows as any[]) {
    const m = /JOB-(\d+)/.exec(r.job_id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `JOB-${String(max + 1).padStart(6, '0')}`;
}
