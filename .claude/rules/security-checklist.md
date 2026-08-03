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

- **Says nothing.** Every `POST /request` returns the same 202 and the same sentence; every failure
  of `POST /confirm` returns the same 400. Unknown address, deactivated leaver, wrong code, expired
  code, attempt-capped code and weak password are indistinguishable from outside. This is what stops
  it being a membership oracle for a staff directory.
- **Two budgets.** A per-IP limiter in `app.ts` (10 / 15 min, shared across both endpoints) and the
  per-ACCOUNT budget in `passwordResetThrottle.service.ts` — 1/min, 3 per 15 min, 15 failures per
  hour. The account budget is the one that binds; an IP limit is worth little to someone with more
  than one address. Better Auth's own five-attempts-per-code is not a bound on its own, because
  asking for a new code resets it.
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

Off by default: with `MAIL_PROVIDER=none` the whole feature is dark and the login screen does not
offer it. `passwordReset.db.test.ts` asserts every property above.

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
