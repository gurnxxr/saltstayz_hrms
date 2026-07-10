'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

/** The windowed page list: 1 2 3 4 5 … 20 / 1 … 9 10 11 … 20 / 1 … 16 17 18 19 20 */
export function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

/** Slice a client-side list for the current page. Pairs with <Pagination />. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

interface PaginationProps {
  /** Total rows across ALL pages — not the length of the visible slice. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** How many rows are on screen right now; drives the "Showing X–Y" text. */
  shown?: number;
  /** Plural noun for the count, e.g. "employees". */
  itemLabel?: string;
  className?: string;
}

/**
 * The one pagination bar. Extracted from the Employees list so every employee table
 * looks and behaves the same. Purely presentational — it neither fetches nor slices,
 * so it serves server-paginated callers (Employees) and client-paginated ones alike.
 *
 * Renders nothing when everything fits on one page: a lone "Page 1 of 1" is noise.
 */
export default function Pagination({
  total, page, pageSize, onPageChange, shown, itemLabel = 'rows', className = '',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(1, page), totalPages);
  const startIdx = (current - 1) * pageSize;
  const lastIdx = startIdx + (shown ?? Math.min(pageSize, total - startIdx));

  return (
    <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/30 ${className}`}>
      <p className="text-xs text-secondary">
        Showing <span className="font-medium text-foreground">{total === 0 ? 0 : startIdx + 1}</span>–
        <span className="font-medium text-foreground">{lastIdx}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> {itemLabel}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, current - 1))}
          disabled={current === 1}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        {getPageNumbers(current, totalPages).map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-xs text-secondary">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p as number)}
              aria-current={current === p ? 'page' : undefined}
              className={`min-w-[32px] px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                current === p ? 'bg-primary text-white' : 'text-foreground border border-border hover:bg-muted'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          onClick={() => onPageChange(Math.min(totalPages, current + 1))}
          disabled={current === totalPages}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-foreground border border-border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
