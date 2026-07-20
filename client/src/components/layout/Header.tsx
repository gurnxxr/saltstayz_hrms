'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import api from '@/lib/api';
import NotificationBell from './NotificationBell';
import { UserCircle, LogOut, ChevronDown, Settings } from 'lucide-react';

const roleLabelMap: Record<string, string> = {
  admin: 'Administrator',
  chro: 'CHRO',
  hr: 'HR',
  hr_manager: 'HR Manager',
  cluster_hr: 'Cluster HR',
  property_manager: 'Property Manager',
  employee: 'Employee',
  finance: 'Finance',
};

export default function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  // Live identity: the header shows the current email/role from the DB (via
  // /session-context, which reads them fresh from the session), refetched when the tab
  // regains focus — so an email changed in Admin → User Management appears without a re-login.
  const { data: me } = useQuery({
    queryKey: ['session-context'],
    queryFn: () => api.get('/session-context').then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!user) return null;

  const email: string = me?.user?.email ?? user.email;
  const roleName: string = me?.user?.roleName ?? user.roleName;
  const roleLabel = roleLabelMap[roleName] || roleName;

  return (
    <header className="h-16 bg-card border-b border-border flex items-center justify-end px-6 sticky top-0 z-20">
      <div className="flex items-center gap-4">
        <NotificationBell />

        {/* Profile menu (top-right) */}
        <div className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-lg p-1 pr-2 hover:bg-muted transition-colors"
            aria-label="Open profile menu"
          >
            <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-semibold">
              {email.charAt(0).toUpperCase()}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium text-foreground leading-tight max-w-[180px] truncate">{email}</p>
              <p className="text-xs text-secondary">{roleLabel}</p>
            </div>
            <ChevronDown size={15} className={`text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-lg z-20 py-1 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border">
                  <p className="text-sm font-medium text-foreground truncate">{email}</p>
                  <p className="text-xs text-secondary">{roleLabel}</p>
                </div>
                <Link
                  href="/profile"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <UserCircle size={16} className="text-secondary" /> My Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                >
                  <Settings size={16} className="text-secondary" /> Settings
                </Link>
                <button
                  onClick={() => { setOpen(false); logout(); }}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors w-full text-left border-t border-border"
                >
                  <LogOut size={16} /> Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
