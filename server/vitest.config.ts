import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Run test FILES one at a time.
     *
     * Almost every test here is pure, but two are not: `payableDays.db.test.ts` and
     * `leave.holidays.db.test.ts` both talk to the same throwaway database, and both have to
     * pin global configuration to mean anything — the org work week, and
     * `pay_schedule_settings.work_pattern_effective_from`, which is a single row that decides
     * whether ANY off-day pattern applies to a date.
     *
     * Run in parallel, they overwrite each other's setup mid-assertion: one sets the clamp to
     * 2026-07-01 to prove patterns cannot re-price history, which retroactively disables the
     * other's off-day rules and turns a rest day into a working day. The failure is intermittent
     * and looks like a bug in the code under test, which is the worst kind.
     *
     * The suite is only a few seconds either way, so correctness wins. Tests WITHIN a file still
     * run normally; this only stops two files racing for the same rows.
     */
    fileParallelism: false,
  },
});
