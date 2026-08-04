import db from '../config/database';

const TABLE = 'audit_logs';

// Keys whose values must NEVER land in the audit trail — the log itself holds
// sensitive data otherwise. Matched case-insensitively, substring-based.
const SENSITIVE_KEYS = [
  'password', 'password_hash', 'token', 'secret', 'otp',
  'aadhaar', 'pan', 'bank_account', 'account_number', 'ifsc', 'cvv', 'card',
  // 'email' matches as a substring, so personal_email and login_email go too. This is the owner's
  // decision, taken because the security checklist says PII is never logged and an email in a
  // request body is PII. It costs something real: the password-reset endpoint is unauthenticated,
  // so its audit row now says an attempt happened and from which IP, but not whose account was
  // being probed. The `actor_email` COLUMN is unaffected — that records who was signed in and
  // performed the change, which is the audit trail's whole purpose, not payload data.
  'email',
];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => k.includes(s));
}

/** Deep-redacts sensitive fields and truncates oversized payloads. */
export function redact(value: any, depth = 0): any {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitive(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 297) + '…';
  return value;
}

export interface AuditEntry {
  user_id?: number | null;
  actor_email?: string | null;
  actor_role?: string | null;
  action: string;
  module: string;
  entity?: string | null;
  target_id?: string | null;
  method: string;
  path: string;
  status_code?: number | null;
  summary?: string | null;
  metadata?: any;
  ip_address?: string | null;
}

/** Fire-and-forget write. Never throws into the request path. */
export async function record(entry: AuditEntry): Promise<void> {
  try {
    await db(TABLE).insert({
      user_id: entry.user_id ?? null,
      actor_email: entry.actor_email ?? null,
      actor_role: entry.actor_role ?? null,
      action: entry.action,
      module: entry.module,
      entity: entry.entity ?? null,
      target_id: entry.target_id ?? null,
      method: entry.method,
      path: entry.path,
      status_code: entry.status_code ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata === undefined ? null
        : typeof entry.metadata === 'string' ? entry.metadata
        : JSON.stringify(redact(entry.metadata)),
      ip_address: entry.ip_address ?? null,
    });
  } catch (err) {
    // Auditing must never break the actual operation.
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record entry:', (err as Error).message);
  }
}

export interface AuditFilters {
  search?: string;   // matches actor email or summary
  module?: string;
  action?: string;
  from?: string;     // YYYY-MM-DD
  to?: string;       // YYYY-MM-DD
  page?: number;
  limit?: number;
}

export async function list(filters: AuditFilters) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const offset = (page - 1) * limit;

  const base = db(TABLE);
  if (filters.module) base.where('module', filters.module);
  if (filters.action) base.where('action', filters.action);
  if (filters.from) base.where('created_at', '>=', `${filters.from} 00:00:00`);
  if (filters.to) base.where('created_at', '<=', `${filters.to} 23:59:59`);
  if (filters.search) {
    const s = `%${filters.search}%`;
    base.where((q) => q.where('actor_email', 'ilike', s).orWhere('summary', 'ilike', s).orWhere('target_id', 'ilike', s));
  }

  const countRow = await base.clone().count('id as c').first();
  const total = Number((countRow as any)?.c ?? 0);

  const rows = await base
    .clone()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .offset(offset);

  return {
    data: rows.map((r: any) => ({
      ...r,
      metadata: r.metadata ? safeParse(r.metadata) : null,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

/** Distinct modules/actions present, for the filter dropdowns. */
export async function meta() {
  const modules = await db(TABLE).distinct('module').orderBy('module').pluck('module');
  const actions = await db(TABLE).distinct('action').orderBy('action').pluck('action');
  return { modules, actions };
}
