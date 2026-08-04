import { createHmac } from 'crypto';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { admin, emailOTP } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';
import { env } from './env';
import { sendMail } from '../services/mailer';

// Better Auth owns identity + credentials + sessions. It runs against the SAME PostgreSQL database
// as Knex, on its own small pg pool. It ADOPTS the existing integer `users` table (numeric ids via
// generateId:'serial') so the ~50 downstream foreign keys to users.id are preserved; it uses its
// own `session`, `account`, `verification` tables (created by the baseline schema migration).
// Those three tables use camelCase columns (userId, expiresAt, …) — the baseline creates them with
// exactly those quoted names, which is what Better Auth's query layer expects.
const authPool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  max: 5,
});

export const auth = betterAuth({
  database: authPool,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/v1/auth',
  trustedOrigins: [env.CLIENT_URL],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 4, // existing demo passwords are 4 chars ("1234")
    // Hash + verify with bcrypt so existing password hashes keep working and new passwords
    // use the same scheme — no forced resets during the migration.
    password: {
      hash: (password: string) => bcrypt.hash(password, env.JWT_ROUNDS),
      verify: ({ hash, password }: { hash: string; password: string }) => bcrypt.compare(password, hash),
    },
    // A reset is a claim that the old credential is compromised or lost. Leaving live sessions
    // running would mean the attacker who prompted the reset keeps their access. `authenticate`
    // does a live session lookup on every request, so deletion bites on the very next one.
    revokeSessionsOnPasswordReset: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,     // slide the expiry once a day of use
  },
  advanced: {
    // Keep users.id an integer autoincrement (the whole reason we adopt the existing table).
    database: { generateId: 'serial' },
    cookiePrefix: 'saltstayz',
    useSecureCookies: env.NODE_ENV === 'production',
    // Production only: the Vercel front end and this API live on different sites, so the browser
    // only returns the session cookie on cross-site requests when it is SameSite=None + Secure.
    // In dev we keep the defaults (localhost over http), where None/Secure would stop the cookie
    // from being stored at all. (If the API is ever put on a SUBDOMAIN of the front end's domain,
    // prefer crossSubDomainCookies + SameSite=Lax instead — more robust than None.)
    ...(env.NODE_ENV === 'production'
      ? { defaultCookieAttributes: { sameSite: 'none' as const, secure: true } }
      : {}),
  },
  user: {
    modelName: 'users',
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    // App-owned columns Better Auth carries on the session so `authenticate` can rebuild the
    // existing req.user shape (and RBAC keeps working unchanged). input:false = not settable
    // by the client at sign-up.
    additionalFields: {
      role_id: { type: 'number', input: false, required: false },
      employee_id: { type: 'number', input: false, required: false },
      is_active: { type: 'boolean', input: false, required: false },
    },
  },
  plugins: [
    admin(),
    /**
     * One-time codes, used for exactly one thing: self-service password reset.
     *
     * Read the two `disableSignUp` and `storeOTP` notes before changing anything here — both
     * defaults in this plugin are wrong for us, and one of them is an open door.
     */
    emailOTP({
      otpLength: 6,
      expiresIn: 600,      // 10 minutes; long enough for slow mail, short enough to be worth little
      allowedAttempts: 5,  // 5 guesses at 1-in-a-million; see passwordResetThrottle for the rest

      /**
       * MANDATORY. Registering this plugin also mounts `/sign-in/email-otp`, whose handler CREATES
       * A USER when the address matches none and this flag is falsy — which is the default. Left
       * alone, anyone able to reach the API could mint themselves an account on an HRMS holding
       * salaries and Aadhaar numbers. `app.ts` 404s the route as well; this is the real fix.
       */
      disableSignUp: true,

      /**
       * Keyed hash, and neither of the obvious alternatives.
       *
       * `"plain"` puts live codes in the database in cleartext. `"hashed"` is unsalted SHA-256 —
       * over a six-digit code that is a million-row rainbow table, precomputable once and then
       * instant, so anyone who can read `verification` reads every live code.
       *
       * bcrypt cannot be used, which is worth stating because it is the reflex: verification
       * re-hashes the submitted code and compares digests, so the hook must be DETERMINISTIC. A
       * fresh bcrypt salt per call would make every correct code fail — at runtime, not at compile
       * time. HMAC is deterministic and keyed, so the database alone is not enough.
       */
      storeOTP: {
        hash: async (otp: string) => createHmac('sha256', env.OTP_PEPPER).update(otp).digest('base64url'),
      },

      async sendVerificationOTP({ email, otp, type }) {
        // Only the reset flow is offered. Anything else reaching here is a route we did not intend
        // to expose, and sending a code for it would be the bug.
        if (type !== 'forget-password') throw new Error(`unsupported OTP type: ${type}`);
        await sendMail({
          to: email,
          subject: 'Your SaltStayz HRMS password reset code',
          text: [
            'Someone asked to reset the password on your SaltStayz HRMS account.',
            '',
            `Your code is ${otp}`,
            '',
            'It expires in 10 minutes and can be used once.',
            'If this was not you, no action is needed — your password has not changed.',
          ].join('\n'),
        });
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        // Legacy `users.password_hash` is NOT NULL and Better Auth never sets it (the real
        // credential lives in the `account` table). Supply an unusable placeholder so an
        // admin-created user inserts cleanly, without rebuilding the table (which its ~50
        // inbound foreign keys make risky).
        before: async (user: Record<string, unknown>) => ({
          data: { ...user, password_hash: (user.password_hash as string) ?? '' },
        }),
      },
    },
  },
});

export type Auth = typeof auth;
