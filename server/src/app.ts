import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit, { MemoryStore } from 'express-rate-limit';
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

// Password reset is unauthenticated and changes credentials, so it gets its own per-IP budget.
// Tighter than sign-in: a legitimate user needs two requests, not fifteen. This is only the OUTER
// limit — the per-ACCOUNT budget that actually bounds an attacker lives in passwordResetThrottle,
// because an IP limit is worth little to someone with more than one address.
//
// The store is built explicitly and exported so the test suite can clear it between cases. The
// alternative — switching the limiter off under NODE_ENV=test — would mean the only thing standing
// between a stranger and this endpoint is never exercised by a single test. Every request in a
// suite arrives from one address, so without a reset the tests spend the real budget on each other
// and then measure 429s instead of the logic; with it, the limiter runs in its production shape and
// gets a test of its own.
export const passwordResetRateStore = new MemoryStore();
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: passwordResetRateStore,
});
app.use('/api/v1/password-reset/request', passwordResetLimiter);
app.use('/api/v1/password-reset/confirm', passwordResetLimiter);

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

// Better Auth handles all /api/v1/auth/* routes (sign-in, sign-out, session, admin user mgmt).
// It MUST be mounted BEFORE express.json() — it parses its own request bodies.
app.all('/api/v1/auth/*', toNodeHandler(auth));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: false }));
app.use(cookieParser());
app.use('/uploads', express.static('uploads'));

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
