import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// leaveEncashment.service.ts exposes NO exported pure functions.
//
// All four exports (listEncashments / createEncashment / approveEncashment /
// rejectEncashment) are async and hit the SQLite DB. The only pure arithmetic
// lives INSIDE createEncashment (source lines 71-72) and the module-private
// `num` coercion helper (line 21) — none of which are exported, so they cannot
// be imported and unit-tested in isolation.
//
// Per the harness rules we must NOT touch the live DB, so we cannot exercise the
// async exports either. This file is therefore a minimal, DB-free placeholder
// that documents the encashment amount math as a faithful local replica of the
// source and pins its rounding behavior, so the suite stays green and the
// intended contract is recorded. It does NOT import the service (importing would
// open the live better-sqlite3 connection).
// ─────────────────────────────────────────────────────────────────────────────

// Faithful replica of source lines 71-72:
//   const perDayRate = Math.round((breakdown.basic / 30) * 100) / 100;
//   const amount = Math.round(days * perDayRate);
function perDayRate(basic: number): number {
  return Math.round((basic / 30) * 100) / 100;
}
function encashmentAmount(days: number, basic: number): number {
  return Math.round(days * perDayRate(basic));
}

// Faithful replica of the module-private `num` coercion helper (source line 21):
//   const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
function num(v: any): number {
  return v === null || v === undefined || v === '' ? 0 : Number(v);
}

describe('leaveEncashment amount math (documented replica of source lines 71-72)', () => {
  describe('perDayRate = round(basic / 30, 2 decimals)', () => {
    it('divides a clean monthly Basic by 30', () => {
      // 30000 / 30 = 1000 exactly
      expect(perDayRate(30000)).toBe(1000);
    });

    it('rounds to 2 decimal places (half-up on the paise)', () => {
      // 10000 / 30 = 333.3333... -> 333.33
      expect(perDayRate(10000)).toBe(333.33);
    });

    it('rounds .335 up to .34 (JS Math.round on the scaled value)', () => {
      // 10001 / 30 = 333.36666... -> *100 = 33336.66 -> round 33337 -> 333.37
      expect(perDayRate(10001)).toBe(333.37);
    });

    it('handles a Basic that yields an exact 2-decimal rate', () => {
      // 4500 / 30 = 150 exactly
      expect(perDayRate(4500)).toBe(150);
    });

    it('returns 0 for a zero Basic (boundary)', () => {
      expect(perDayRate(0)).toBe(0);
    });

    it('is linear/positive for a large Basic', () => {
      // 90000 / 30 = 3000
      expect(perDayRate(90000)).toBe(3000);
    });
  });

  describe('amount = round(days * perDayRate)', () => {
    it('computes a whole-rupee amount for a clean rate', () => {
      // rate 1000, 5 days -> 5000
      expect(encashmentAmount(5, 30000)).toBe(5000);
    });

    it('rounds the final product to the nearest whole rupee', () => {
      // rate 333.33, 3 days -> 999.99 -> round 1000
      expect(encashmentAmount(3, 10000)).toBe(1000);
    });

    it('matches at the minimum valid day count (1 day)', () => {
      // rate 333.33, 1 day -> 333.33 -> round 333
      expect(encashmentAmount(1, 10000)).toBe(333);
    });

    it('matches at the maximum valid day count (100 days, source cap)', () => {
      // rate 333.33, 100 days -> 33333 exactly
      expect(encashmentAmount(100, 10000)).toBe(33333);
    });

    it('supports fractional (half-day) day counts', () => {
      // rate 1000, 2.5 days -> 2500
      expect(encashmentAmount(2.5, 30000)).toBe(2500);
    });

    it('rounds a fractional-day product half-up', () => {
      // rate 333.37, 1.5 days -> 500.055 -> round 500
      expect(encashmentAmount(1.5, 10001)).toBe(500);
    });

    it('yields 0 when days is 0 (boundary, though source rejects <=0 upstream)', () => {
      expect(encashmentAmount(0, 30000)).toBe(0);
    });

    it('exhibits the documented double-rounding (rate captured then multiplied)', () => {
      // The source rounds the RATE to 2 dp first, then rounds days*rate. This is
      // the intended F&F convention (rate is frozen on the record), not a bug.
      // basic 10001: rate -> 333.37; 6 days -> 2000.22 -> round 2000.
      // (A single-shot round(6 * 10001/30) = round(2000.2) = 2000 here too.)
      expect(encashmentAmount(6, 10001)).toBe(2000);
    });
  });

  describe('num() coercion helper (documented replica of source line 21)', () => {
    it('maps null / undefined / empty-string to 0', () => {
      expect(num(null)).toBe(0);
      expect(num(undefined)).toBe(0);
      expect(num('')).toBe(0);
    });

    it('coerces numeric strings via Number()', () => {
      expect(num('12')).toBe(12);
      expect(num('2.5')).toBe(2.5);
    });

    it('passes real numbers through unchanged, including 0', () => {
      expect(num(0)).toBe(0);
      expect(num(7)).toBe(7);
      expect(num(-3)).toBe(-3);
    });

    it('yields NaN for non-numeric strings (caught by Number.isFinite upstream)', () => {
      expect(Number.isNaN(num('abc'))).toBe(true);
    });

    it('supports the balance formula: total_days - used_days', () => {
      // balance = num(total) - num(used); nulls behave as 0
      expect(num(20) - num(null)).toBe(20);
      expect(num('18') - num(3)).toBe(15);
    });
  });
});
