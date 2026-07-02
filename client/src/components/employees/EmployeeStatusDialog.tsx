'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import api from '@/lib/api';
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_META,
  STATUSES_NEEDING_LWD,
  DEPARTED_STATUSES,
  type EmployeeStatus,
} from '@/lib/employeeStatus';

const inputCls =
  'w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

export interface StatusDialogEmployee {
  id: number;
  employment_status?: string;
  last_working_day?: string | null;
  pip_start_date?: string | null;
  pip_end_date?: string | null;
  // Callers pass either a combined `name` (Property Config) or split fields (Manpower).
  name?: string;
  first_name?: string;
  last_name?: string;
}

// The single status-change dialog shared by Manpower and Property Configuration.
// Posts to PUT /manpower/employees/:id/status — the one endpoint that validates
// the required fields per status and writes the status-history row.
export default function EmployeeStatusDialog({
  employee,
  onClose,
  onSaved,
}: {
  employee: StatusDialogEmployee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const name =
    employee.name ||
    `${employee.first_name || ''} ${employee.last_name || ''}`.trim() ||
    'employee';

  const [status, setStatus] = useState<string>(employee.employment_status || 'active');
  const [reason, setReason] = useState('');
  const [lwd, setLwd] = useState(employee.last_working_day || '');
  const [pipStart, setPipStart] = useState(employee.pip_start_date || '');
  const [pipEnd, setPipEnd] = useState(employee.pip_end_date || '');

  const needsLwd = STATUSES_NEEDING_LWD.includes(status as EmployeeStatus);
  const isDeparted = DEPARTED_STATUSES.includes(status as EmployeeStatus);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/manpower/employees/${employee.id}/status`, {
        status,
        reason,
        last_working_day: lwd || undefined,
        pip_start_date: pipStart || undefined,
        pip_end_date: pipEnd || undefined,
      }),
    onSuccess: () => {
      toast.success('Status updated');
      onSaved();
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h3 className="font-semibold text-foreground">Change status — {name}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            {EMPLOYEE_STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${
                  status === s ? EMPLOYEE_STATUS_META[s].cls + ' border-current' : 'border-border hover:bg-muted'
                }`}
              >
                {EMPLOYEE_STATUS_META[s].label}
              </button>
            ))}
          </div>

          {status === 'pip' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-secondary mb-1">PIP start *</span>
                <input type="date" value={pipStart} onChange={(e) => setPipStart(e.target.value)} className={inputCls} />
              </label>
              <label className="block">
                <span className="block text-xs text-secondary mb-1">PIP end *</span>
                <input type="date" value={pipEnd} onChange={(e) => setPipEnd(e.target.value)} className={inputCls} />
              </label>
            </div>
          )}

          {needsLwd && (
            <label className="block">
              <span className="block text-xs text-secondary mb-1">Last working day *</span>
              <input type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} className={inputCls} />
            </label>
          )}

          {isDeparted && (
            <p className="text-xs text-secondary">
              Frees the headcount slot and budget, and flags the position open to backfill.
            </p>
          )}

          <label className="block">
            <span className="block text-xs text-secondary mb-1">Reason / note</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted">Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Update status'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
