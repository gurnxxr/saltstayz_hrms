import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AUDIENCE_META, AUDIENCES, EVENTS, getEvent, isAudience } from './notificationEvents';

/**
 * The migration and the catalogue must not drift apart.
 *
 * Migration 032 seeds the ticked boxes as LITERALS — deliberately, because a migration is frozen
 * history and must produce the same rows in a year. The cost of that is nothing stops somebody
 * renaming an event key in the catalogue and quietly orphaning its seeded default, which would
 * present as "we used to notify the manager and now we notify nobody" with no error anywhere.
 *
 * These read the migration file as text and check the pairs it seeds against the catalogue. No
 * database needed: it is the two source files that have to agree.
 */
const MIGRATION = readFileSync(
  join(__dirname, '../db/migrations/032_notification_settings.ts'), 'utf-8',
);

/** The `['event.key', 'audience'],` rows out of the DEFAULTS array. */
function seededDefaults(): Array<[string, string]> {
  const block = MIGRATION.split('const DEFAULTS')[1]?.split('];')[0] ?? '';
  return [...block.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)]
    .map((m) => [m[1], m[2]] as [string, string]);
}

describe('notification defaults — migration 032 vs the catalogue', () => {
  const defaults = seededDefaults();

  it('parses the seeded pairs at all', () => {
    // Guards the regex itself: if the migration is reformatted so nothing matches, every
    // assertion below would vacuously pass.
    expect(defaults.length).toBeGreaterThanOrEqual(10);
  });

  it('every seeded event key exists in the catalogue', () => {
    const orphans = defaults.map(([key]) => key).filter((key) => !getEvent(key));
    expect(orphans).toEqual([]);
  });

  it('every seeded audience is a real audience', () => {
    const unknown = defaults.map(([, audience]) => audience).filter((a) => !isAudience(a));
    expect(unknown).toEqual([]);
  });

  it('does not tick a property-scoped audience on an event with no employee', () => {
    // Such a tick could never resolve to anybody — the grid greys these cells for the same reason.
    const scoped = new Set(AUDIENCE_META.filter((a) => a.scoped).map((a) => a.key as string));
    const impossible = defaults.filter(
      ([key, audience]) => scoped.has(audience) && getEvent(key)?.carriesEmployee === false,
    );
    expect(impossible).toEqual([]);
  });

  it('reproduces the recipients the code used before the settings grid existed', () => {
    // The one assertion that protects the migration: these five are what the hardcoded calls did,
    // so if any disappears somebody's inbox went quiet on the day this shipped.
    const pairs = new Set(defaults.map(([k, a]) => `${k}:${a}`));
    expect(pairs).toContain('leave.applied:reporting_manager');
    expect(pairs).toContain('attendance.regularisation_raised:reporting_manager');
    expect(pairs).toContain('shift.change_requested:reporting_manager');
    expect(pairs).toContain('manpower.exception_raised:admin');
    expect(pairs).toContain('employee.login_needed:admin');
    // notifyReplacementNeeded blasted BOTH roles; scoping it down is a decision for the grid,
    // not something this migration should make on anybody's behalf.
    expect(pairs).toContain('employee.replacement_needed:hr');
    expect(pairs).toContain('employee.replacement_needed:admin');
  });

  it('leaves every other event unticked', () => {
    // Anything not listed above notified nobody before, so it must notify nobody now. Ticking a
    // box is HR's decision to make on the page, not one to arrive with.
    const ticked = new Set(defaults.map(([key]) => key));
    const expected = new Set([
      'leave.applied', 'attendance.regularisation_raised', 'shift.change_requested',
      'employee.replacement_needed', 'manpower.exception_raised', 'employee.joined',
      'employee.login_needed',
      // The two exceptions, both new emit points where nothing fired before: a backup that fails
      // every night in silence is the gap this work exists to close.
      'system.backup_failed', 'system.auto_attendance_failed',
    ]);
    expect([...ticked].sort()).toEqual([...expected].sort());
  });
});

describe('the catalogue itself', () => {
  it('has no duplicate event keys', () => {
    const keys = EVENTS.map((e) => e.key);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('keeps every event key inside notifications.type\'s 40-char column', () => {
    // event_key is its own column, but the keys are short by design so a payload type derived
    // from one can never overflow the varchar(40) the bell reads.
    const tooLong = EVENTS.filter((e) => e.key.length > 40).map((e) => e.key);
    expect(tooLong).toEqual([]);
  });

  it('describes every audience exactly once', () => {
    expect(AUDIENCE_META.map((a) => a.key).sort()).toEqual([...AUDIENCES].sort());
  });

  it('marks the three role tiers as unscoped', () => {
    // These have no org scoping anywhere in the system, and the page has to say so — ticking HR
    // notifies every HR user at every property.
    const unscoped = AUDIENCE_META.filter((a) => !a.scoped).map((a) => a.key);
    expect(unscoped.sort()).toEqual(['admin', 'finance', 'hr']);
  });
});
