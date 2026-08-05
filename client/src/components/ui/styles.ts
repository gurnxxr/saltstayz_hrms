/**
 * Shared Tailwind class strings for controls that stay plain <button> / <input> elements.
 *
 * Deliberately class constants and NOT <Button> / <Field> components. This codebase has ~200 raw
 * <button>s and zero wrapped ones; a component would need icon, loading, title, type, disabled and
 * fullWidth props just to replace a className, and importing it into the leaves module alone would
 * create exactly the seam this change exists to close. A constant is a one-token diff per call site
 * with no behaviour to get wrong.
 *
 * Every value here was extracted from a string already in the repo — the leaves module had eight
 * button geometries, four table-header treatments and `inputCls` pasted verbatim into five files.
 * Nothing below is speculative; each variant has at least one live call site.
 *
 * Override with cn(), never by appending: cn(btnCls('primary'), 'w-full') resolves against the base
 * because tailwind-merge understands the conflict, where a raw template literal would leave both
 * classes in and let source order decide. That is how `pr-*` quietly lost to `px-*` here before.
 *
 * `bg-card rounded-xl border border-border` is NOT in here. All ~20 sites already write it
 * identically; only the padding after it varies, and a constant does not fix padding.
 */
import { cn } from '@/lib/utils';

type BtnVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'dangerOutline' | 'icon' | 'iconDanger';
type BtnSize = 'sm' | 'md' | 'lg';

// `inline-flex … gap-2` sits in the base rather than being bolted on at the six sites that had
// grown their own `flex items-center gap-2`. It renders identically for a text-only button and
// means an icon or a spinner can be dropped in without touching the class.
const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const BTN_SIZE: Record<BtnSize, string> = {
  sm: 'px-3 py-1.5 text-xs',  // inside a card header or a table row
  md: 'px-4 py-2 text-sm',    // the default, and the module's existing majority
  lg: 'px-5 py-2.5 text-sm',  // a form's submit row — matches attendance/settings, the reference screen
};

const BTN_VARIANT: Record<BtnVariant, string> = {
  primary:       'bg-primary text-white hover:bg-primary/90',
  secondary:     'border border-border text-foreground hover:bg-muted',
  success:       'bg-green-600 text-white hover:bg-green-700',   // Approve, on both queues
  danger:        'bg-red-600 text-white hover:bg-red-700',
  dangerOutline: 'border border-red-200 text-red-600 hover:bg-red-50',
  icon:          'p-1.5 text-secondary hover:text-foreground hover:bg-muted',
  iconDanger:    'p-1.5 text-secondary hover:text-red-600 hover:bg-red-50',
};

/**
 * btnCls('primary') · btnCls('secondary', 'lg') · btnCls('iconDanger')
 *
 * The two icon variants carry their own padding, so `size` is ignored for them.
 */
export function btnCls(variant: BtnVariant, size: BtnSize = 'md') {
  const iconOnly = variant === 'icon' || variant === 'iconDanger';
  return cn(BTN_BASE, !iconOnly && BTN_SIZE[size], BTN_VARIANT[variant]);
}

/**
 * The field class that was pasted verbatim into five files (leaves/control-panel, leaves/encashment,
 * admin/holidays, attendance/settings, shifts/my).
 *
 * `w-full` is part of it, so a filter control that must size to its content overrides it:
 * cn(inputCls, 'w-auto'). A search field with a leading icon is cn(inputCls, 'pl-9') — tailwind-merge
 * keeps px-3's right padding and lets pl-9 win on the left, which a raw template literal cannot do.
 *
 * Covers <input>, <select> and <textarea>; a textarea adds cn(inputCls, 'resize-none').
 *
 * Note this is py-2, not the py-2.5 the Apply form had grown on its own — which is why that form's
 * fields stood visibly taller than every other form in the module.
 */
export const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

/** A form field's label. */
export const labelCls = 'block text-sm font-medium text-foreground mb-1.5';

/** A dense grid's column label — the Template row editor's fields, not a form's. */
export const labelSmCls = 'block text-xs font-medium text-secondary mb-1';

/**
 * Table chrome. The two tables on the Control Panel screen disagreed with each OTHER: one header
 * was `px-4 py-2.5 font-medium`, the other `bg-muted/40 text-xs font-semibold uppercase
 * tracking-wide`. This is the second, which is also closest to the Balances grid — so the module
 * converges on something already here instead of inventing a fifth.
 */
export const table = {
  head: 'border-b border-border bg-muted/40 text-left text-xs font-semibold text-secondary uppercase tracking-wide',
  th: 'px-4 py-3',
  body: 'divide-y divide-border',
  row: 'hover:bg-muted/20',
  td: 'px-4 py-2.5',
} as const;
