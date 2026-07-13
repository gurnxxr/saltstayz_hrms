'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Copy, ClipboardCopy, RefreshCw, UserPlus, Loader2, ShieldAlert, X, Check } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

// A friendly, unambiguous initial password (no l/1/O/0) the admin can share.
function genPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function copyText(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); }
  catch { toast.error('Copy failed — copy it manually'); }
}

export default function CredentialsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'admin';
  const queryClient = useQueryClient();
  const [resetFor, setResetFor] = useState<any | null>(null);
  const [creatingFor, setCreatingFor] = useState<number | null>(null);

  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ['admin-credentials'],
    queryFn: () => api.get('/admin/credentials').then(r => r.data),
    enabled: isAdmin,
  });
  const { data: unlinked = [] } = useQuery({
    queryKey: ['admin-unlinked-employees'],
    queryFn: () => api.get('/admin/users/unlinked-employees').then(r => r.data),
    enabled: isAdmin,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/users/roles').then(r => r.data),
    enabled: isAdmin,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });
    queryClient.invalidateQueries({ queryKey: ['admin-unlinked-employees'] });
  };

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-24 text-secondary">
          <ShieldAlert size={40} className="opacity-40 mb-3" />
          <p className="text-sm">This page is available to administrators only.</p>
        </div>
      </AppShell>
    );
  }

  const name = (c: any) => [c.first_name, c.last_name].filter(Boolean).join(' ') || '—';

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'User Credentials' }]} />
          <h1 className="text-2xl font-bold text-foreground">User Credentials</h1>
          <p className="text-secondary mt-1">Login email &amp; password for every HRMS user.</p>
        </div>

        {/* New hires who still need a login (what the transfer-to-manager reminder points here for). */}
        {unlinked.length > 0 && (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <UserPlus size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-foreground">{unlinked.length} employee{unlinked.length === 1 ? '' : 's'} without a login</h2>
            </div>
            <div className="divide-y divide-border">
              {unlinked.map((emp: any) => (
                <div key={emp.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{emp.first_name} {emp.last_name}</p>
                      <p className="text-xs text-secondary truncate">{emp.employee_code}{emp.email ? ` · ${emp.email}` : ''}</p>
                    </div>
                    {creatingFor !== emp.id && (
                      <button
                        onClick={() => setCreatingFor(emp.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors shrink-0"
                      >
                        Set email &amp; password
                      </button>
                    )}
                  </div>
                  {creatingFor === emp.id && (
                    <CreateLoginForm
                      employee={emp}
                      roles={roles}
                      onCancel={() => setCreatingFor(null)}
                      onCreated={() => { setCreatingFor(null); invalidate(); }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The table: email + password for every user. */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-secondary uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Password</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}><td colSpan={4} className="px-4 py-3"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : credentials.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-secondary">No users found.</td></tr>
                ) : credentials.map((c: any) => (
                  <tr key={c.id} className={`hover:bg-muted/30 ${c.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{name(c)}</p>
                      <p className="text-xs text-secondary capitalize">
                        {c.employee_code ? `${c.employee_code} · ` : ''}{String(c.role_name || '').replace(/_/g, ' ')}{c.is_active ? '' : ' · inactive'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs text-foreground break-all">{c.email}</span>
                        <button onClick={() => copyText(c.email, 'Email')} title="Copy email" className="p-1 rounded text-secondary hover:text-primary hover:bg-primary/5 shrink-0">
                          <Copy size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.initial_password ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-foreground">{c.initial_password}</span>
                          <button onClick={() => copyText(c.initial_password, 'Password')} title="Copy password" className="p-1 rounded text-secondary hover:text-primary hover:bg-primary/5 shrink-0">
                            <Copy size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-secondary italic">Changed by user</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.initial_password && (
                          <button
                            onClick={() => copyText(`Email: ${c.email}\nPassword: ${c.initial_password}`, 'Login')}
                            title="Copy email + password to share"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors"
                          >
                            <ClipboardCopy size={13} /> Copy
                          </button>
                        )}
                        <button
                          onClick={() => setResetFor(c)}
                          title="Set a new password"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors"
                        >
                          <RefreshCw size={13} /> Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {resetFor && (
        <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} onDone={() => { setResetFor(null); invalidate(); }} />
      )}
    </AppShell>
  );
}

function CreateLoginForm({ employee, roles, onCancel, onCreated }: {
  employee: any; roles: any[]; onCancel: () => void; onCreated: () => void;
}) {
  const employeeRoleId = roles.find((r: any) => r.name === 'employee')?.id ?? roles[0]?.id ?? '';
  const [email, setEmail] = useState(employee.email || '');
  const [password, setPassword] = useState(() => genPassword());
  const [roleId, setRoleId] = useState<string>(String(employeeRoleId));

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/users', {
      email: email.trim(), password, role_id: Number(roleId), employee_id: employee.id,
    }),
    onSuccess: () => { toast.success('Login created'); onCreated(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create login'),
  });

  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-muted/30 border border-border rounded-lg p-3">
      <div>
        <label className="block text-xs text-secondary mb-1">Login email</label>
        <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@saltstayz.com" />
      </div>
      <div>
        <label className="block text-xs text-secondary mb-1">Access level</label>
        <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r: any) => <option key={r.id} value={r.id} className="capitalize">{String(r.name).replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="block text-xs text-secondary mb-1">Password (shareable)</label>
        <div className="flex gap-2">
          <input className={`${inputCls} font-mono`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setPassword(genPassword())} title="Generate a new one"
            className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors shrink-0">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <button onClick={onCancel} className="inline-flex items-center gap-1 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">
          <X size={14} /> Cancel
        </button>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !email.trim() || !password.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create login
        </button>
      </div>
    </div>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState(() => genPassword());

  const resetMutation = useMutation({
    mutationFn: () => api.put(`/admin/users/${user.id}/reset-password`, { password }),
    onSuccess: () => { toast.success('Password reset'); onDone(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to reset password'),
  });

  const label = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Reset password</h2>
            <p className="text-sm text-secondary">{label} · <span className="font-mono text-xs">{user.email}</span></p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-secondary hover:text-foreground hover:bg-muted"><X size={18} /></button>
        </div>
        <div>
          <label className="block text-xs text-secondary mb-1">New password (shareable)</label>
          <div className="flex gap-2">
            <input className={`${inputCls} font-mono`} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" onClick={() => setPassword(genPassword())} title="Generate a new one"
              className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors shrink-0">
              <RefreshCw size={14} />
            </button>
          </div>
          <p className="text-[11px] text-amber-700 mt-2">This replaces the user&apos;s current password immediately.</p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">Cancel</button>
          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending || password.trim().length < 4}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {resetMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reset password
          </button>
        </div>
      </div>
    </div>
  );
}
