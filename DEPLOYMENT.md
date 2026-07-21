# Deploying SaltStayz HRMS

The front end runs on **Vercel**. The back end is an Express API talking to **PostgreSQL**.

Because the database is now a networked service rather than a file on disk, the API no longer needs a
persistent volume — it can run on any host, including free ones. (Under the old SQLite build the
database *was* a local file, which is why production login kept breaking: nothing persisted it.)

```
Browser ──► Vercel (Next.js front end) ──HTTPS──► API host (Express) ──► PostgreSQL (e.g. Neon)
```

## 1. Create the database

Create a **Neon** project (free tier is enough) — or any managed Postgres — and copy its connection
string. It looks like:

```
postgres://user:password@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

SSL is enabled automatically for any non-localhost host.

## 2. Host the API

Any host that runs Node works — a free always-on service, a small VPS, or Vercel. No disk required.

- **Build:** `npm install && npm run build`
- **Start:** `npm run start:prod` (runs migrations, then serves) — needs dev dependencies present for
  the migration step. If your host prunes them, run migrations as a separate release step and start
  with `npm start`.
- **Root directory:** `server`

## 3. Environment variables

On the **API host**:

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Postgres connection string |
| `BETTER_AUTH_SECRET` | a long random secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | the API's own public URL |
| `CLIENT_URL` | your Vercel URL, exact, no trailing slash |

`PORT` is provided by the host — leave it unset.

On **Vercel**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://<api-host>/api/v1` |

Then **redeploy** Vercel — `NEXT_PUBLIC_*` values are baked in at build time.

## 4. Create the schema and load the data

```bash
npm run db:migrate --workspace=server     # creates the whole schema (one baseline migration)
```

Then either:

- **Bring your existing data over** (one time, from the legacy SQLite file):
  ```bash
  npx tsx src/db/migrate-sqlite-to-pg.ts path/to/hrms.db
  ```
  Copies every table, converts 0/1 → booleans, preserves ids, and advances sequences. The source is
  opened read-only. Verified locally: 6,055 rows / 81 tables, including 323 users with their logins.
- **Or start fresh:** `npm run db:seed --workspace=server` for working demo logins.

> Never commit the database or a dump — they hold employee PII.

## Verify

1. `GET https://<api-host>/health` → `{"status":"ok","db":"up"}`
2. Sign in on the Vercel site → succeeds.
3. Session sticks across navigation/refresh (cross-site cookie settings).
4. Two people sign in without a rate-limit lockout (trust-proxy).
5. **Redeploy the API, log in again** → still works, data intact.

## If something fails

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Invalid credentials" for everyone | Database has no credential rows | Run step 4 (data copy or seed) |
| Login works then bounces to /login | Session cookie not stored cross-site | `NODE_ENV=production` (enables `SameSite=None; Secure`) and HTTPS |
| CORS / network error | `CLIENT_URL` or `NEXT_PUBLIC_API_URL` wrong | Set both exactly; redeploy Vercel |
| 403 on sign-in | Origin not trusted | `CLIENT_URL` must match the Vercel origin exactly |
| "Too many attempts" for everyone | Rate limiter keyed on the proxy IP | `NODE_ENV=production` turns on trust-proxy |
| `database "..." does not exist` | `DATABASE_URL` points at the wrong server | Check the host/database name |

## Backups

`npm run db:backup --workspace=server` shells out to `pg_dump` (set `PG_DUMP` if it isn't on PATH).
Managed hosts like Neon also take automatic backups — that is the recommended safety net.

## Note on uploads

Uploaded files (checklist documents) are still written to local disk, so on an ephemeral host they
are lost on redeploy. Moving them to object storage is follow-up work; it does not affect login.
