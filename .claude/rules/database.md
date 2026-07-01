# Database Rules

## SQLite — Not PostgreSQL

This project uses SQLite via better-sqlite3. Do NOT use:
- `ILIKE` → use `LIKE` (case-insensitive by default in SQLite)
- `RETURNING *` → insert returns ID only
- `NOW()` → use `datetime('now')`
- `BOOLEAN` type → use INTEGER (0/1)
- `SERIAL` → use `increments()`
- Array types or JSON operators
- `ALTER TABLE ... DROP COLUMN` for multiple columns in one statement

## Knex Query Builder

```typescript
import db from '../config/database';

// Select with join
db('employees as e')
  .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
  .select('e.*', 'jt.title as designation_name')

// Insert — returns [id], NOT the row
const [id] = await db('table').insert({ col: 'val' });

// Upsert pattern (SQLite)
const existing = await db('table').where('key', val).first();
if (existing) await db('table').where('id', existing.id).update(data);
else await db('table').insert(data);
```

## Current Schema (key tables)

- `employees` — id, employee_code, first_name, last_name, date_of_birth, father_name, reporting_manager_id, email, date_of_joining, phone, aadhaar_number, dept_name, job_title_id, branch_name, is_active
- `job_titles` — id, **title** (not name), department_id
- `attendance_records` — id, employee_id, date, check_in, check_out, status, working_hours. Unique on (employee_id, date)
- `leave_requests` — id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approved_by
- `holidays` — id, name, date, property_id, is_recurring
- `users` — id, email, password_hash, role_id, employee_id
- `roles`, `permissions`, `role_permissions` — RBAC tables

## Dropped Columns (migration 011)

These NO LONGER exist on `employees`: `property_id`, `department_id`, `category_id`, `employment_status_id`, `personal_email`, `pan_number`, `bank_account_number`, `bank_ifsc`. Use `dept_name` and `branch_name` (plain text) instead.
