import { describe, it, expect } from 'vitest';
import { nextJobId } from './jobId';

/**
 * jobId.ts exposes exactly ONE exported function: nextJobId(cx).
 * It is NOT pure — it reads the `employees` table via the Knex connection `cx`
 * to find the current max JOB-NNNNNN and returns max+1 zero-padded to 6 digits.
 *
 * The pure, testable behaviour we care about (per the task) is the
 * padding/format + max-extraction arithmetic. That logic is inline inside the
 * async DB function and is not separately exported, so there is no importable
 * pure function (noPureFns=true).
 *
 * To exercise the REAL source arithmetic deterministically — without touching
 * the live data/hrms.db — we pass a fully in-memory stub `cx` that mimics the
 * Knex query-builder chain used by nextJobId:
 *     cx('employees').whereNotNull('job_id').where('job_id','like','JOB-%').select('job_id')
 * The stub simply resolves `.select()` with canned rows. No real DB is read,
 * written, migrated, or seeded.
 */

type Row = { job_id: string | null };

/** Minimal Knex-like stub: any builder method returns the builder;
 *  `.select()` resolves to the canned rows (the only awaited call). */
function makeCx(rows: Row[]) {
  const qb: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'select') return () => Promise.resolve(rows);
        // whereNotNull / where / any chainable builder method → return builder
        return () => qb;
      },
    }
  );
  // cx is invoked as cx('employees')
  return ((_table: string) => qb) as any;
}

describe('nextJobId — format & padding (JOB-000123)', () => {
  it('returns JOB-000001 for the very first id when no rows exist', async () => {
    expect(await nextJobId(makeCx([]))).toBe('JOB-000001');
  });

  it('increments a single existing id (JOB-000122 -> JOB-000123, the canonical example)', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000122' }]))).toBe('JOB-000123');
  });

  it('increments from JOB-000001 -> JOB-000002', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000001' }]))).toBe('JOB-000002');
  });

  it('always zero-pads to exactly 6 digits', async () => {
    const out = await nextJobId(makeCx([]));
    const digits = out.slice('JOB-'.length);
    expect(digits).toHaveLength(6);
    expect(out).toMatch(/^JOB-\d{6}$/);
  });

  it('picks the maximum across many rows regardless of order', async () => {
    const rows = [
      { job_id: 'JOB-000005' },
      { job_id: 'JOB-000042' },
      { job_id: 'JOB-000017' },
      { job_id: 'JOB-000003' },
    ];
    expect(await nextJobId(makeCx(rows))).toBe('JOB-000043');
  });

  it('parses leading zeros as decimal (not octal): JOB-000010 -> JOB-000011', async () => {
    // Number('000010') === 10 (decimal), not 8. Guards against octal misparse.
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000010' }]))).toBe('JOB-000011');
    // JOB-000008 has a digit (8) that would be invalid octal — confirm decimal parse.
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000008' }]))).toBe('JOB-000009');
  });

  it('rolls the last digit correctly at a multiple-of-ten boundary (JOB-000019 -> JOB-000020)', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000019' }]))).toBe('JOB-000020');
  });

  it('rolls a width boundary (JOB-000099 -> JOB-000100)', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000099' }]))).toBe('JOB-000100');
  });

  it('handles a value already at the full 6-digit width (JOB-999998 -> JOB-999999)', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-999998' }]))).toBe('JOB-999999');
  });

  it('overflows past 6 digits without truncating (padStart never shortens): JOB-999999 -> JOB-1000000', async () => {
    // padStart(6) is a no-op once the number already has >=6 digits.
    expect(await nextJobId(makeCx([{ job_id: 'JOB-999999' }]))).toBe('JOB-1000000');
  });

  it('ignores rows whose job_id has no digits after the prefix (JOB-abc is skipped)', async () => {
    // The `like 'JOB-%'` filter can admit non-numeric suffixes; the /JOB-(\d+)/
    // regex requires >=1 digit, so such rows contribute nothing to max.
    const rows = [{ job_id: 'JOB-abc' }, { job_id: 'JOB-000007' }];
    expect(await nextJobId(makeCx(rows))).toBe('JOB-000008');
  });

  it('when ALL rows are non-numeric, falls back to the first id JOB-000001', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-abc' }, { job_id: 'JOB-xyz' }]))).toBe('JOB-000001');
  });

  it('extracts the numeric run even when a suffix follows (JOB-000050-A -> JOB-000051)', async () => {
    // Regex /JOB-(\d+)/ captures the leading digit run "000050".
    expect(await nextJobId(makeCx([{ job_id: 'JOB-000050-A' }]))).toBe('JOB-000051');
  });

  it('uses the numeric max, not lexical/string ordering', async () => {
    // Lexically "JOB-000009" > "JOB-000010"; numerically 10 wins.
    const rows = [{ job_id: 'JOB-000009' }, { job_id: 'JOB-000010' }];
    expect(await nextJobId(makeCx(rows))).toBe('JOB-000011');
  });

  it('a single large in-range value increments correctly (JOB-123456 -> JOB-123457)', async () => {
    expect(await nextJobId(makeCx([{ job_id: 'JOB-123456' }]))).toBe('JOB-123457');
  });

  it('always returns a string with the JOB- prefix', async () => {
    const out = await nextJobId(makeCx([{ job_id: 'JOB-000200' }]));
    expect(typeof out).toBe('string');
    expect(out.startsWith('JOB-')).toBe(true);
  });
});
