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
| Auth on all routes | PASS | `authenticate` middleware on every route file |
| RBAC on endpoints | PASS | `authorize(module, action)` per endpoint |
| Secure cookies | PASS | Environment-aware (secure + strict in prod) |
| Rate limiting | PASS | 15 req/15min on /auth/login |
| Helmet headers | PASS | Enabled with CSP in production |
| JSON size limit | PASS | 10kb limit |
| Error handling | PASS | Generic 500, stack only in dev logs |
| No secrets in code | PASS | Fallback only for dev, throws in production |
