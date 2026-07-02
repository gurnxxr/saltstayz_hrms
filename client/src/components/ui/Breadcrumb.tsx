'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export type Crumb = { label: string; href?: string };

/**
 * Consistent navigation chrome for sub-pages (e.g. "Admin › Budget Control").
 * The last crumb is the current page (not a link); earlier crumbs with an `href`
 * link back. Replaces the hand-rolled per-page "← Back to Admin" buttons.
 */
export default function Breadcrumb({ items, className = '' }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`flex items-center flex-wrap gap-1.5 text-sm ${className}`}>
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={14} className="text-secondary/50 shrink-0" />}
            {isLast || !c.href ? (
              <span className={isLast ? 'font-medium text-foreground' : 'text-secondary'}>{c.label}</span>
            ) : (
              <Link href={c.href} className="text-secondary hover:text-foreground transition-colors">{c.label}</Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
