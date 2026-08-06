'use client';

import { cn } from '@/lib/utils';

/**
 * The "there is genuinely nothing here" state, once.
 *
 * Eleven inline versions existed across the leaves module and no two agreed: padding ran p-6 / p-8 /
 * p-10 / py-20, the icon was absent or 32px or 40px at opacity-30 or opacity-40, and nine of the
 * eleven were a bare sentence with no hierarchy at all — including one that was a
 * <tr><td colSpan={6}> and one, on Balances, with no icon. This is My Holidays' EmptyYear, which
 * was the best of them, with the variation taken out.
 *
 * NOT a load failure. Use LoadError for that, so "No encashments yet" can never be what somebody
 * reads while the server is down — which is the exact confusion LoadError was written to prevent.
 */
export default function EmptyState({
  icon: Icon, title, body, action, compact = false, className,
}: {
  /** A lucide icon. Always pass one — a bare sentence is precisely what this replaces. */
  icon: React.ElementType;
  /** What is missing, as a statement. "No leave requests yet", not "No data". */
  title: string;
  /** One sentence on what would put something here. Skip it only when nothing can. */
  body?: string;
  /** The single thing to do about it — e.g. an "Apply for leave" button. */
  action?: React.ReactNode;
  /** For a panel inside a page rather than the page's main region. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('text-center', compact ? 'p-6' : 'p-10', className)}>
      <Icon size={32} className="mx-auto mb-3 text-secondary opacity-40" />
      <p className="text-base font-medium text-foreground">{title}</p>
      {body && <p className="text-sm text-secondary mt-1 max-w-md mx-auto">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
