import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { record, redact } from '../services/audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Trailing path segments that name an action rather than a resource.
const ACTION_VERBS = new Set([
  'approve', 'reject', 'lock', 'unlock', 'process', 'upload', 'reset-password',
  'archive', 'restore', 'regenerate', 'generate', 'assign', 'unassign',
  'toggle', 'cancel', 'submit', 'withdraw', 'bulk', 'run',
]);

function methodAction(method: string): string {
  switch (method) {
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return method.toLowerCase();
  }
}

/**
 * App-level audit middleware. Records every successful or denied mutating request
 * on response completion, deriving module/entity/target/action from the route.
 * Reads are ignored; /auth is audited explicitly elsewhere to avoid touching
 * credentials. req.user is populated by the per-router authenticate middleware,
 * which has run by the time `finish` fires.
 */
export function auditLogger(req: AuthRequest, res: Response, next: NextFunction) {
  if (!MUTATING.has(req.method)) return next();

  const cleanPath = req.originalUrl.split('?')[0].replace(/^\/api\/v1\//, '');
  // Skip auth routes (handled explicitly) and the audit log's own writes.
  if (cleanPath.startsWith('auth') || cleanPath.startsWith('admin/audit-logs')) return next();

  // Snapshot the (redacted) body now, before any handler mutates it.
  const metadata = req.body && Object.keys(req.body).length ? redact(req.body) : null;

  const segs = cleanPath.split('/').filter(Boolean);
  const module = segs[0] || 'api';
  const numeric = segs.filter((s) => /^\d+$/.test(s));
  const target_id = numeric.length ? numeric[numeric.length - 1] : null;
  const words = segs.slice(1).filter((s) => !/^\d+$/.test(s));

  let actionVerb: string | null = null;
  if (words.length && ACTION_VERBS.has(words[words.length - 1])) {
    actionVerb = words.pop()!;
  }
  const entity = words.length ? words[words.length - 1] : null;
  const action = actionVerb || methodAction(req.method);
  const label = entity || module;
  const summary = `${action} ${label}${target_id ? ` #${target_id}` : ''}`;

  res.on('finish', () => {
    // Skip unauthenticated noise (expired sessions, bots) — no actor to attribute.
    if (res.statusCode === 401) return;
    void record({
      user_id: req.user?.userId ?? null,
      actor_email: req.user?.email ?? null,
      actor_role: req.user?.roleName ?? null,
      action,
      module,
      entity,
      target_id,
      method: req.method,
      path: cleanPath,
      status_code: res.statusCode,
      summary,
      metadata,
      ip_address: req.ip ?? null,
    });
  });

  next();
}
