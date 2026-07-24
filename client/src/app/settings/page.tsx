'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { KeyRound, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });

  const passwordMutation = useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      api.post('/auth/change-password', data).then(r => r.data),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to change password'),
  });

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.newPassword.length < 4) { toast.error('New password must be at least 4 characters'); return; }
    if (pw.newPassword !== pw.confirm) { toast.error('New password and confirmation do not match'); return; }
    passwordMutation.mutate({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
  }

  // Inline password validation (no submit round-trip needed).
  const pwTooShort = pw.newPassword.length > 0 && pw.newPassword.length < 4;
  const pwMismatch = pw.confirm.length > 0 && pw.newPassword !== pw.confirm;
  const pwValid = pw.currentPassword.length > 0 && pw.newPassword.length >= 4 && pw.newPassword === pw.confirm;

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Settings</h1>
          <p className="text-secondary mt-1">Manage your account</p>
        </div>

        {/* Change Password */}
        <div className="bg-card rounded-xl border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-muted/50">
              <KeyRound size={16} className="text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Change Password</h2>
              <p className="text-xs text-secondary">Update the password you use to sign in</p>
            </div>
          </div>
          <form onSubmit={submitPassword} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Current Password</label>
              <input
                type="password"
                required
                value={pw.currentPassword}
                onChange={(e) => setPw(p => ({ ...p, currentPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
              <input
                type="password"
                required
                minLength={4}
                value={pw.newPassword}
                onChange={(e) => setPw(p => ({ ...p, newPassword: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {pwTooShort && <p className="text-xs text-red-600 mt-1">Must be at least 4 characters.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
              <input
                type="password"
                required
                value={pw.confirm}
                onChange={(e) => setPw(p => ({ ...p, confirm: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {pwMismatch && <p className="text-xs text-red-600 mt-1">Passwords don&apos;t match.</p>}
            </div>
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={passwordMutation.isPending || !pwValid}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {passwordMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                Update Password
              </button>
            </div>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
