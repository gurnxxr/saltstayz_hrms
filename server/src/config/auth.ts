import path from 'path';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import bcrypt from 'bcryptjs';
import { env } from './env';

// Better Auth owns identity + credentials + sessions. It runs against the SAME SQLite file
// as Knex, on its own better-sqlite3 connection (WAL allows many readers + one writer, so the
// two connections coexist). It ADOPTS the existing integer `users` table (numeric ids via
// generateId:'serial') so the ~50 downstream foreign keys to users.id are preserved; it adds
// its own `session`, `account`, `verification` tables (created by migration 084).
const authDb = new Database(path.join(__dirname, '../../data/hrms.db'));
authDb.pragma('journal_mode = WAL');
authDb.pragma('foreign_keys = ON');
authDb.pragma('busy_timeout = 5000');

export const auth = betterAuth({
  database: authDb,
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
  plugins: [admin()],
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
