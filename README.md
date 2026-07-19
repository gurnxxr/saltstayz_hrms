# SaltStayz HRMS

Internal HR Management System for the **SaltStayz** hospitality chain — recruitment,
onboarding, employee records, attendance, leave, shift rostering, payroll, and analytics
in one role-based application.

Monorepo: a **Next.js** frontend and an **Express** API backend over a **SQLite** database,
managed with npm workspaces.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Client** | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind CSS 4 |
| **Server** | Express 4, TypeScript 5, Knex.js query builder |
| **Database** | SQLite via `better-sqlite3` (WAL mode, foreign keys on) |
| **Auth** | JWT in httpOnly cookies, bcrypt (12 rounds), RBAC middleware |
| **Data fetching** | TanStack React Query (client), Knex (server) |
| **PDF** | pdfkit (payslips, offer letters, job descriptions) |
| **Testing** | Vitest |

The client uses React Query for all server state, `react-hook-form` + `zod` for forms,
`recharts` for charts, `lucide-react` for icons, and `sonner` for toasts.

---

## Modules

| Module | Route | What it does |
|--------|-------|-------------|
| **Auth** | `/login` | JWT cookie login, 7 roles |
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

### 1. Install

```bash
npm install
```

This installs both workspaces (`client/` and `server/`).

### 2. Configure the server environment

Create `server/.env` (never commit this file):

```env
JWT_SECRET=your-long-random-secret
CLIENT_URL=http://localhost:3000
PORT=5000
NODE_ENV=development
```

### 3. Set up the database

```bash
npm run db:migrate --workspace=server   # run all migrations
npm run db:seed    --workspace=server   # seed roles, org data, users, leave config
# or, to rebuild from scratch:
npm run db:reset   --workspace=server   # rollback + migrate + seed
```

The SQLite database lives at `server/data/hrms.db` and is **gitignored** — it holds
employee PII and is never committed.

### 4. Run the dev servers

```bash
npm run dev --workspace=server    # Express API on http://localhost:5000
npm run dev --workspace=client    # Next.js on   http://localhost:3000
```

The API is served under the `/api/v1` prefix; the client talks to `http://localhost:5000/api/v1`.

---

## Commands

```bash
# Dev
npm run dev --workspace=server        # Express (tsx watch) on :5000
npm run dev --workspace=client        # Next.js (Turbopack) on :3000

# Database
npm run db:migrate --workspace=server
npm run db:seed    --workspace=server
npm run db:reset   --workspace=server

# Build
npm run build --workspace=client      # next build
npm run build --workspace=server      # tsc

# Tests
npm run test --workspace=server       # vitest (pure-logic + calc-engine suites)
```

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
│   ├── middleware/     # auth (JWT verify), rbac (authorize)
│   ├── config/         # database.ts (Knex + SQLite)
│   ├── db/migrations/  # Knex migrations
│   └── db/seeds/       # seed data
└── package.json        # npm workspaces root
```

Each server module follows `routes → controller → service → db(knex)`. Controllers are
thin; services hold all business logic.

---

## Architecture Notes

- **API base:** all routes are mounted under `/api/v1`.
- **Auth:** JWT is stored in an httpOnly cookie; the client sends it automatically with
  `credentials: true`. Passwords are bcrypt-hashed (12 rounds).
- **RBAC:** `authorize('module', 'action')` guards each endpoint; a per-employee
  `employee_module_access` override can grant or deny access ahead of role permissions.
- **Database:** SQLite via Knex — inserts return the new id (`const [id] = await db(...).insert(...)`),
  WAL mode, foreign keys enabled.
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
error hierarchy, and salary-structure band math.

---

## License

Private / internal project. Not licensed for external use.
