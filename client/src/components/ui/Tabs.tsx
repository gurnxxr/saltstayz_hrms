'use client';

import { cn } from '@/lib/utils';

/**
 * The module's top-level tab bar. Underline, not pills.
 *
 * Two styles exist in this codebase: the segmented pill (`bg-muted p-1 rounded-lg`) on 4 screens,
 * and this underline on 10 — four of which had copy-pasted a byte-identical `TabBtn` helper, class
 * string and all. Underline wins on the count, it survives four items with icons, and it reads as
 * navigation.
 *
 * The pill reads as a FILTER, which is what the nested Pending / All Requests toggle inside
 * Approvals actually was — sitting on the same row as two <select>s. That toggle is now a status
 * filter rather than a second tab strip, so this component deliberately has no pill variant and the
 * two levels can never be mistaken for peers again.
 */
export interface TabItem<K extends string> {
  key: K;
  label: string;
  /** A lucide icon, as the Control Panel's four tabs use. */
  icon?: React.ElementType;
  /**
   * Rendered as a badge after the label. Hidden at 0 — an empty queue is not news, and that
   * preserves what the string-concatenated `Approvals (3)` label used to do.
   */
  count?: number;
}

export default function Tabs<K extends string>({
  items, value, onChange, className,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-border overflow-x-auto', className)}>
      {items.map(({ key, label, icon: Icon, count }) => {
        const active = key === value;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-foreground',
            )}
          >
            {Icon && <Icon size={15} />}
            {label}
            {!!count && (
              // min-w reserves the badge's width so the tabs to its right do not slide sideways
              // when the count arrives from the server a moment after first paint.
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none',
                  active ? 'bg-primary/10 text-primary' : 'bg-muted text-secondary',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
