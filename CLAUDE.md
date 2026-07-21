# SaltStayz HRMS

Internal HR Management System for SaltStayz hospitality chain. Monorepo with Next.js frontend and Express API backend, SQLite database.

## Tech Stack

- **Client:** Next.js 16.2.9 (App Router, Turbopack), React 19, TypeScript 5, Tailwind CSS 4
- **Server:** Express 4, TypeScript 5, Knex.js query builder
- **Database:** PostgreSQL via `pg` (migrated from SQLite). Connect with `DATABASE_URL`; managed hosts (Neon) need SSL.
- **Auth:** JWT in httpOnly cookies, bcrypt password hashing, RBAC via `authorize(module, action)` middleware
- **Monorepo:** npm workspaces — `client/` and `server/`

## Commands

```bash
# Dev servers (from project root)
npm run dev --workspace=server    # Express on :5000 (tsx watch)
npm run dev --workspace=client    # Next.js on :3000 (Turbopack)

# Database
npm run db:migrate --workspace=server
npm run db:seed --workspace=server
npm run db:reset --workspace=server   # rollback + migrate + seed

# Build
npm run build --workspace=client   # next build
npm run build --workspace=server   # tsc
```

## Critical Patterns

**API base URL:** `/api/v1` — all routes are mounted under this prefix. Client uses `http://localhost:5000/api/v1`.

**DB import:** `import db from '../config/database'` — NOT `../db/connection`.

**Insert must ask for the id:** `const [{ id }] = await db('table').insert(data).returning('id')`. Postgres returns nothing from a bare `.insert()`.

**Next.js 16 dynamic params:** `{ params }: { params: Promise<{ id: string }> }` then `const { id } = use(params)`.

**job_titles column:** Uses `title` (NOT `name`). All other org tables use `name`.

**authorize middleware:** `authorize('module', 'action')` — e.g. `authorize('leave', 'read')`, `authorize('admin', 'create')`.

**Client auth:** `useAuth()` from `@/lib/auth` returns `{ user, login, logout, can }`. `usePermissions()` from `@/hooks/usePermissions` has `isAdmin`, `isCHRO`, etc.

## Roles & Logins

| Role | Email | Password |
|------|-------|----------|
| admin | gurnoor@saltstayz.com | 1234 |
| chro | chro@saltstayz.com | 1234 |
| hr | hr@saltstayz.com | 1234 |
| cluster_hr | clusterhr@saltstayz.com | 1234 |
| property_manager | fo@saltstayz.com | 1234 |
| employee | employee@saltstayz.com | 1234 |
| finance | finance@saltstayz.com | 1234 |

Admin (gurnoor) is linked to employee code 2399.

## Project Structure

```
HRMS/
├── client/src/
│   ├── app/           # Next.js App Router pages (login, dashboard, employees, attendance, etc.)
│   ├── components/    # ui/, layout/ (AppShell, Sidebar), module-specific
│   ├── lib/           # api.ts, auth.tsx, constants.ts, types.ts, utils.ts
│   └── hooks/         # usePermissions, custom hooks
├── server/src/
│   ├── routes/        # One file per module, mounted in routes/index.ts
│   ├── controllers/   # Request handlers — thin, delegate to services
│   ├── services/      # Business logic, DB queries via Knex
│   ├── middleware/     # auth.ts (JWT verify), rbac.ts (authorize)
│   ├── config/        # database.ts (Knex + SQLite config)
│   ├── db/migrations/ # Knex migrations (001–012)
│   ├── db/seeds/      # Seed files (roles, org data, users, leave config)
│   └── types/         # AuthRequest, JwtPayload interfaces
└── package.json       # npm workspaces root
```

## Do NOT

- Use SQLite-only SQL (`strftime`, `date(col)`, `VACUUM INTO`, `IFNULL`) — this is PostgreSQL
- Compare or write booleans as `1`/`0` — use `true`/`false` (real boolean columns)
- Use `LIKE` for user-facing search — use `ilike` (Postgres `LIKE` is case-sensitive)
- Assume writers serialise — Postgres is MVCC; use the advisory locks in `utils/locks.ts` for check-then-insert
- Use `employees.property_id` or `employees.department_id` — these columns were dropped in migration 011
- Import from `../db/connection` — use `../config/database`
- Use Prisma, Drizzle, or any ORM — use Knex only
- Use Redux, Zustand, or any state manager — use React Query + local state
- Add axios interceptors for auth — cookies are handled automatically
- Use `job_titles.name` — the column is `job_titles.title`
