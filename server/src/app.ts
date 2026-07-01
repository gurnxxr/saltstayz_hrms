import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import db from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { auditLogger } from './middleware/audit';
import routes from './routes';

const app = express();

app.use(helmet({
  contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: false }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/uploads', express.static('uploads'));

// ─── Health check (public, lightweight, with a DB ping) ───
const healthHandler = async (_req: express.Request, res: express.Response) => {
  try {
    await db.raw('SELECT 1');
    res.json({
      status: 'ok',
      db: 'up',
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
