# Database Rules

## PostgreSQL (migrated from SQLite)

Connect via `DATABASE_URL` (`config/database.ts`, Knex client `pg`). Managed hosts such as Neon
require SSL — that is handled by `env.DATABASE_SSL`. There are no pragmas: Postgres enforces foreign
keys natively and handles concurrent writers with MVCC, so the old WAL/`busy_timeout` setup is gone.

**The traps that bit us migrating off SQLite — do NOT reintroduce:**

| Don't | Do |
|-------|-----|
| `const [id] = await db('t').insert(data)` | `const [{ id }] = await db('t').insert(data).returning('id')` — a bare insert returns nothing |
| `.where('is_active', 1)` / `is_active: 0` | `true` / `false` — these are real `boolean` columns, and Postgres rejects integers |
| `.where(col, 'like', term)` for search | `.where(col, 'ilike', term)` — Postgres `LIKE` is case-sensitive |
| `strftime('%Y', d)` | `substr(d, 1, 4)` (business dates are TEXT — see below) |
| `date(created_at)` | `created_at::date` (`created_at`/`updated_at` are real `timestamptz`) |
| `COALESCE(bool_col, 0) = 0` | `COALESCE(bool_col, false) = false` |
| `round(avg(float_col), 1)` | `round(avg(float_col)::numeric, 1)` — Postgres only defines `round(numeric, int)` |
| `VACUUM INTO` | `pg_dump` (see `backup.service.ts`) |
| `IFNULL` | `COALESCE` |

**Column type conventions (deliberate):**
- **Business dates/times stay TEXT** — `date`, `start_date`, `check_in`, `log_datetime`, … The app
  writes and compares them as strings (`'2026-07-21'`, `'09:30'`) and slices them with `substr()`.
  Keeping them text preserved that logic through the migration.
- **`created_at` / `updated_at` are real `timestamptz`**, as are Better Auth's date columns.
- **Booleans are real `boolean`.** A few flags are intentionally `integer` (`statutory_settings.enabled`,
  `salary_components.is_system`, `sort_order`) — check the baseline before "fixing" a 0/1 there.

## Concurrency (Postgres is MVCC — SQLite serialised writers)

"Read a total, decide, then insert" is **not** safe on its own any more: two transactions each see the
state from before the other started. Use the advisory locks in `utils/locks.ts` for those paths — see
`manpower.service.ts:createHire` (hiring guardrail), `leave.service.ts:applyLeave` (balance + overlap),
and the `MH-####`/`JOB-######` code generators.

## Knex Query Builder

```typescript
import db from '../config/database';

// Select with join
db('employees as e')
  .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
  .select('e.*', 'jt.title as designation_name')

// Insert — MUST ask for the id
const [{ id }] = await db('table').insert({ col: 'val' }).returning('id');

// Upsert
await db('table').insert(data).onConflict(['key_col']).merge();
// (the read-then-branch form is still used in places; it needs a lock to be race-safe)
```

## Migrations

One squashed baseline — `001_baseline_postgres.ts` — creates the whole schema. The 82 original SQLite
migrations are kept for reference in `db/migrations-sqlite-archive/` and are **not** run. New changes
go in as normal forward migrations on top of the baseline.

`db/migrate-sqlite-to-pg.ts` is the one-time data copy from the legacy SQLite file (converts 0/1 →
boolean, preserves ids, advances sequences). It is not part of normal operation.

## Current Schema (key tables)

- `employees` — id, employee_code, first_name, last_name, date_of_birth, father_name, reporting_manager_id, email, date_of_joining, phone, aadhaar_number, dept_name, job_title_id, branch_name, is_active
- `job_titles` — id, **title** (not name), department_id
- `attendance_records` — id, employee_id, date, check_in, check_out, status, working_hours. Unique on (employee_id, date)
- `leave_requests` — id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approved_by
- `holidays` — id, name, date, property_id, is_recurring
- `users` — id, email, password_hash, role_id, employee_id (+ Better Auth columns). ~50 FKs point at `users.id`
- `session`, `account`, `verification` — Better Auth tables, **camelCase columns** (`userId`, `expiresAt`)
- `roles`, `permissions`, `role_permissions` — RBAC tables

## Dropped Columns (originally migration 011)

These do NOT exist on `employees`: `property_id`, `department_id`, `category_id`, `employment_status_id`, `personal_email`, `pan_number`, `bank_account_number`, `bank_ifsc`. Use `dept_name` and `branch_name` (plain text) instead.
