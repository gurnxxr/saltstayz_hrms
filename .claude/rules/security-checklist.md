# Security Checklist

Verify BEFORE generating or modifying any code:

## Input Validation
- [ ] All user inputs validated with Zod schemas
- [ ] No SQL string concatenation — use Knex parameterized queries only
- [ ] No `eval()`, `Function()`, or `exec()` with user input
- [ ] File uploads validated: MIME type, extension, size (multer `limits`)

## Authentication & Authorization
- [ ] `router.use(authenticate)` on all protected route files
- [ ] `authorize('module', 'action')` on each endpoint
- [ ] JWT secrets from environment variables — never hardcoded
- [ ] Passwords hashed with bcrypt (12 rounds)
- [ ] Cookies: `httpOnly: true`, `secure: true` in production, `sameSite: 'strict'` in production

### The one documented exception to "authenticate on every route"

`routes/passwordReset.routes.ts` has **no** `authenticate` and **no** `authorize`. It cannot: the
people who need it are precisely the ones who cannot sign in. It is the only unauthenticated,
state-changing surface in the application, so it carries its own controls instead — check these
whenever it is touched:

- **Says nothing, and takes the same time to say it.** Every `POST /request` returns the same 202
  and the same sentence; every failure of `POST /confirm` returns the same 400 — schema failures
  included, which is why `parse` takes a uniform message on that endpoint. Unknown address,
  deactivated leaver, wrong code, expired code, attempt-capped code and weak password are
  indistinguishable from outside.
  *Wording alone is not enough.* `/request` answers BEFORE it looks anything up (the work is
  detached; `whenRequestSettled` exists only so tests can await it), because otherwise a registered
  address cost a locked transaction plus a round-trip to the mail provider while an unknown one cost
  one indexed `SELECT` — a hundredfold gap that one probe could read. `/confirm` must return a real
  verdict, so it holds every response to a 250ms floor instead.
- **Three budgets.** In `app.ts`: a per-ADDRESS limiter (10 / 15 min, keyed on IP + a hash of the
  email, shared across both endpoints) so colleagues on one office connection cannot spend each
  other's allowance, behind a per-CONNECTION ceiling (400 / 15 min) that no real office reaches but
  that stops one machine mailing the whole staff directory. Then the per-ACCOUNT budget in
  `passwordResetThrottle.service.ts` — 1/min, 3 codes per 15 min, 15 failures per SLIDING hour
  (two-bucket, so timing a burst against the boundary does not hand back a second full budget).
  The account budget is the one that binds. Better Auth's own five-attempts-per-code is not a bound
  on its own, because asking for a new code resets it.
- **A failure is only charged against a live code.** Otherwise the budget is a weapon: anyone who
  knew a colleague's address could post fifteen junk codes and deny that person recovery for an
  hour, repeatedly.
- **One canonical spelling per path.** Express matches the raw pathname; Better Auth re-parses with
  the WHATWG parser, which decodes `%2e` and collapses dot segments. Guards mounted on Express's
  view were therefore bypassable — `/api/v1/auth/%2e/email-otp/reset-password` reached the plugin's
  own reset handler, and `/api/v1/password-reset//confirm` slipped the rate limiter. `isAmbiguousPath`
  refuses dot segments, empty inner segments and encoded separators once, ahead of all routing.
  **Do not add a guard that normalises for itself instead** — that is how this happened.
- **Codes are never stored recoverably.** `storeOTP.hash` in `config/auth.ts` is an HMAC keyed on
  `OTP_PEPPER`. The plugin's own `"hashed"` option is an unsalted SHA-256 — six digits is a
  one-million-entry rainbow table — and bcrypt cannot be used here because verification re-hashes
  and compares digests, which needs determinism.
- **The plugin's own routes are shut.** Registering `emailOTP()` mounts `/sign-in/email-otp`, whose
  handler CREATES a user for an unrecognised address. `disableSignUp: true` is the fix; the 404 block
  in `app.ts` — which must stay ahead of the Better Auth catch-all — is the belt to that braces.
- **Ten-character floor**, enforced in `passwordReset.controller.ts` rather than globally, because
  `config/auth.ts` allows 4 for the seeded logins and this path must not be a way to downgrade an
  account.
- **The body field is named `otp` exactly.** `middleware/audit.ts` redacts any key containing "otp";
  renaming it to `code` or `pin` would start writing live codes into `audit_logs.metadata`.

**The link is always offered; `MAIL_PROVIDER` decides only whether a code can be sent.** It used to
gate the link too, which meant that on a box with no provider the feature looked unbuilt. Now
`isMailConfigured()` is consulted server-side on every request — `doRequestReset` returns before any
account work and `confirmReset` gives its uniform rejection — so with `MAIL_PROVIDER=none` the
endpoints answer normally and do nothing. `GET /password-reset/capabilities` still reports the truth,
as an operator diagnostic rather than a UI gate.

`OTP_PEPPER` is mandatory for **every provider that can reach a real mailbox — `smtp` as well as
`resend`** — in any environment. The guard is keyed on the provider rather than on `NODE_ENV`
precisely so a staging box cannot send live codes protected by the repository's own literal.
Half-configured SMTP counts as not configured: a host with no password sends nothing rather than
promising a code it cannot deliver.

`passwordReset.db.test.ts` asserts every property above under `MAIL_PROVIDER=memory`;
`mailer.test.ts` and `config/env.test.ts` cover the provider matrix and the boot guards.

## Data Protection
- [ ] No secrets in code (JWT_SECRET, DB credentials → `.env` only)
- [ ] PII fields (aadhaar, phone, email) — never logged, never in URLs
- [ ] Error responses: generic messages only, no stack traces to client
- [ ] `.env`, `*.db`, CSV files with PII — never committed to git

## Infrastructure
- [ ] Rate limiting on auth endpoints (15 req/15min via express-rate-limit)
- [ ] Security headers via helmet (CSP, HSTS, X-Frame-Options)
- [ ] JSON body size limit: 10kb (`express.json({ limit: '10kb' })`)
- [ ] CORS locked to `CLIENT_URL` with `credentials: true`

## Current Implementation Status

| Check | Status | Notes |
|-------|--------|-------|
| Parameterized queries | PASS | All queries via Knex query builder |
| No eval/exec | PASS | None found in codebase |
| Bcrypt 12 rounds | PASS | Fixed from 10 → 12 |
| JWT from env | PASS | Throws in production if missing |
| Auth on all routes | PASS | `authenticate` on every route file except `passwordReset.routes.ts` — see the documented exception above |
| RBAC on endpoints | PASS | `authorize(module, action)` per endpoint |
| Secure cookies | PASS | Environment-aware (secure + strict in prod) |
| Rate limiting | PASS | 15 req/15min on /auth/login |
| Helmet headers | PASS | Enabled with CSP in production |
| JSON size limit | PASS | 10kb limit |
| Error handling | PASS | Generic 500, stack only in dev logs |
| No secrets in code | PASS | Fallback only for dev, throws in production |
