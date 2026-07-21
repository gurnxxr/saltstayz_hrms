import type { Knex } from 'knex';
import { LOCK, advisoryXactLock, isTransaction } from './locks';

/**
 * Next unique JOB ID (JOB-000123). Every employee/position gets one. Callers that insert an employee
 * should pass their transaction — under PostgreSQL's MVCC two concurrent callers would otherwise
 * read the same max and mint the same id. With a transaction we take an advisory lock and serialise;
 * without one we fall back to the UNIQUE constraint on employees.job_id, which fails loudly rather
 * than allowing a duplicate.
 */
export async function nextJobId(cx: Knex | Knex.Transaction): Promise<string> {
  if (isTransaction(cx)) await advisoryXactLock(cx, LOCK.JOB_ID);
  const rows = await cx('employees').whereNotNull('job_id').where('job_id', 'like', 'JOB-%').select('job_id');
  let max = 0;
  for (const r of rows as any[]) {
    const m = /JOB-(\d+)/.exec(r.job_id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `JOB-${String(max + 1).padStart(6, '0')}`;
}
