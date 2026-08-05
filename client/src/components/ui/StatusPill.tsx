'use client';

import { cn } from '@/lib/utils';

/**
 * One badge, six tones — the only pill in the leaves module.
 *
 * It replaces five copies of the same status→colour map plus six chips that bypassed those maps
 * entirely: the bare Active/Inactive text on Leave Types, the "Current" period chip, the
 * "Default"/"Inactive" template chips, the regional-holiday pill on My Holidays and the neutral
 * day-count chip on Approvals. Each had picked its own padding and text size, so the same four
 * statuses rendered at three different geometries depending on which screen you were looking at.
 *
 * This file owns the paint and nothing else. WHICH status is which tone, and what it is called in
 * English, lives in lib/leaveStatus.ts — so a generic ui/ primitive never imports a domain module.
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'neutral';

/**
 * Exported on purpose: MyLeave paints the same status colour onto a 40×40 icon tile
 * (`w-10 h-10 rounded-lg`), not a pill. A tile is not a pill, so it does not get a `variant` prop
 * here — it reads the same map and brings its own geometry. One source of truth, two shapes.
 *
 * `neutral` is the design tokens rather than gray-100/gray-500. It is the same colour to the eye
 * and it removes the module's last hardcoded neutral, which lets `cancelled`, "Inactive" and the
 * day-count chip — three things that were three different greys — finally become one.
 */
export const TONE_CLS: Record<Tone, string> = {
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger:  'bg-red-100 text-red-700',
  info:    'bg-blue-100 text-blue-700',
  accent:  'bg-purple-100 text-purple-700',
  neutral: 'bg-muted text-secondary',
};

const SIZE_CLS = {
  md: 'px-2.5 py-1 text-xs',
  /** For a chip inside a dense row — a template list item, a compact table cell. */
  sm: 'px-2 py-0.5 text-[10px]',
} as const;

export default function StatusPill({
  tone, label, icon: Icon, size = 'md', className,
}: {
  tone: Tone;
  /** Already human-readable. Capitalisation is the vocabulary's job, not a CSS class's. */
  label: string;
  /** A lucide icon, for the two chips that carry one. */
  icon?: React.ElementType;
  size?: keyof typeof SIZE_CLS;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
        SIZE_CLS[size], TONE_CLS[tone], className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 10 : 12} />}
      {label}
    </span>
  );
}
