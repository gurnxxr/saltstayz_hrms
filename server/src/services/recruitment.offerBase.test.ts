import { describe, it, expect } from 'vitest';
import { assertOfferedBase } from './recruitment.service';
import { ValidationError } from '../utils/errors';

/**
 * The offered monthly base had no floor anywhere on the write path.
 *
 * The controllers coerce a missing, empty or non-numeric base to 0 (`Number(x) || 0`), and
 * `breakdownFor` substitutes the designation template's `default_base` for any base <= 0 — so an
 * offer letter got filed at a figure nobody chose, with the adjustment recorded as 0.00% so it
 * read as deliberate. That base is cloned onto the employee's salary structure on acceptance,
 * which makes it what payroll pays.
 *
 * Neither existing gate caught it: the statutory minimum-wage check is a no-op for any state with
 * no configured wage, and the sanctioned band only has a maximum, which 0 clears trivially.
 */
describe('assertOfferedBase', () => {
  it('passes a valid base through byte-identical, so no existing offer moves by a rupee', () => {
    for (const v of [1, 19500, 25000.5, '19500', 1e6]) {
      expect(assertOfferedBase(v)).toBe(Number(v));
    }
  });

  it('refuses the values the controllers turn into 0', () => {
    // Every one of these arrived at the service as 0 and silently priced the letter from the template.
    for (const v of [undefined, null, '', '   ', 'abc', {}, [], NaN, 0, '0']) {
      expect(() => assertOfferedBase(v)).toThrow(ValidationError);
    }
  });

  it('refuses a negative base', () => {
    expect(() => assertOfferedBase(-1)).toThrow(ValidationError);
    expect(() => assertOfferedBase('-25000')).toThrow(ValidationError);
  });

  it('refuses Infinity, which survives the controllers\' `|| 0`', () => {
    // `Infinity || 0` is truthy, so this reached the service intact and produced an
    // annual_ctc of Infinity, which JSON.stringify writes into the snapshot as null.
    expect(() => assertOfferedBase(Infinity)).toThrow(ValidationError);
    expect(() => assertOfferedBase(1e999)).toThrow(ValidationError);
  });

  it('names what to do, not what went wrong', () => {
    expect(() => assertOfferedBase(0)).toThrow(/offered monthly base salary/i);
  });
});
