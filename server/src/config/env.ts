import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';

if (!process.env.JWT_SECRET && NODE_ENV === 'production') {
  throw new Error('JWT_SECRET environment variable is required in production');
}

export const env = {
  JWT_SECRET: process.env.JWT_SECRET || 'saltstayz-hrms-dev-only-secret-key-change-in-production',
  JWT_ROUNDS: 12,
  SERVER_PORT: parseInt(process.env.SERVER_PORT || '5000', 10),
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',
  NODE_ENV,
};
