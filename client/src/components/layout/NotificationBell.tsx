'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import {
  Bell, Check, CalendarCheck, CalendarX, CalendarClock, Wallet,
  UserPlus, FileText, UserMinus, Info, CheckCheck, TrendingUp, KeyRound,
  Lock, LockOpen, AlertTriangle, Coins, ArrowLeftRight, ServerCrash, Gavel,
} from 'lucide-react';

const ICONS: Record<string, React.ElementType> = {
  leave_approved: CalendarCheck,
  leave_approved_fyi: CalendarCheck,
  leave_rejected: CalendarX,
  leave_rejected_fyi: CalendarX,
  leave_requested: CalendarClock,
  payslip_ready: Wallet,
  onboarding_assigned: UserPlus,
  offer_letter: FileText,
  offboarding_initiated: UserMinus,
  offboarding_completed: UserMinus,
  fnf_saved: Coins,
  promotion: TrendingUp,
  employee_transferred: ArrowLeftRight,
  shift_change_requested: CalendarClock,
  shift_change_approved: CalendarCheck,
  shift_change_approved_fyi: CalendarCheck,
  shift_change_rejected: CalendarX,
  login_setup_required: KeyRound,
  payroll_locked: Lock,
  payroll_unlocked: LockOpen,
  payroll_locked_override: AlertTriangle,
  reprice_blocked: AlertTriangle,
  hiring_exception_approved: Gavel,
  hiring_exception_rejected: Gavel,
  backup_failed: ServerCrash,
  auto_attendance_failed: ServerCrash,
  info: Info,
};

const ICON_TINT: Record<string, string> = {
  leave_approved: 'text-green-600 bg-green-100',
  leave_approved_fyi: 'text-green-600 bg-green-100',
  leave_rejected: 'text-red-600 bg-red-100',
  leave_rejected_fyi: 'text-red-600 bg-red-100',
  leave_requested: 'text-amber-600 bg-amber-100',
  payslip_ready: 'text-blue-600 bg-blue-100',
  onboarding_assigned: 'text-primary bg-primary/10',
  offer_letter: 'text-indigo-600 bg-indigo-100',
  offboarding_initiated: 'text-red-600 bg-red-100',
  offboarding_completed: 'text-red-600 bg-red-100',
  fnf_saved: 'text-blue-600 bg-blue-100',
  promotion: 'text-emerald-600 bg-emerald-100',
  employee_transferred: 'text-indigo-600 bg-indigo-100',
  shift_change_requested: 'text-amber-600 bg-amber-100',
  shift_change_approved: 'text-green-600 bg-green-100',
  shift_change_approved_fyi: 'text-green-600 bg-green-100',
  shift_change_rejected: 'text-red-600 bg-red-100',
  login_setup_required: 'text-amber-600 bg-amber-100',
  payroll_locked: 'text-blue-600 bg-blue-100',
  // The three that mean "a person needs to look at this", tinted so they stand out in the list.
  payroll_unlocked: 'text-red-600 bg-red-100',
  payroll_locked_override: 'text-red-600 bg-red-100',
  reprice_blocked: 'text-red-600 bg-red-100',
  hiring_exception_approved: 'text-green-600 bg-green-100',
  hiring_exception_rejected: 'text-red-600 bg-red-100',
  backup_failed: 'text-red-600 bg-red-100',
  auto_attendance_failed: 'text-red-600 bg-red-100',
  info: 'text-secondary bg-muted',
};

export default function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: countData } = useQuery({
    queryKey: ['notif-unread'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    refetchInterval: 30000,          // poll every 30s
    refetchOnWindowFocus: true,
  });
  const unread = countData?.count ?? 0;

  const { data: items = [] } = useQuery({
    queryKey: ['notif-list'],
    queryFn: () => api.get('/notifications').then(r => r.data),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notif-unread'] });
    queryClient.invalidateQueries({ queryKey: ['notif-list'] });
  };

  const markRead = useMutation({
    mutationFn: (id: number) => api.put(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: invalidate,
  });

  const openItem = (n: any) => {
    if (!n.is_read) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="relative p-2 text-secondary hover:text-foreground transition-colors rounded-lg hover:bg-muted" aria-label="Notifications">
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-xl shadow-lg z-20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {unread > 0 && (
                <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs text-primary hover:underline">
                  <CheckCheck size={13} /> Mark all read
                </button>
              )}
            </div>
            <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-secondary">
                  <Bell size={24} className="mx-auto opacity-30 mb-2" /> You&apos;re all caught up
                </div>
              ) : items.map((n: any) => {
                const Icon = ICONS[n.type] || Info;
                return (
                  <button key={n.id} onClick={() => openItem(n)}
                    className={`w-full text-left px-4 py-3 flex gap-3 transition-colors hover:bg-muted/40 ${n.is_read ? '' : 'bg-primary/5'}`}>
                    <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${ICON_TINT[n.type] || ICON_TINT.info}`}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{n.title}</span>
                        {!n.is_read && <span className="shrink-0 w-2 h-2 rounded-full bg-primary" />}
                      </span>
                      {n.message && <span className="block text-xs text-secondary mt-0.5 line-clamp-2">{n.message}</span>}
                      <span className="block text-[11px] text-secondary mt-1">{formatDateTime(n.created_at)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
