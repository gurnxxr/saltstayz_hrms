import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The three lists of attendance codes must stay identical.
 *
 * They live apart for good reasons — the SQL buckets in `getMonthSummary`, the projection in
 * `analytics.service.ts`, and the client's display vocabulary — and nothing but this test stops
 * them drifting. Drift is not hypothetical: `attendanceForMonth` shipped counting four of the
 * eight codes the SQL returned, so `hhd`, `no_punch`, `short_punch` and `miss_punch` days were
 * added into the month total and then shown on no screen at all. The dashboard tiles could not sum
 * to the month, and the attendance percentage divided by days no tile accounted for.
 *
 * Read as text rather than imported because the client is a separate workspace and the SQL is a
 * raw string. What matters is the SET of codes, not how each file spells its list.
 */

const SERVER = join(__dirname, '..');
const CLIENT = join(__dirname, '../../../client/src');

const read = (p: string) => readFileSync(p, 'utf-8');

/** The codes counted by getMonthSummary's CASE ladder. */
function sqlBuckets(): string[] {
  const src = read(join(SERVER, 'services/attendance.service.ts'));
  const fn = src.split('export async function getMonthSummary')[1]?.split('\n}')[0] ?? '';
  return [...fn.matchAll(/WHEN status = '([a-z_]+)'/g)].map((m) => m[1]);
}

/** The codes the analytics layer forwards to the client. */
function analyticsCodes(): string[] {
  const src = read(join(SERVER, 'services/analytics.service.ts'));
  const block = src.split('const SUMMARY_CODES = [')[1]?.split(']')[0] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** The codes the screens render. */
function clientCodes(): string[] {
  const src = read(join(CLIENT, 'lib/attendanceCodes.ts'));
  const block = src.split('export const ATTENDANCE_CODES')[1]?.split('\n];')[0] ?? '';
  return [...block.matchAll(/^\s*code: '([a-z_]+)'/gm)].map((m) => m[1]);
}

describe('attendance codes — one vocabulary across the stack', () => {
  const sql = sqlBuckets();
  const analytics = analyticsCodes();
  const client = clientCodes();

  it('finds all three lists', () => {
    // Guards the parsing itself: if a file is restructured so a regex matches nothing, every
    // comparison below would pass on two empty arrays.
    expect(sql.length).toBe(8);
    expect(analytics.length).toBe(8);
    expect(client.length).toBe(8);
  });

  it('is the same set of eight everywhere', () => {
    const expected = [
      'absent', 'half_day', 'hhd', 'miss_punch', 'no_punch', 'on_leave', 'present', 'short_punch',
    ];
    expect([...sql].sort()).toEqual(expected);
    expect([...analytics].sort()).toEqual(expected);
    expect([...client].sort()).toEqual(expected);
  });

  it('forwards every bucket the SQL counts', () => {
    // The specific regression: SQL counted eight, the projection kept four, and the difference
    // vanished silently into `total`.
    const dropped = sql.filter((c) => !analytics.includes(c));
    expect(dropped).toEqual([]);
  });

  it('renders every code the server sends', () => {
    const unrendered = analytics.filter((c) => !client.includes(c));
    expect(unrendered).toEqual([]);
  });

  it('invents no code the record cannot hold', () => {
    // A tile for a status nothing ever writes would always read zero and quietly imply otherwise.
    const invented = client.filter((c) => !sql.includes(c));
    expect(invented).toEqual([]);
  });

  it('does not treat weekly_off as a record status', () => {
    // weekly_off is an attendance_pay_rules code derived from the work calendar; the grid importer
    // deliberately skips it and it is never stored on attendance_records.
    expect(client).not.toContain('weekly_off');
    expect(sql).not.toContain('weekly_off');
  });

  it('gives every client code a distinct badge', () => {
    const src = read(join(CLIENT, 'lib/attendanceCodes.ts'));
    const block = src.split('export const ATTENDANCE_CODES')[1]?.split('\n];')[0] ?? '';
    const badges = [...block.matchAll(/badge: '([A-Z]+)'/g)].map((m) => m[1]);
    expect(badges.length).toBe(8);
    expect(new Set(badges).size).toBe(8);
  });
});
