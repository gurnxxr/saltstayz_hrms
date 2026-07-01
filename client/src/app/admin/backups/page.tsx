'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { ArrowLeft, DatabaseBackup, Loader2, HardDrive } from 'lucide-react';

const kb = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export default function BackupsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: backups = [], isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get('/admin/backups').then(r => r.data),
  });

  const runMutation = useMutation({
    mutationFn: () => api.post('/admin/backups/run').then(r => r.data),
    onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: ['backups'] }); toast.success(`Backup created: ${r.file} (${kb(r.size)})`); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Backup failed'),
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button onClick={() => router.push('/admin')} className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2">
            <ArrowLeft size={16} /> Back to Admin
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <DatabaseBackup className="text-primary" size={22} />
                <h1 className="text-2xl font-bold text-foreground">Database Backups</h1>
              </div>
              <p className="text-secondary mt-1">Consistent point-in-time snapshots of the database. A daily backup runs automatically in production; you can also create one on demand.</p>
            </div>
            <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {runMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />} Run backup now
            </button>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Retained backups</h3>
            <span className="text-xs text-secondary">{backups.length} file(s) · most recent kept (rolling)</span>
          </div>
          <table className="w-full">
            <thead><tr className="border-b border-border bg-muted/30">
              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">File</th>
              <th className="text-left px-5 py-2.5 text-xs font-medium text-secondary uppercase">Created</th>
              <th className="text-right px-5 py-2.5 text-xs font-medium text-secondary uppercase">Size</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={3} className="px-5 py-3"><div className="h-5 bg-muted rounded animate-pulse" /></td></tr>)
              ) : backups.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-12 text-secondary text-sm">No backups yet. Click “Run backup now” to create one.</td></tr>
              ) : backups.map((b: any) => (
                <tr key={b.file} className="hover:bg-muted/30">
                  <td className="px-5 py-3 text-sm font-medium text-foreground flex items-center gap-2"><HardDrive size={14} className="text-secondary" /> {b.file}</td>
                  <td className="px-5 py-3 text-sm text-secondary">{formatDateTime(b.created_at)}</td>
                  <td className="px-5 py-3 text-sm text-secondary text-right">{kb(b.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-secondary">
          Backups are written to <code>server/data/backups/</code> (excluded from git). Schedule automated runs with
          <code> npm run db:backup --workspace=server</code> via cron or Windows Task Scheduler, or set <code>BACKUP_ENABLED=true</code> to enable the built-in daily routine.
        </p>
      </div>
    </AppShell>
  );
}
