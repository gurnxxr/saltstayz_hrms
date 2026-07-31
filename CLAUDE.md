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
npm run dev                       # BOTH: Express :5000 + Next.js :3000
npm run dev --workspace=server    # Express on :5000 (tsx watch)
npm run dev --workspace=client    # Next.js on :3000 (Turbopack)

# Needs a PostgreSQL to point DATABASE_URL at, e.g.
# docker run -d --name hrms-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hrms -p 5432:5432 postgres:16

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
│   ├── db/migrations/ # 001_baseline_postgres.ts (whole schema; the 82 SQLite
│   │                  # originals are archived in db/migrations-sqlite-archive/)
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

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

