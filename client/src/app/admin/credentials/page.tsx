'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Copy, ClipboardCopy, RefreshCw, KeyRound, Loader2, ShieldAlert, X, Check, Wand2 } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

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
  const [createFor, setCreateFor] = useState<any | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['admin-credentials'],
    queryFn: () => api.get('/admin/credentials').then(r => r.data),
    enabled: isAdmin,
  });
  const { data: roles = [] } = useQuery({
    queryKey: ['admin-roles'],
    queryFn: () => api.get('/admin/users/roles').then(r => r.data),
    enabled: isAdmin,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-credentials'] });

  const missing = useMemo(() => rows.filter((r: any) => !r.has_login).length, [rows]);

  const fillMutation = useMutation({
    mutationFn: () => api.post('/admin/credentials/fill-missing').then(r => r.data),
    onSuccess: (d: any) => {
      invalidate();
      const n = d.created ?? 0;
      toast.success(`Created ${n} login${n === 1 ? '' : 's'} with password 1234`);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create logins'),
  });

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
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Breadcrumb className="mb-2" items={[{ label: 'Admin', href: '/admin' }, { label: 'User Credentials' }]} />
            <h1 className="text-2xl font-bold text-foreground">User Credentials</h1>
            <p className="text-secondary mt-1">Manage each employee&apos;s login. Passwords are set here and shown once — never stored in readable form.</p>
          </div>
          <button
            onClick={() => fillMutation.mutate()}
            disabled={fillMutation.isPending || missing === 0}
            title={missing === 0 ? 'Every employee already has a login' : `Create a login (password 1234) for ${missing} employee(s) without one`}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
          >
            {fillMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            Create missing logins{missing > 0 ? ` (${missing})` : ''}
          </button>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-secondary uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Login</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}><td colSpan={4} className="px-4 py-3"><div className="h-6 bg-muted rounded animate-pulse" /></td></tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-secondary">No employees found.</td></tr>
                ) : rows.map((c: any) => (
                  <tr key={c.employee_id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{name(c)}</p>
                      <p className="text-xs text-secondary capitalize">
                        {c.employee_code || '—'}{c.has_login && c.role_name ? ` · ${String(c.role_name).replace(/_/g, ' ')}` : ''}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {c.email ? (
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs text-foreground break-all">{c.email}</span>
                          <button onClick={() => copyText(c.email, 'Email')} title="Copy email" className="p-1 rounded text-secondary hover:text-primary hover:bg-primary/5 shrink-0">
                            <Copy size={13} />
                          </button>
                        </div>
                      ) : <span className="text-xs text-secondary italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {c.has_login ? (
                        <span className={`text-xs ${c.is_active ? 'text-green-700' : 'text-secondary'}`}>
                          {c.is_active ? 'Active' : 'Deactivated'}
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700">No login yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {c.has_login ? (
                          <>
                            <button
                              onClick={() => setResetFor(c)}
                              title="Set a new password"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors"
                            >
                              <RefreshCw size={13} /> Set password
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setCreateFor(c)}
                            title="Create a login for this employee"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
                          >
                            <KeyRound size={13} /> Create login
                          </button>
                        )}
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
      {createFor && (
        <CreateLoginModal employee={createFor} roles={roles} onClose={() => setCreateFor(null)} onDone={() => { setCreateFor(null); invalidate(); }} />
      )}
    </AppShell>
  );
}

function CreateLoginModal({ employee, roles, onClose, onDone }: {
  employee: any; roles: any[]; onClose: () => void; onDone: () => void;
}) {
  const employeeRoleId = roles.find((r: any) => r.name === 'employee')?.id ?? roles[0]?.id ?? '';
  const [email, setEmail] = useState(employee.email || '');
  const [password, setPassword] = useState('1234');
  const [roleId, setRoleId] = useState<string>(String(employeeRoleId));
  const label = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.employee_code;

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/users', {
      email: email.trim(), password, role_id: Number(roleId), employee_id: employee.employee_id,
    }),
    onSuccess: () => { toast.success('Login created'); onDone(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to create login'),
  });

  return (
    <ModalShell title="Create login" subtitle={label} onClose={onClose}>
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
      <PasswordField value={password} onChange={setPassword} />
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors">Cancel</button>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !email.trim() || !password.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Create login
        </button>
      </div>
    </ModalShell>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('1234');
  const label = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

  const resetMutation = useMutation({
    mutationFn: () => api.put(`/admin/users/${user.user_id}/reset-password`, { password }),
    onSuccess: () => { toast.success('Password reset'); onDone(); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to reset password'),
  });

  return (
    <ModalShell title="Reset password" subtitle={`${label} · ${user.email}`} onClose={onClose}>
      <PasswordField value={password} onChange={setPassword} />
      <p className="text-[11px] text-amber-700 -mt-1">This replaces the user&apos;s current password immediately.</p>
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
    </ModalShell>
  );
}

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-secondary mb-1">Password (shareable)</label>
      <div className="flex gap-2">
        <input className={`${inputCls} font-mono`} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => onChange(genPassword())} title="Generate a random one"
          className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors shrink-0">
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {subtitle && <p className="text-sm text-secondary break-all">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 rounded text-secondary hover:text-foreground hover:bg-muted shrink-0"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
