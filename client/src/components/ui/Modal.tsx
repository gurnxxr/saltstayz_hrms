'use client';

import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The shell every hand-rolled overlay in the leaves module was retyping.
 *
 * Four of them repeated the same three lines — `fixed inset-0 z-50 flex items-center justify-center
 * p-4`, `absolute inset-0 bg-black/50`, `relative bg-card rounded-xl border border-border shadow-xl`
 * — and then disagreed about everything after: two had a bordered header with a close button and two
 * had a loose <h3>, two had a footer bar and two had a bare button row. None of the four closed on
 * Escape or kept focus inside the dialog, so Tab walked straight out onto the page underneath while
 * the overlay was still covering it. ConfirmDialog has handled Escape since it was written; these
 * never did.
 *
 * The header is mandatory. All four dialogs this replaces DID have a title — two just drew it in the
 * wrong place — and making it required is what turns four shapes into one. The footer is optional,
 * because a dialog with nothing to confirm has no action row.
 *
 * ConfirmDialog is deliberately NOT rebuilt on top of this. It has ~15 call sites outside leaves,
 * it confirms on Enter and autofocuses its confirm button (which this focus trap would fight over),
 * and its icon-beside-title alert layout has no header bar for this to absorb. Folding it in would
 * be an app-wide change for no visible gain.
 */
export default function Modal({
  open, title, size = 'md', footer, onClose, children,
}: {
  open: boolean;
  /** Required. All four dialogs this replaces had one; two just drew it in the body. */
  title: string;
  /** The three widths actually in use — no others. */
  size?: 'sm' | 'md' | 'lg';
  /** The action row, in a bordered bar. Omit for a dialog with nothing to confirm. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Held in a ref, not a dependency. Every call site passes an inline arrow, so depending on
  // onClose would re-run the effect below on every parent render — and that effect MOVES FOCUS, so
  // the user would be thrown back to the first field on each keystroke. ConfirmDialog has the same
  // dependency but only re-registers a listener, which is why it gets away with it.
  //
  // Written in an effect rather than during render: a ref is not a render-time value, and mutating
  // one while rendering is what `react-hooks/refs` exists to catch. No dependency array, so it
  // re-syncs after every render — which is exactly the intent.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    // Where focus was before the dialog took it, so closing can hand it back.
    const opener = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    // The first FIELD, falling back to the first focusable. Without this the close button wins,
    // because it is the first focusable in every dialog — so a dialog whose whole purpose is
    // typing a reason would open with the cursor on its X. Note React's `autoFocus` prop cannot be
    // detected here: React focuses imperatively and never renders the `autofocus` attribute, so a
    // querySelector for it matches nothing.
    const field = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
    );
    (field ?? focusables()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      // Queried fresh each time: a dialog's fields can appear and disappear as the form is filled
      // in — the encashment balance hint and the accrual block both do exactly that.
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={panelRef}
        className={cn(
          'relative bg-card rounded-xl border border-border shadow-xl w-full',
          size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {/* Capped so a long form scrolls inside the dialog rather than off the viewport. The Leave
            Type editor already needed this and had grown it locally; every dialog gets it free. */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">{footer}</div>
        )}
      </div>
    </div>
  );
}
