'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { btnCls, inputCls } from '@/components/ui/styles';
import { cn } from '@/lib/utils';

/**
 * Reject-with-reason — one interaction for both the leave queue and the encashment queue.
 *
 * Leave used to do this inline in the row: the Approve/Reject pair was swapped for a 160px <input>
 * and a Confirm, so the row's controls changed identity under the cursor, Escape did nothing, and
 * Confirm ignored isPending — a second click fired a second PUT and the server's "Only pending
 * requests can be rejected" turned a successful rejection into a red error toast. Encashment
 * already used a dialog with a textarea and a loading state. That one wins.
 *
 * The reason is REQUIRED by default. It is the only thing the employee is ever told about why, and
 * the server stored `rejection_reason || null` — so a rejection routinely reached somebody with no
 * explanation at all.
 */
interface RejectDialogProps {
  open: boolean;
  title: string;
  /** One line naming what is being rejected, and what it does or doesn't change. */
  subject?: ReactNode;
  loading?: boolean;
  /**
   * Encashment passes false to keep its existing behaviour. Worth revisiting — a rejected
   * encashment tells the employee just as little as a rejected leave request did.
   */
  requireReason?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * The gate exists so the body below can hold the draft reason in ordinary state.
 *
 * Closing unmounts the body and the draft goes with it, so the next rejection starts blank — a
 * reason written about one person can never be pre-filled against another. Doing that with an
 * effect that clears state on open would fire a second render every time the dialog opened, which
 * is the cascade `react-hooks/set-state-in-effect` is there to catch.
 */
export default function RejectDialog(props: RejectDialogProps) {
  if (!props.open) return null;
  return <RejectDialogBody {...props} />;
}

function RejectDialogBody({
  title, subject, loading = false, requireReason = true, onCancel, onConfirm,
}: RejectDialogProps) {
  const [reason, setReason] = useState('');
  const blocked = loading || (requireReason && !reason.trim());

  return (
    <Modal
      open
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel} disabled={loading} className={btnCls('secondary')}>
            Cancel
          </button>
          <button onClick={() => onConfirm(reason.trim())} disabled={blocked} className={btnCls('danger')}>
            {loading && <Loader2 size={14} className="animate-spin" />} Reject
          </button>
        </>
      }
    >
      {subject && <p className="text-sm text-secondary">{subject}</p>}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Reason {requireReason ? <span className="text-red-600">*</span> : <span className="text-secondary font-normal">(optional)</span>}
        </label>
        <textarea
          rows={3}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={requireReason ? 'They will be told exactly this' : 'Reason'}
          className={cn(inputCls, 'resize-none')}
        />
      </div>
    </Modal>
  );
}
