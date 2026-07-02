'use client';

import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LoadError from '@/components/ui/LoadError';
import {
  CalendarDays, MapPin, Plus, Upload, Trash2, Loader2, FileSpreadsheet,
  Pencil, Globe, Building2, X,
} from 'lucide-react';

type Region = { id: number; name: string; description?: string; property_count: number; holiday_count: number };
type Holiday = { id: number; name: string; date: string; is_national: boolean; region_id: number | null; region_name: string | null; is_recurring: boolean };
type PropRow = { id: number; name: string; city: string; state: string; region_id: number | null; region_name: string | null };

const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long' });

function ScopeBadge({ h }: { h: Holiday }) {
  return h.is_national ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      <Globe size={11} /> National
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
      <MapPin size={11} /> {h.region_name || 'Unassigned'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Employee (and default) view: my region + the holidays that apply to me
// ─────────────────────────────────────────────────────────────────────────────
function MyHolidays() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['holidays-me'],
    queryFn: () => api.get('/leave/holidays/me').then(r => r.data),
  });
  const region = data?.region;
  const holidays: Holiday[] = data?.holidays || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-muted/40">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <MapPin size={18} />
        </div>
        <div>
          {region?.region_name ? (
            <p className="text-sm text-foreground">
              Showing holidays for your region: <span className="font-semibold">{region.region_name}</span>
              <span className="text-secondary"> · {region.property_name}</span>
            </p>
          ) : region ? (
            <p className="text-sm text-foreground">
              No region is mapped to your property{region.property_name ? ` (${region.property_name})` : ''} yet — showing national holidays only.
            </p>
          ) : (
            <p className="text-sm text-foreground">Showing national holidays.</p>
          )}
          <p className="text-xs text-secondary">National holidays apply to everyone; regional ones are specific to your region of employment.</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : isError ? (
          <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />
        ) : holidays.length === 0 ? (
          <div className="p-8 text-center text-secondary">
            <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
            <p>No holidays configured for your region yet.</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 bg-muted/50 border-b border-border">
              <p className="text-sm font-semibold text-foreground">{holidays.length} Holiday{holidays.length > 1 ? 's' : ''}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Holiday</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Day</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Applies to</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {holidays.map((h) => (
                    <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-600"><CalendarDays size={16} /></div>
                          <span className="text-sm font-medium text-foreground">{h.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground">{fmtDate(h.date)}</td>
                      <td className="px-4 py-3 text-sm text-secondary">{fmtDay(h.date)}</td>
                      <td className="px-4 py-3"><ScopeBadge h={h} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: holiday add/edit modal
// ─────────────────────────────────────────────────────────────────────────────
function HolidayModal({ holiday, regions, onClose }: { holiday: Holiday | null; regions: Region[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(holiday?.name || '');
  const [date, setDate] = useState(holiday?.date ? holiday.date.slice(0, 10) : '');
  const [scope, setScope] = useState<'national' | 'regional'>(holiday && !holiday.is_national ? 'regional' : 'national');
  const [regionId, setRegionId] = useState<string>(holiday?.region_id ? String(holiday.region_id) : '');
  const [recurring, setRecurring] = useState(!!holiday?.is_recurring);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, date, is_national: scope === 'national', region_id: scope === 'regional' ? Number(regionId) : null, is_recurring: recurring };
      return holiday ? api.put(`/leave/holidays/${holiday.id}`, body) : api.post('/leave/holidays', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['holidays-admin'] });
      qc.invalidateQueries({ queryKey: ['holidays-me'] });
      qc.invalidateQueries({ queryKey: ['leave-regions'] });
      toast.success(holiday ? 'Holiday updated' : 'Holiday added');
      onClose();
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to save holiday'),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !date) return toast.error('Name and date are required');
    if (scope === 'regional' && !regionId) return toast.error('Select a region');
    save.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">{holiday ? 'Edit Holiday' : 'Add Holiday'}</h3>
          <button onClick={onClose} className="text-secondary hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Holiday name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" placeholder="e.g. Republic Day" />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Applies to</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setScope('national')} className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${scope === 'national' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary'}`}>
                <Globe size={14} className="inline mr-1" /> National
              </button>
              <button type="button" onClick={() => setScope('regional')} className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border ${scope === 'regional' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary'}`}>
                <MapPin size={14} className="inline mr-1" /> Regional
              </button>
            </div>
          </div>
          {scope === 'regional' && (
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Region</label>
              <select value={regionId} onChange={(e) => setRegionId(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg bg-background text-sm">
                <option value="">Select a region…</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {regions.length === 0 && <p className="text-xs text-amber-600 mt-1">No regions yet — create one in the Regions tab first.</p>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="rounded border-border" />
            Recurring every year
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-secondary hover:bg-muted">Cancel</button>
            <button type="submit" disabled={save.isPending} className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50">
              {save.isPending ? 'Saving…' : holiday ? 'Save changes' : 'Add holiday'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: holidays management (filter, table, CSV import)
// ─────────────────────────────────────────────────────────────────────────────
function AdminHolidays({ regions }: { regions: Region[] }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState('');
  const [regionFilter, setRegionFilter] = useState('');
  const [modal, setModal] = useState<{ open: boolean; holiday: Holiday | null }>({ open: false, holiday: null });
  const [csvScope, setCsvScope] = useState('national'); // 'national' | region id
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState<Holiday | null>(null);
  const [confirmCsv, setConfirmCsv] = useState<File | null>(null);
  const clearFile = () => { if (fileRef.current) fileRef.current.value = ''; };

  const { data: holidays = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['holidays-admin', scope, regionFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (scope) p.set('scope', scope);
      if (regionFilter) p.set('region_id', regionFilter);
      return api.get(`/leave/holidays?${p}`).then(r => r.data);
    },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['holidays-admin'] }); qc.invalidateQueries({ queryKey: ['holidays-me'] }); qc.invalidateQueries({ queryKey: ['leave-regions'] }); toast.success('Holiday deleted'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Delete failed'),
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      if (csvScope === 'national') fd.append('is_national', 'true');
      else { fd.append('is_national', 'false'); fd.append('region_id', csvScope); }
      return api.post('/leave/holidays/upload-csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['holidays-admin'] }); qc.invalidateQueries({ queryKey: ['holidays-me'] }); qc.invalidateQueries({ queryKey: ['leave-regions'] }); toast.success(`${d.inserted} holidays imported`); if (fileRef.current) fileRef.current.value = ''; },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Upload failed'),
  });

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.endsWith('.csv')) { clearFile(); return toast.error('Please upload a .csv file'); }
    setConfirmCsv(f); // confirm before replacing — import wipes the selected scope's holidays
  }

  const csvScopeLabel = csvScope === 'national' ? 'National' : (regions.find((r) => String(r.id) === csvScope)?.name || 'the selected region');

  return (
    <div className="space-y-4">
      {/* CSV import */}
      <div className="bg-card rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Import holidays from CSV</h3>
            <p className="text-xs text-secondary mt-1">Columns: <code className="bg-muted px-1 rounded">Holiday Name, Date</code> (DD-MM-YYYY). Replaces holidays for the selected scope only.</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={csvScope} onChange={(e) => setCsvScope(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
              <option value="national">National</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input ref={fileRef} type="file" accept=".csv" onChange={onFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={upload.isPending} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
              {upload.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {upload.isPending ? 'Importing…' : 'Import CSV'}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
          <FileSpreadsheet size={14} className="text-secondary" />
          <p className="text-xs text-secondary">Example: <code className="bg-muted px-1 rounded">Republic Day,26-01-2026</code></p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select value={scope} onChange={(e) => { setScope(e.target.value); if (e.target.value !== 'regional') setRegionFilter(''); }} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
            <option value="">All holidays</option>
            <option value="national">National only</option>
            <option value="regional">Regional only</option>
          </select>
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)} className="px-3 py-2 border border-border rounded-lg bg-background text-sm">
            <option value="">All regions</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <button onClick={() => setModal({ open: true, holiday: null })} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">
          <Plus size={16} /> Add Holiday
        </button>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
        ) : isError ? (
          <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />
        ) : holidays.length === 0 ? (
          <div className="p-8 text-center text-secondary"><CalendarDays size={32} className="mx-auto mb-2 opacity-40" /><p>No holidays match this filter.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Holiday</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Applies to</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {holidays.map((h: Holiday) => (
                  <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{h.name}</span>
                        {h.is_recurring ? <span className="text-xs text-secondary">(yearly)</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{fmtDate(h.date)} <span className="text-secondary text-xs">· {fmtDay(h.date)}</span></td>
                    <td className="px-4 py-3"><ScopeBadge h={h} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setModal({ open: true, holiday: h })} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-foreground hover:bg-muted rounded-lg mr-1"><Pencil size={12} /> Edit</button>
                      <button onClick={() => setConfirmDel(h)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={12} /> Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal.open && <HolidayModal holiday={modal.holiday} regions={regions} onClose={() => setModal({ open: false, holiday: null })} />}

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete holiday?"
        message={confirmDel && (
          <>Delete <b>{confirmDel.name}</b> ({fmtDate(confirmDel.date)})? {confirmDel.is_national ? 'This is a national holiday shown to every employee.' : `This affects the ${confirmDel.region_name || 'region'} region.`} This can't be undone.</>
        )}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => confirmDel && del.mutate(confirmDel.id, { onSettled: () => setConfirmDel(null) })}
        onCancel={() => setConfirmDel(null)}
      />

      <ConfirmDialog
        open={!!confirmCsv}
        danger
        title="Replace holidays from CSV?"
        message={<>Importing <b>{confirmCsv?.name}</b> will <b>replace all {csvScopeLabel} holidays</b> with the rows in this file. This can't be undone.</>}
        confirmLabel="Replace & import"
        loading={upload.isPending}
        onConfirm={() => confirmCsv && upload.mutate(confirmCsv, { onSettled: () => { setConfirmCsv(null); clearFile(); } })}
        onCancel={() => { setConfirmCsv(null); clearFile(); }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: regions management
// ─────────────────────────────────────────────────────────────────────────────
function AdminRegions({ regions }: { regions: Region[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<Region | null>(null);
  const [confirmDel, setConfirmDel] = useState<Region | null>(null);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['leave-regions'] }); qc.invalidateQueries({ queryKey: ['region-properties'] }); };

  const create = useMutation({
    mutationFn: () => api.post('/leave/regions', { name, description }),
    onSuccess: () => { invalidate(); setName(''); setDescription(''); toast.success('Region created'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create region'),
  });
  const update = useMutation({
    mutationFn: (r: Region) => api.put(`/leave/regions/${r.id}`, { name: r.name, description: r.description }),
    onSuccess: () => { invalidate(); setEditing(null); toast.success('Region updated'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update region'),
  });
  const del = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/regions/${id}`),
    onSuccess: () => { invalidate(); toast.success('Region deleted'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to delete region'),
  });

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">Add a region</h3>
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Region name (e.g. North, South, West)" className="flex-1 min-w-48 px-3 py-2 border border-border rounded-lg bg-background text-sm" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="flex-1 min-w-48 px-3 py-2 border border-border rounded-lg bg-background text-sm" />
          <button onClick={() => name.trim() ? create.mutate() : toast.error('Enter a region name')} disabled={create.isPending} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {regions.length === 0 ? (
          <div className="p-8 text-center text-secondary"><MapPin size={32} className="mx-auto mb-2 opacity-40" /><p>No regions yet. Add your first region above.</p></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Region</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Properties</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Holidays</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-secondary uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {regions.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    {editing?.id === r.id ? (
                      <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="px-2 py-1 border border-border rounded bg-background text-sm w-40" />
                    ) : (
                      <div><span className="text-sm font-medium text-foreground">{r.name}</span>{r.description && <p className="text-xs text-secondary">{r.description}</p>}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary">{r.property_count}</td>
                  <td className="px-4 py-3 text-sm text-secondary">{r.holiday_count}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {editing?.id === r.id ? (
                      <>
                        <button onClick={() => update.mutate(editing)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-700 hover:bg-green-50 rounded-lg mr-1">Save</button>
                        <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-secondary hover:bg-muted rounded-lg">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-foreground hover:bg-muted rounded-lg mr-1"><Pencil size={12} /> Rename</button>
                        <button onClick={() => setConfirmDel(r)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={12} /> Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete region?"
        message={confirmDel && (
          <>Delete the <b>{confirmDel.name}</b> region? {(confirmDel.property_count > 0 || confirmDel.holiday_count > 0)
            ? `It has ${confirmDel.property_count} propert${confirmDel.property_count === 1 ? 'y' : 'ies'} and ${confirmDel.holiday_count} holiday(s) — you'll need to reassign those first.`
            : "This can't be undone."}</>
        )}
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => confirmDel && del.mutate(confirmDel.id, { onSettled: () => setConfirmDel(null) })}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: property → region mapping
// ─────────────────────────────────────────────────────────────────────────────
function AdminMapping({ regions }: { regions: Region[] }) {
  const qc = useQueryClient();
  const { data: props = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['region-properties'],
    queryFn: () => api.get('/leave/region-properties').then(r => r.data),
  });

  const assign = useMutation({
    mutationFn: ({ id, region_id }: { id: number; region_id: string }) => api.put(`/leave/properties/${id}/region`, { region_id: region_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['region-properties'] }); qc.invalidateQueries({ queryKey: ['leave-regions'] }); qc.invalidateQueries({ queryKey: ['holidays-me'] }); toast.success('Property region updated'); },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to update'),
  });

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-muted/50 border-b border-border">
        <p className="text-sm font-semibold text-foreground">Assign each property to a region</p>
        <p className="text-xs text-secondary">Employees inherit the region of the property they work at (matched by branch).</p>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>
      ) : isError ? (
        <LoadError message="Couldn't load properties." onRetry={() => refetch()} />
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Property</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Location</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-secondary uppercase">Region</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(props as PropRow[]).map((p) => (
              <tr key={p.id} className="hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2"><Building2 size={15} className="text-secondary" /><span className="text-sm font-medium text-foreground">{p.name}</span></div>
                </td>
                <td className="px-4 py-3 text-sm text-secondary">{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3">
                  <select
                    value={p.region_id ? String(p.region_id) : ''}
                    onChange={(e) => assign.mutate({ id: p.id, region_id: e.target.value })}
                    className="px-3 py-1.5 border border-border rounded-lg bg-background text-sm"
                  >
                    <option value="">— Unassigned —</option>
                    {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Container
// ─────────────────────────────────────────────────────────────────────────────
type AdminView = 'mine' | 'holidays' | 'regions' | 'mapping';

export default function HolidaysPanel({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<AdminView>(isAdmin ? 'holidays' : 'mine');
  const { data: regions = [] } = useQuery({
    queryKey: ['leave-regions'],
    queryFn: () => api.get('/leave/regions').then(r => r.data),
  });

  if (!isAdmin) return <MyHolidays />;

  const tabs: { key: AdminView; label: string }[] = [
    { key: 'holidays', label: 'Holidays' },
    { key: 'regions', label: 'Regions' },
    { key: 'mapping', label: 'Property Mapping' },
    { key: 'mine', label: 'My Region View' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${view === t.key ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {view === 'holidays' && <AdminHolidays regions={regions} />}
      {view === 'regions' && <AdminRegions regions={regions} />}
      {view === 'mapping' && <AdminMapping regions={regions} />}
      {view === 'mine' && <MyHolidays />}
    </div>
  );
}
