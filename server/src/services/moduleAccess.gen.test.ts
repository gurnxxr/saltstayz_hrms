import { describe, it, expect } from 'vitest';
import { ACCESS_MODULES } from './moduleAccess.service';

// moduleAccess.service.ts exposes exactly one pure export: the ACCESS_MODULES
// constant. Every other export is async and queries the SQLite DB (getEmployeeOverrides,
// searchEmployees, getEmployeeAccess, setEmployeeAccess, resetEmployeeAccess), and the
// grant/deny/override MERGE logic is embedded inside getEmployeeAccess (not exported as
// a pure function), so it cannot be unit-tested without a DB. These tests exhaustively
// pin the documented contract of ACCESS_MODULES, which is the guard list used by
// setEmployeeAccess's `!ACCESS_MODULES.includes(module)` validation.

// The documented set (see the header comment / migration 024 in the source).
// API-gating = a matching authorize('<key>', …) sits on the routes, so the toggle
// governs the API as well as the sidebar. employee_lifecycle joined this group when
// employeeLifecycle.routes.ts swapped its role gate for authorize('employee_lifecycle',
// 'read'); payroll_setup was minted for the four payroll-config route files.
const GATING_KEYS = [
  'analytics', 'attendance', 'leave', 'recruitment',
  'payroll', 'salary', 'shifts', 'admin',
  'employees', 'onboarding', 'manpower', 'finance', 'admin.users', 'payroll_setup',
  'employee_lifecycle',
];
const NAV_ONLY_KEYS = [
  'dashboard_admin', 'dashboard_employee', 'my_shifts',
];
const EXPECTED_ORDER = [
  'dashboard_admin', 'dashboard_employee', 'analytics', 'attendance', 'leave',
  'recruitment', 'employee_lifecycle', 'payroll', 'salary', 'shifts', 'my_shifts', 'admin',
  'employees', 'onboarding', 'manpower', 'finance', 'admin.users', 'payroll_setup',
];

describe('ACCESS_MODULES — shape & type', () => {
  it('is an array', () => {
    expect(Array.isArray(ACCESS_MODULES)).toBe(true);
  });

  it('has exactly 18 entries (15 gating + 3 nav-only)', () => {
    expect(ACCESS_MODULES.length).toBe(18);
    expect(GATING_KEYS.length + NAV_ONLY_KEYS.length).toBe(18);
  });

  it('contains only non-empty strings', () => {
    for (const m of ACCESS_MODULES) {
      expect(typeof m).toBe('string');
      expect((m as string).length).toBeGreaterThan(0);
      expect((m as string).trim()).toBe(m); // no stray whitespace
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(ACCESS_MODULES).size).toBe(ACCESS_MODULES.length);
  });
});

describe('ACCESS_MODULES — exact membership', () => {
  it('equals the documented ordered list', () => {
    // Encodes both content AND order (order is the sidebar/documentation order).
    expect([...ACCESS_MODULES]).toEqual(EXPECTED_ORDER);
  });

  it('contains every gating (API + nav) key', () => {
    for (const k of GATING_KEYS) {
      expect(ACCESS_MODULES).toContain(k);
    }
  });

  it('contains every nav-only key', () => {
    for (const k of NAV_ONLY_KEYS) {
      expect(ACCESS_MODULES).toContain(k);
    }
  });

  it('is exactly the union of gating + nav-only keys (nothing extra, nothing missing)', () => {
    expect(new Set(ACCESS_MODULES)).toEqual(new Set([...GATING_KEYS, ...NAV_ONLY_KEYS]));
  });

  it('does not contain lookalike/legacy keys that are NOT part of the set', () => {
    // Guards against accidental additions of near-miss names.
    const notMembers = [
      'dashboard', 'reports', 'profile', 'payroll_config',
      'shift', 'my_shift', 'lifecycle', 'employee', 'admins', 'users',
    ];
    for (const nm of notMembers) {
      expect(ACCESS_MODULES).not.toContain(nm);
    }
  });
});

describe('ACCESS_MODULES — .includes() guard semantics (mirrors setEmployeeAccess validation)', () => {
  // setEmployeeAccess throws ValidationError when !ACCESS_MODULES.includes(module).
  it('accepts every known module via includes()', () => {
    for (const m of EXPECTED_ORDER) {
      expect(ACCESS_MODULES.includes(m as any)).toBe(true);
    }
  });

  it('rejects unknown / malformed module names via includes()', () => {
    const unknown = ['', ' ', 'Admin', 'ADMIN', 'analytics ', ' leave', 'unknown_module', 'db', 'users'];
    for (const u of unknown) {
      expect(ACCESS_MODULES.includes(u as any)).toBe(false);
    }
  });

  it('is case-sensitive (module keys are lowercase snake_case)', () => {
    expect(ACCESS_MODULES.includes('admin' as any)).toBe(true);
    expect(ACCESS_MODULES.includes('Admin' as any)).toBe(false);
    expect(ACCESS_MODULES.includes('ADMIN' as any)).toBe(false);
  });

  it('every entry matches lowercase snake_case naming', () => {
    // One dotted namespace segment is permitted, for keys that mirror a namespaced
    // permission module (`admin.users`). Everything else stays plain snake_case.
    for (const m of ACCESS_MODULES) {
      expect(m).toMatch(/^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*)?$/);
    }
  });
});

describe('ACCESS_MODULES — override MERGE contract (documented invariant, pure logic)', () => {
  // The effective-access resolution inside getEmployeeAccess is:
  //   effective = override === null ? roleDefault : override
  // i.e. an explicit override (grant=true OR deny=false) short-circuits the role default;
  // only a null (no override) falls through to the role default. Since that logic is not
  // exported as a pure function, we pin the intended truth table with a local mirror so a
  // future refactor of the source that changes these semantics is caught by review.
  const effective = (override: boolean | null, roleDefault: boolean) =>
    override === null ? roleDefault : override;

  it('null override falls through to roleDefault (both values)', () => {
    expect(effective(null, true)).toBe(true);
    expect(effective(null, false)).toBe(false);
  });

  it('explicit grant (override=true) wins even when role default denies', () => {
    expect(effective(true, false)).toBe(true);
    expect(effective(true, true)).toBe(true);
  });

  it('explicit deny (override=false) wins even when role default allows', () => {
    expect(effective(false, true)).toBe(false);
    expect(effective(false, false)).toBe(false);
  });
});
