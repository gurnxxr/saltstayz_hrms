'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Distinct "couldn't load" state for failed queries — so a fetch error is never
 * mistaken for genuinely empty data (e.g. "No holidays configured" when the server
 * is actually down). Pass react-query's `refetch` as `onRetry`.
 */
export default function LoadError({
  message = "Couldn't load this data.",
  onRetry,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-1.5 ${compact ? 'py-6' : 'py-12'}`}>
      <AlertTriangle size={compact ? 24 : 30} className="text-red-500 opacity-80" />
      <p className="text-sm font-medium text-foreground">{message}</p>
      <p className="text-xs text-secondary">The server may be unavailable — this is not the same as “no data”.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}
