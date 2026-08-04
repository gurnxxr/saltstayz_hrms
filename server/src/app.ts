import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit, { MemoryStore, ipKeyGenerator } from 'express-rate-limit';
import { createHash } from 'crypto';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env';
import { auth } from './config/auth';
import db from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { auditLogger } from './middleware/audit';
import routes from './routes';
import { getCachedSchemaState } from './utils/schemaVersion';

const app = express();

/**
 * Refuse to route a URL whose path has more than one spelling — BEFORE anything matches on it.
 *
 * Express matches middleware against the RAW pathname. Better Auth re-parses the URL with the
 * WHATWG parser, which decodes `%2e` and collapses `.`/`..` segments. Those two views disagree, and
 * every guard in this file is mounted on Express's view, so the disagreement was exploitable:
 *
 *   POST /api/v1/auth/email-otp/reset-password      → 404 (the block below)
 *   POST /api/v1/auth/%2e/email-otp/reset-password  → reached the plugin's own handler
 *
 * — the emailOTP reset endpoint, with no per-account throttle, no per-IP limiter, no ten-character
 * floor and no audit row. `/sign-in/email-otp`, the account-creation path, was reachable the same
 * way. The doubled-slash form `/api/v1/password-reset//confirm` slipped the rate limiter for the
 * same underlying reason.
 *
 * Teaching each guard to normalise for itself would fix today's three and leave the fourth one
 * someone adds next year wrong again. So this refuses ambiguity outright, once, ahead of routing:
 * one canonical spelling per path. No legitimate client sends a dot segment, an empty segment, or
 * an encoded separator.
 */
const ENCODED_SEPARATOR = /%2e|%2f|%5c/i;

export function isAmbiguousPath(rawPath: string): boolean {
  // An encoded dot, slash or backslash is precisely where the two parsers stop agreeing.
  if (ENCODED_SEPARATOR.test(rawPath)) return true;
  const segments = rawPath.split('/');
  return segments.some((seg, i) =>
    seg === '.' || seg === '..'
    // An empty INNER segment ("//"). A leading one is the root and a trailing one is a trailing
    // slash; both are ordinary and Express treats them the same way everything else does.
    || (seg === '' && i > 0 && i < segments.length - 1));
}

app.use((req, res, next) => {
  if (isAmbiguousPath(req.url.split('?')[0])) {
    res.status(400).json({ error: 'Bad request' });
    return;
  }
  next();
});

// In production the app sits behind a reverse proxy / load balancer (Railway, Fly, Render, nginx…).
// Trust the first proxy hop so (a) req.protocol/req.secure reflect the real HTTPS request — needed
// to issue Secure cookies — and (b) the sign-in rate limiter keys on the real client IP instead of
// the proxy's, which would otherwise put every user in one bucket and lock the whole team out.
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate-limit sign-in attempts (Better Auth's email sign-in path).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/auth/sign-in/email', authLimiter);

/**
 * Shut the plugin's own OTP routes before Better Auth's catch-all can serve them.
 *
 * Registering `emailOTP()` mounts a family of endpoints under /api/v1/auth/*, and reaching them
 * directly would bypass everything that makes our two endpoints safe: the per-account throttle, the
 * audit trail, the uniform errors, and the 10-character password floor. Worse, `/sign-in/email-otp`
 * is an account-creation path — the handler creates a user for an unrecognised address. The plugin
 * is configured with `disableSignUp: true`, which is the real fix; this is the belt to that braces.
 *
 * MUST come before the catch-all below, or the catch-all wins. It is also only sound because the
 * ambiguous-path guard at the top of this file has already refused every alternative spelling of
 * these three prefixes — on its own, this block matches Express's view of the path and Better Auth
 * resolves a different one.
 */
app.use(['/api/v1/auth/email-otp', '/api/v1/auth/sign-in/email-otp', '/api/v1/auth/forget-password/email-otp'],
  (_req, res) => { res.status(404).json({ error: 'Not found' }); });

/**
 * Cap the body on the Better Auth routes, which `express.json({ limit: '10kb' })` cannot reach.
 *
 * Better Auth parses its own bodies, so it is deliberately mounted ahead of the JSON parser — with
 * the side effect that every /api/v1/auth/* route accepted an unbounded unauthenticated payload
 * while the rest of the API was capped at 10kb. Checked by header only: reading the stream here
 * would consume it, and Better Auth needs it. A lying Content-Length is not a hole worth chasing —
 * Node's own limits apply beyond this, and no legitimate sign-in body is anywhere near 10kb.
 */
const AUTH_BODY_LIMIT_BYTES = 10 * 1024;
app.use('/api/v1/auth', (req, res, next) => {
  if (Number(req.headers['content-length'] || 0) > AUTH_BODY_LIMIT_BYTES) {
    res.status(413).json({ error: 'Request body too large' });
    return;
  }
  next();
});

// Better Auth handles all /api/v1/auth/* routes (sign-in, sign-out, session, admin user mgmt).
// It MUST be mounted BEFORE express.json() — it parses its own request bodies.
app.all('/api/v1/auth/*', toNodeHandler(auth));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: false }));
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));

/**
 * Two per-IP budgets for password reset. Mounted HERE, after express.json(), because the inner one
 * needs the address out of the request body.
 *
 * It used to be one budget of 10 per 15 minutes keyed on IP alone. Everyone at a hotel shares one
 * connection, so that was about three staff per property per quarter-hour before the fourth
 * colleague was told to come back later — and a couple of people fumbling their code used up the
 * allowance the rest needed.
 *
 * So the budget people actually feel is now PER ADDRESS: your own attempts are the only ones that
 * can exhaust it. That alone would let one machine walk the whole staff directory, since each
 * address brings a fresh allowance, so a much higher per-connection ceiling sits behind it. The
 * ceiling is far above any real office — 40 staff all resetting at once is ~120 requests against a
 * limit of 400 — and far below what mailing 400 people repeatedly would need.
 *
 * Neither of these is the protection that matters. The per-ACCOUNT budget in
 * passwordResetThrottle — 1/min, 3 per 15 min, 15 failures per sliding hour — is what bounds an
 * attacker, and it does not care which connection the requests arrive on.
 *
 * The address is hashed into the key rather than stored raw: this is an in-memory map keyed by
 * something a stranger supplies, and there is no reason for it to hold a list of staff emails.
 */
export const passwordResetRateStore = new MemoryStore();
export const passwordResetCeilingStore = new MemoryStore();

const perAddressKey = (req: express.Request): string => {
  const ip = ipKeyGenerator(req.ip ?? '');
  const raw = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
  if (!raw) return `${ip}|-`; // malformed body: the schema will reject it, but it still costs a slot
  return `${ip}|${createHash('sha256').update(raw).digest('base64url').slice(0, 22)}`;
};

const perAddressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts for this email address. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perAddressKey,
  store: passwordResetRateStore,
});

const perConnectionCeiling = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 400,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: false, // the per-address limiter owns the RateLimit-* headers; two sets would confuse
  legacyHeaders: false,
  store: passwordResetCeilingStore,
});

for (const path of ['/api/v1/password-reset/request', '/api/v1/password-reset/confirm']) {
  app.use(path, perConnectionCeiling, perAddressLimiter);
}

// ─── Health check (public, lightweight, with a DB ping) ───
const healthHandler = async (_req: express.Request, res: express.Response) => {
  try {
    await db.raw('SELECT 1');
    // A reachable database is not the same as a USABLE one. When the schema is behind the build,
    // every query naming a newer column fails while this endpoint cheerfully reports "ok" — which
    // is what it did all the while the employees page was returning 500s.
    const schema = await getCachedSchemaState();
    res.json({
      status: schema.ok ? 'ok' : 'degraded',
      db: 'up',
      schema: schema.error
        ? { verified: false, why: schema.error }
        : { verified: true, applied: schema.applied, pending: schema.pending.length, behind_by: schema.pending },
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down', timestamp: new Date().toISOString() });
  }
};
app.get('/health', healthHandler);
app.get('/api/v1/health', healthHandler);

// Audit trail — records every mutating API request on completion.
app.use('/api/v1', auditLogger);

app.use('/api/v1', routes);

app.use(errorHandler);

export default app;
