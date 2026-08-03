# Deploying SaltStayz HRMS

The app runs as three independent pieces:

```
Browser ──► Vercel (Next.js client) ──HTTPS──► Render (Express API) ──► Neon (PostgreSQL)
```

Because PostgreSQL is a networked service, the API stores nothing on disk and needs no
persistent volume — so it can run on any host, including free tiers. (Under the previous
SQLite build the database *was* a local file, which is why production login kept failing:
nothing persisted it.)

**Current deployment**

| Piece | Where | Address |
|-------|-------|---------|
| Client | Vercel | `https://saltstayz-hrms.vercel.app` |
| API | Render (free) | `https://saltstayz-api.onrender.com` |
| Database | Neon (free) | connection string only |

---

## 1. Database (Neon)

Create a project at [neon.tech](https://neon.tech) and copy its connection string:

```
postgres://USER:PASSWORD@HOST.neon.tech/neondb?sslmode=require
```

SSL is enabled automatically for any non-localhost host.

> **Tip:** create a second Neon **branch** (e.g. `dev`) for local development so testing
> never touches production data.

---

## 2. API (Render)

**New → Web Service → connect the GitHub repo**, then:

| Setting | Value |
|---------|-------|
| Root Directory | `server` |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm run start:prod` |
| Instance Type | Free is sufficient |

> ⚠️ **`--include=dev` is required.** With `NODE_ENV=production` set, npm skips
> devDependencies — which is where the TypeScript compiler and all `@types/*` packages live.
> Without the flag the build fails with dozens of `TS7016: Could not find a declaration file`
> errors.

> ⚠️ **`start:prod`, not `start`.** `start:prod` runs pending migrations and then boots;
> `start` boots only. This document used to say the opposite, and that is what broke the
> employees page on 2026-08-03: the schema had never moved past migration 001 while the code
> had reached 033, so `employees.pan_number` — added by 007 — did not exist and every request
> to `/employees` returned a bare 500. **No deploy had ever run a migration.**
>
> The old advice said migrations "need dev dependencies at runtime". That was true; `tsx` has
> since been moved into `dependencies` precisely so this command works. See below for why the
> migrations cannot simply be compiled instead.

> **Do not compile the migrations to `dist/` and run them with plain `node`.** knex records each
> applied migration by FILENAME, and every row in production's `knex_migrations` ends in `.ts`.
> Running the compiled `.js` files would leave knex comparing `001_baseline_postgres.js` against
> a recorded `001_baseline_postgres.ts`, concluding all thirty-three are pending, and replaying
> the entire history onto a database that already has it. `server/src/services/schemaVersion.test.ts`
> fails if anyone changes the migrations away from `.ts` for this reason.

> **Multiple instances:** `start:prod` migrates on every boot. knex takes an advisory lock
> (`knex_migrations_lock`), so concurrent instances serialise rather than collide — but if you
> scale beyond one instance, prefer Render's **Pre-Deploy Command** (`npm run db:migrate`) and
> set Start Command back to `npm start`, so migrations run once per deploy rather than once per
> boot.

### Environment variables (on Render)

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Neon connection string |
| `BETTER_AUTH_SECRET` | a long random secret — `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | the API's own public URL, e.g. `https://saltstayz-api.onrender.com` |
| `CLIENT_URL` | the client's exact origin, e.g. `https://saltstayz-hrms.vercel.app` |

Leave `PORT` unset — the host provides it and the app honours it.

> ⚠️ **`CLIENT_URL` must be the stable domain**, not the long per-deployment URL Vercel shows
> on a build page (`...-nx303osa6-....vercel.app`). Those change on every deploy. Using one
> makes the API reject your real site with `403 {"code":"INVALID_ORIGIN"}`.

---

## 3. Client (Vercel)

**Settings → Environments → Production → Environment Variables:**

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://saltstayz-api.onrender.com/api/v1` (note the `/api/v1`) |

Then **redeploy** — `NEXT_PUBLIC_*` values are baked in at build time, so changing the
variable alone does nothing.

---

## 4. Create the schema and load data

```bash
npm run db:migrate --workspace=server     # applies every pending migration
```

> This is the same command `start:prod` runs on each deploy, so after the first install you
> should rarely need it by hand. It is **not** a one-time step: the baseline creates the schema,
> and every later migration moves it forward. Run it whenever you deploy code from a branch that
> added one, or point `DATABASE_URL` at the target database and run it directly.
>
> **How to tell whether a database is behind:** the server says so in its first line of log —
> `[schema] up to date — 33 migration(s) applied`, or a boxed warning naming each missing one.
> `GET /health` reports the same thing as `{ "schema": { "applied": 33, "pending": 0 } }` and
> answers `"status": "degraded"` when it is behind.

Then either:

- **Fresh install:** `npm run db:seed --workspace=server` for working demo logins.
- **Migrating from the old SQLite build (one time):**
  ```bash
  npx tsx src/db/migrate-sqlite-to-pg.ts path/to/hrms.db
  ```
  Copies every table, converts 0/1 → booleans, preserves ids, advances sequences, and
  resolves foreign-key cycles. The source file is opened read-only.

> Never commit the database or a dump — they contain employee PII.

---

## Verify

1. `GET https://<api-host>/health` → `{"status":"ok","db":"up"}`
2. Sign in on the client — it should succeed.
3. Navigate and refresh; the session should persist (cross-site cookie working).
4. Two people sign in without a rate-limit lockout (trust-proxy working).
5. Redeploy the API, sign in again → still works, data intact.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Build fails with many `TS7016 Could not find a declaration file` | devDependencies skipped because `NODE_ENV=production` | Build command → `npm install --include=dev && npm run build` |
| `BETTER_AUTH_SECRET environment variable is required in production` | Secret not set | Add it in the host's environment variables |
| `403 {"code":"INVALID_ORIGIN"}` on login | `CLIENT_URL` doesn't match the site's origin | Set it to the exact stable domain, no trailing slash |
| "Invalid credentials" for everyone | The database has no credential rows | Run step 4 (seed, or the one-time data copy) |
| Login works, then bounces back to `/login` | Session cookie not stored cross-site | `NODE_ENV=production` (enables `SameSite=None; Secure`) and HTTPS on both sides |
| Client calls `localhost:5000` in production | `NEXT_PUBLIC_API_URL` unset or not redeployed | Set it and redeploy Vercel |
| "Too many attempts" for everyone at once | Rate limiter keyed on the proxy's IP | `NODE_ENV=production` turns on trust-proxy |
| `database "..." does not exist` | `DATABASE_URL` points at the wrong server | Check host/database name; watch for another Postgres already on 5432 |

---

## Operational notes

- **Free-tier sleep.** Render's free plan spins the API down after ~15 minutes idle; the next
  request takes 30–60 seconds to wake it. A paid instance removes this.
- **Backups.** `npm run db:backup --workspace=server` shells out to `pg_dump` (set `PG_DUMP`
  if it isn't on PATH). Neon also takes automatic backups — the recommended safety net.
- **Leave accrual.** A daily job credits earned leave on each employee's joining anniversary. It is
  automatic in production (set `LEAVE_ACCRUAL_ENABLED=true` to run it elsewhere), and does nothing
  at all until an admin ticks "Earn this leave monthly" for a leave type on
  **Leave → Control Panel → Templates**. Turning that on drops everyone to what they have earned
  *from that day*, so run the one-time catch-up straight afterwards:
  ```bash
  npm run leave:backfill --workspace=server
  ```
  It reports and writes a CSV first; add `--apply` once the figures have been reviewed. Both the
  job and the backfill are safe to re-run — a credit already in the ledger is never made twice.
- **Uploads.** Uploaded files (checklist documents) are still written to local disk, so on an
  ephemeral host they are lost on redeploy. Moving them to object storage is follow-up work;
  it does not affect login or any database-backed feature.
