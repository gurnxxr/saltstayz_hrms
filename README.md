# SaltStayz HRMS

Internal HR Management System for the **SaltStayz** hospitality chain — recruitment,
onboarding, employee records, attendance, leave, shift rostering, payroll, and analytics
in one role-based application.

Monorepo: a **Next.js** frontend and an **Express** API backend over a **PostgreSQL**
database, managed with npm workspaces.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Client** | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind CSS 4 |
| **Server** | Express 4, TypeScript 5, Knex.js query builder |
| **Database** | PostgreSQL via `pg` (connection string in `DATABASE_URL`) |
| **Auth** | Better Auth — server-side sessions in httpOnly cookies, bcrypt (12 rounds), RBAC middleware |
| **Data fetching** | TanStack React Query (client), Knex (server) |
| **PDF** | pdfkit (payslips, offer letters, job descriptions) |
| **Testing** | Vitest |

The client uses React Query for all server state, `react-hook-form` + `zod` for forms,
`recharts` for charts, `lucide-react` for icons, and `sonner` for toasts.

---

## Modules

| Module | Route | What it does |
|--------|-------|-------------|
| **Auth** | `/login` | Better Auth session login, 7 roles |
| **Dashboard** | `/dashboard` | Role-aware landing with a personalized greeting |
| **Employees** | `/employees` | Employee directory + detail records; property filter |
| **My Profile** | `/profile` | Self-service editable fields |
| **Leave & Attendance** | `/attendance`, `/leaves` | Attendance calendar, leave requests, encashment, regularisation |
| **Shifts / Roster** | `/shifts`, `/shift-setup` | Weekly roster grid with publish + weekly-offs |
| **Recruitment** | `/recruitment` | Vacancies, JD generation, candidate pipeline (kanban) |
| **Onboarding** | `/onboarding` | Checklists, document collection, offer letters |
| **Employee Lifecycle** | `/employee-lifecycle` | Promotions, transfers, exit interviews, assets |
| **Payroll / Salary** | `/salary` | Salary structures, payslip engine (statutory + proration), payroll runs |
| **Offboarding** | `/offboarding` | Full & final settlement, access revocation |
| **Manpower** | `/manpower` | Sanctioned strength, budgets, hiring guardrails |
| **Analytics** | `/analytics` | Org-wide and property-level dashboards |
| **Admin** | `/admin` | Org structure, users, module access, property config |

Roles: `admin`, `chro`, `hr`, `cluster_hr`, `property_manager`, `employee`, `finance`.
Access is enforced per-endpoint via `authorize(module, action)` plus optional per-employee
overrides.

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- **A PostgreSQL database.** Either a local one (Docker below) or a free hosted one
  (e.g. [Neon](https://neon.tech)).

### 1. Install

```bash
npm install
```

This installs both workspaces (`client/` and `server/`).

### 2. Start a local PostgreSQL (skip if you already have one)

```bash
docker run -d --name hrms-pg \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hrms \
  -p 5432:5432 postgres:16
```

> If port 5432 is already taken, map a different host port (e.g. `-p 55432:5432`) and use
> that port in `DATABASE_URL`.

### 3. Configure the server environment

Create `server/.env` (never commit this file — see `.env.example`):

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/hrms
BETTER_AUTH_SECRET=your-long-random-secret-at-least-32-chars
CLIENT_URL=http://localhost:3000
SERVER_PORT=5000
NODE_ENV=development
```

Generate a secret with `openssl rand -base64 32`. SSL is enabled automatically for any
non-localhost database host.

### 4. Set up the database

```bash
npm run db:migrate --workspace=server   # create the schema (one baseline migration)
npm run db:seed    --workspace=server   # seed roles, org data, users, leave config
```

Seeded logins use the password `1234` (development only — see the seeds for the accounts).

### 5. Run the dev servers

```bash
npm run dev          # starts BOTH the API (:5000) and the client (:3000)
```

Or run them separately:

```bash
npm run dev --workspace=server    # Express API on http://localhost:5000
npm run dev --workspace=client    # Next.js on   http://localhost:3000
```

The API is served under the `/api/v1` prefix; the client reads its base URL from
`NEXT_PUBLIC_API_URL` and falls back to `http://localhost:5000/api/v1`.

---

## Commands

```bash
# Dev
npm run dev                           # both servers together
npm run dev --workspace=server        # Express (tsx watch) on :5000
npm run dev --workspace=client        # Next.js (Turbopack) on :3000

# Database
npm run db:migrate --workspace=server
npm run db:seed    --workspace=server
npm run db:backup  --workspace=server # pg_dump into server/data/backups

# Build
npm run build --workspace=client      # next build
npm run build --workspace=server      # tsc

# Tests
npm run test --workspace=server       # vitest (pure-logic + calc-engine suites)
```

---

## Deployment

The app runs as three independent pieces:

```
Browser ──► Vercel (Next.js client) ──HTTPS──► Render (Express API) ──► Neon (PostgreSQL)
```

Because the database is a networked service, the API needs no persistent disk and can run
on any host — including free tiers. Full step-by-step instructions, the required environment
variables, and a troubleshooting table are in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

Two settings cause most deployment problems:

- **`CLIENT_URL`** (on the API) must be the client's exact origin, no trailing slash. It
  drives CORS, the Better Auth trusted origin, and the cross-site session cookie.
- **`NEXT_PUBLIC_API_URL`** (on Vercel) is baked in at build time — after changing it you
  must redeploy.

---

## Project Structure

```
HRMS/
├── client/src/
│   ├── app/            # Next.js App Router pages
│   ├── components/     # ui/, layout/ (AppShell, Sidebar), module-specific
│   ├── lib/            # api.ts, auth.tsx, constants.ts, types.ts, utils.ts
│   └── hooks/          # usePermissions, custom hooks
├── server/src/
│   ├── routes/         # one file per module, mounted in routes/index.ts
│   ├── controllers/    # thin request handlers — delegate to services
│   ├── services/       # business logic + Knex queries
│   ├── middleware/     # auth (Better Auth session), rbac (authorize)
│   ├── config/         # database.ts (Knex + pg), auth.ts (Better Auth), env.ts
│   ├── utils/locks.ts  # PostgreSQL advisory locks for check-then-insert paths
│   ├── db/migrations/  # 001_baseline_postgres.ts (the whole schema)
│   └── db/seeds/       # seed data
└── package.json        # npm workspaces root
```

Each server module follows `routes → controller → service → db(knex)`. Controllers are
thin; services hold all business logic.

> `server/src/db/migrations-sqlite-archive/` holds the 82 original SQLite migrations. They
> are kept for history only and are **not** run.

---

## Architecture Notes

- **API base:** all routes are mounted under `/api/v1`.
- **Auth:** Better Auth owns identity and sessions; the session lives in an httpOnly cookie
  and is validated on every request, so signing out or deactivating an account takes effect
  immediately. RBAC is unchanged and still the app's own. Passwords are bcrypt (12 rounds)
  and are never stored in readable form.
- **RBAC:** `authorize('module', 'action')` guards each endpoint; a per-employee
  `employee_module_access` override can grant or deny access ahead of role permissions.
- **Database (PostgreSQL):** inserts must ask for the id —
  `const [{ id }] = await db('t').insert(data).returning('id')`. Booleans are real booleans
  (`true`/`false`, never `1`/`0`), and user-facing search uses `ilike` because Postgres
  `LIKE` is case-sensitive.
- **Concurrency:** Postgres is MVCC, so "read a total, decide, then insert" is not safe on
  its own. The hiring guardrail, leave applications, and the employee/job code generators
  take advisory locks (`utils/locks.ts`).
- **Dates:** business date/time columns are stored as text (`'YYYY-MM-DD'`, `'HH:MM'`) and
  compared as strings; `created_at`/`updated_at` are real `timestamptz`.
- **Payroll engine:** a lines-based calculator resolves statutory rates (EPF/ESI/PT/LWF/TDS),
  proration by payable days, overtime, and bonuses; payroll runs can be locked and snapshotted.

---

## Testing

```bash
npm run test --workspace=server
```

The server suite covers the pure logic that would silently corrupt data if it regressed:
the CSV importer, the recruitment funnel rules, the statutory resolver and its input guards,
the payslip and attendance calculation engines, payable-days math, leave encashment, the
error hierarchy, and salary-structure band math. The tests do not touch a database, so they
run without any setup.

---

## License

Private / internal project. Not licensed for external use.
