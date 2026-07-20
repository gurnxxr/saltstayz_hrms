# Deploying SaltStayz HRMS

The front end runs on **Vercel**. The back end uses **SQLite** (a database that is a single file
on disk), so it must run on a host that stays on **and keeps a persistent disk**. Vercel is
serverless (no persistent disk), so the back end cannot live there — that mismatch is what caused
the recurring "invalid credentials" on the deployed site.

```
Browser ──► Vercel (Next.js front end)  ──HTTPS──►  API host (Express + SQLite)
                                                     └─ persistent volume: /data/hrms.db + uploads
```

## What the code already handles (done)

- Binds the port the host provides (`PORT`), not a hard-coded 5000.
- Reads the database location from `DATABASE_PATH`, so it can live on a persistent volume.
- Trusts the proxy in production (correct HTTPS detection + per-user rate limiting).
- Sends the session cookie cross-site in production (`SameSite=None; Secure`) so login "sticks"
  between the Vercel front end and the API host.
- Fails clearly on a port clash and shuts down cleanly.

## What you need to do

### 1. Host the back end (with a persistent volume)

Pick a host that runs Node continuously **and** offers a persistent volume. Good options:
**Railway** or **Fly.io** (both have volumes), or a small **VPS**. (Render works only on a paid
plan that includes a disk — its free tier has no persistent storage.)

Using **Railway** as the example:

1. Create a project → **Deploy from GitHub repo** → pick this repo.
2. Set the service **root/working directory** to `server`.
3. **Build command:** `npm install && npm run build`
4. **Start command:** `npm run start:prod`  *(runs migrations, then serves)*
   - `start:prod` uses `tsx` for the migration step, so make sure dev dependencies are installed
     (don't prune them). If your host prunes dev deps, instead run migrations once as a separate
     step and use `npm start` as the run command.
5. Add a **Volume** mounted at `/data`.
6. Note the service's public URL (e.g. `https://saltstayz-api.up.railway.app`).

### 2. Set the back-end environment variables (on the API host)

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `DATABASE_PATH` | `/data/hrms.db` (on the mounted volume) |
| `BETTER_AUTH_SECRET` | a long random string (32+ chars) — generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | your API's public URL, e.g. `https://saltstayz-api.up.railway.app` |
| `CLIENT_URL` | your Vercel URL, exact, no trailing slash, e.g. `https://saltstayz.vercel.app` |

`PORT` is provided by the host automatically — leave it unset.

### 3. Point the front end at the API (on Vercel)

In the Vercel project → **Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_API_URL` | `https://saltstayz-api.up.railway.app/api/v1` |

Then **redeploy** the Vercel project — `NEXT_PUBLIC_*` values are baked in at build time, so a
redeploy is required for the change to take effect.

### 4. Give the production database its login records

The database must contain the Better Auth **credential** rows, or every login says "invalid
credentials." Two ways:

- **Recommended — bring your real data over** (keeps your ~300 real logins and their passwords):
  1. Locally: `npm run db:backup --workspace=server` → produces a clean copy under
     `server/data/backups/`.
  2. Upload that file to the volume as `/data/hrms.db` (Railway: use the volume's shell/console,
     or `railway run` / an upload step; on a VPS use `scp`).
  3. On the host, run `npm run db:migrate --workspace=server` once to apply any newer migrations.
- **Fresh start instead** (demo logins): on the host run
  `npm run db:migrate --workspace=server && npm run db:seed --workspace=server`.
  Seed 16 creates the Better Auth credential rows.

> Do **not** commit the database file — it's git-ignored on purpose (it holds employee PII).
> Move it directly to the host.

## Verify it end-to-end

1. **API up:** open `https://<api-host>/health` → `{ "status": "ok", "db": "up" }`.
2. **Login works:** sign in on the Vercel site → succeeds (no "invalid credentials").
3. **Session sticks:** navigate around and refresh → you stay logged in (confirms the cross-site
   cookie).
4. **No lockouts:** two people/browsers sign in without a "too many attempts" error (confirms
   trust-proxy).
5. **Survives redeploy (the anti-recurrence check):** redeploy the API, then log in again →
   still works, data intact (confirms the persistent volume).

## If something still fails

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| "Invalid credentials" for everyone | DB on the host has no credential rows | Do step 4 (restore real DB or seed) |
| Login works then bounces to /login | Cookie not stored cross-site | Confirm `NODE_ENV=production` (enables `SameSite=None; Secure`) and the site is HTTPS; ideally put the API on a subdomain of the front end's domain |
| CORS / network error in the browser console | `CLIENT_URL` (server) or `NEXT_PUBLIC_API_URL` (Vercel) wrong | Set both exactly; redeploy Vercel |
| 403 on sign-in | Origin not trusted | `CLIENT_URL` must exactly match the Vercel origin (no trailing slash) |
| "Too many attempts" for everyone | `trust proxy` / IP | Ensure `NODE_ENV=production` (turns on trust-proxy) |
| Data resets after each deploy | DB not on the volume | Ensure the volume is mounted and `DATABASE_PATH=/data/hrms.db` |

## Note on uploads

Uploaded files (checklist docs, etc.) are also written to disk. For them to survive redeploys,
keep them on the same persistent volume (e.g. an `uploads` folder under `/data`). Login does not
depend on this, so it can follow later.
