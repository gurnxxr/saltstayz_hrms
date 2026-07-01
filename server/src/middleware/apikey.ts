import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import db from '../config/database';
import { UnauthorizedError } from '../utils/errors';

export interface ApiKeyRequest extends Request {
  apiKey?: { id: number; name: string };
}

export async function authenticateApiKey(req: ApiKeyRequest, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 16) {
    return next(new UnauthorizedError('Invalid API key format'));
  }

  const prefix = token.slice(0, 8);
  const candidates = await db('biometric_api_keys')
    .where('key_prefix', prefix)
    .where('is_active', true);

  for (const candidate of candidates) {
    const match = await bcrypt.compare(token, candidate.key_hash);
    if (match) {
      await db('biometric_api_keys').where('id', candidate.id).update({ last_used_at: db.fn.now() });
      req.apiKey = { id: candidate.id, name: candidate.name };
      return next();
    }
  }

  next(new UnauthorizedError('Invalid API key'));
}
