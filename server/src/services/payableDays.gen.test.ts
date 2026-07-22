import { describe, it, expect } from 'vitest';
import * as payableDays from './payableDays.service';

// ─────────────────────────────────────────────────────────────────────────────
// payableDays.service.ts exposes NO exported PURE functions.
//
// Every exported function is async and reads the live DB:
//   • buildWorkCalendar        — queries employees / shift assignments / holidays
//   • countWorkingDaysInRange  — builds a work calendar (DB)
//   • getOvertimeHours         — queries employee_shift_assignments / attendance
//   • getMonthlyHours          — sums attendance_records.working_hours
//   • computePayableDays       — queries attendance + leave, then prorates
//
// The genuinely pure math / date / proration helpers are all module-PRIVATE and
// therefore not importable for isolated unit testing:
//   pad, round2, shiftDurationHours, dowOf, addDaysIso, mondayOf, and the
//   paidRatio / paymentDays proration inside computePayableDays.
//
// Per the task contract this is the "no safely-testable pure functions" case
// (noPureFns = true). This placeholder documents the module surface and stays
// green WITHOUT touching the database — knex/better-sqlite3 opens no connection
// until a query actually runs, and none of these assertions run one.
// ─────────────────────────────────────────────────────────────────────────────

describe('payableDays.service module surface', () => {
  it('exports the db-backed engine functions', () => {
    expect(typeof payableDays.buildWorkCalendar).toBe('function');
    expect(typeof payableDays.countWorkingDaysInRange).toBe('function');
    expect(typeof payableDays.getOvertimeHours).toBe('function');
    expect(typeof payableDays.getMonthlyHours).toBe('function');
    expect(typeof payableDays.computePayableDays).toBe('function');
  });

  it('exposes no exported pure helper (proration/rounding stays db-gated)', () => {
    const exported = Object.keys(payableDays);
    for (const name of ['pad', 'round2', 'shiftDurationHours', 'dowOf', 'addDaysIso', 'mondayOf']) {
      expect(exported).not.toContain(name);
    }
  });
});
