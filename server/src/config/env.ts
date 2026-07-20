import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';

// Better Auth secret: reuse JWT_SECRET if a dedicated one isn't set, so a single secret
// still works. Must be ≥32 chars (Better Auth requirement).
const DEV_SECRET = 'saltstayz-hrms-dev-only-secret-key-change-in-production';
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET || DEV_SECRET;

if (NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET && !process.env.JWT_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is required in production');
}

export const env = {
  // JWT_* retained during the Better Auth migration; removed once the old path is gone.
  JWT_SECRET: process.env.JWT_SECRET || DEV_SECRET,
  JWT_ROUNDS: 12,
  BETTER_AUTH_SECRET,
  // The API's own base URL (where Better Auth is mounted).
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || `http://localhost:${process.env.SERVER_PORT || '5000'}`,
  SERVER_PORT: parseInt(process.env.SERVER_PORT || '5000', 10),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  NODE_ENV,
};
