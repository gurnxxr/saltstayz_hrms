import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import { join } from 'path';
import { diffMigrations } from '../utils/schemaVersion';

/**
 * The check that would have made 2026-08-03 a one-line deploy log instead of a broken page.
 *
 * Production had run migration 001 and nothing since. `employees.pan_number` arrives in 007, so
 * every request to the employees list failed — as a bare 500, because a missing column is a plain
 * pg Error rather than an AppError. The API answered /health cheerfully throughout.
 */
describe('diffMigrations', () => {
  const ON_DISK = ['001_a.ts', '002_b.ts', '003_c.ts'];

  it('is happy when every file has been applied', () => {
    const s = diffMigrations(ON_DISK, ['001_a.ts', '002_b.ts', '003_c.ts']);
    expect(s.ok).toBe(true);
    expect(s.pending).toEqual([]);
    expect(s.applied).toBe(3);
  });

  it('names exactly what is missing, in order', () => {
    // The real shape of the outage: the baseline applied, nothing after it.
    const s = diffMigrations(ON_DISK, ['001_a.ts']);
    expect(s.ok).toBe(false);
    expect(s.pending).toEqual(['002_b.ts', '003_c.ts']);
    expect(s.applied).toBe(1);
  });

  it('spots a gap in the middle, not just a truncated tail', () => {
    const s = diffMigrations(ON_DISK, ['001_a.ts', '003_c.ts']);
    expect(s.pending).toEqual(['002_b.ts']);
  });

  it('reports migrations applied that this build does not ship', () => {
    // Older code deployed over a newer database, or a rollback. Not "pending", but worth saying.
    const s = diffMigrations(ON_DISK, ['001_a.ts', '002_b.ts', '003_c.ts', '004_future.ts']);
    expect(s.ok).toBe(true);
    expect(s.unknown).toEqual(['004_future.ts']);
  });

  it('treats an empty database as entirely behind', () => {
    const s = diffMigrations(ON_DISK, []);
    expect(s.ok).toBe(false);
    expect(s.pending).toEqual(ON_DISK);
  });
});

describe('the names compared are the ones knex records', () => {
  it('every migration on disk is a .ts file', () => {
    // knex records migrations by FILENAME, and production's rows all end in .ts because they run
    // through tsx against src/. Compiling them to dist/ and running the .js output would leave
    // knex comparing 001_baseline_postgres.js against a recorded .ts, deciding all 33 are pending,
    // and replaying the whole history onto a database that already has it. This test exists so
    // that change fails here rather than on a deploy.
    const dir = join(__dirname, '../db/migrations');
    const files = readdirSync(dir).filter((f) => /^\d+_/.test(f));
    expect(files.length).toBeGreaterThan(30);
    expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
  });
});
