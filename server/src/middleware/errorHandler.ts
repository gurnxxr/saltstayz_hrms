import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  const isProduction = process.env.NODE_ENV === 'production';
  console.error(`[${new Date().toISOString()}] Unhandled error:`, isProduction ? err.message : err);
  res.status(500).json({
    error: 'Internal server error',
  });
}
