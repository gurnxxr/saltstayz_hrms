'use client';

import { useState, useRef, useMemo, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import HolidayAudienceEditor, {
  type AudienceDraft, audienceIsIncomplete,
} from '@/components/admin/HolidayAudienceEditor';
import api from '@/lib/api';
import { INDIAN_STATES } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { audienceLabel, audienceSentence } from '@/lib/holidays';
import type { AdminHolidayRow } from '@/lib/types';
import {
  Upload, Plus, Trash2, Loader2, CalendarDays, ChevronDown, ChevronRight,
  AlertTriangle, Save, X,
} from 'lucide-react';

const inputCls = 'w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';
const EVERYONE: AudienceDraft = {
  all_departments: true, department_ids: [], all_properties: true, property_ids: [],
};

/**
 * Admin manages the holiday calendar on three axes: the region it is filed under (National or
 * one state), the departments it is given to, and the hotels it is given to.
 *
 * The region selector at the top is the filing cabinet — it decides which list you are looking
 * at. Departments and hotels are per-holiday, edited by expanding a row.
 */
export default function AdminHolidaysPage() {
  const qc = useQueryClient();
  const [scope, setScope] = useState('national'); // 'national' | <state name>
  const [add, setAdd] = useState({ name: '', date: '' });
  const [addAudience, setAddAudience] = useState<AudienceDraft>(EVERYONE);
  const [uploadAudience, setUploadAudience] = useState<AudienceDraft>(EVERYONE);
  const [uploadMode, setUploadMode] = useState<'append' | 'replace'>('append');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmDel, setConfirmDel] = useState<AdminHolidayRow | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<AudienceDraft>(EVERYONE);
  const [onlyZero, setOnlyZero] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNational = scope === 'national';

  const { data: holidays = [], isLoading, isError, refetch } = useQuery<AdminHolidayRow[]>({
    queryKey: ['admin-holidays', scope],
    queryFn: () => api.get(isNational ? '/leave/holidays?scope=national' : `/leave/holidays?state=${encodeURIComponent(scope)}`).then(r => r.data),
  });

  // The catalogs the audience editor needs. If either fails, the editor must NOT quietly offer
  // an empty list — every save would then produce "reaches nobody".
  const { data: departments = [], isError: deptsError, refetch: refetchDepts } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments').then(r => r.data),
  });
  const { data: properties = [], isError: propsError, refetch: refetchProps } = useQuery({
    queryKey: ['properties'],
    queryFn: () => api.get('/admin/properties').then(r => r.data),
  });
  const catalogError = deptsError || propsError;
  const retryCatalog = () => { refetchDepts(); refetchProps(); };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-holidays'] });
    qc.invalidateQueries({ queryKey: ['my-holidays'] });
  };

  const reachToast = (saved: any, verb: string) => {
    if (saved?.reaches_count === 0) {
      toast.warning(
        `${verb} — but this holiday currently reaches nobody. No active employee is in the departments and hotels you picked.`,
        { duration: 8000 },
      );
    } else {
      toast.success(`${verb} — reaches ${saved?.reaches_count ?? 0} employee(s)`);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('is_national', String(isNational));
      if (!isNational) fd.append('state', scope);
      fd.append('all_departments', String(uploadAudience.all_departments));
      fd.append('department_ids', JSON.stringify(uploadAudience.department_ids));
      fd.append('all_properties', String(uploadAudience.all_properties));
      fd.append('property_ids', JSON.stringify(uploadAudience.property_ids));
      fd.append('mode', uploadMode);
      return api.post('/leave/holidays/upload-csv', fd).then(r => r.data);
    },
    onSuccess: (data) => {
      invalidate();
      setPendingFile(null);
      const removed = data.replaced ? `, replaced ${data.replaced}` : '';
      if (data.reaches === 0) {
        toast.warning(`${data.inserted} imported${removed} — but they reach nobody. Check the departments and hotels you picked.`, { duration: 8000 });
      } else {
        toast.success(`${data.inserted} holiday(s) imported${removed} — each reaches ${data.reaches} employee(s)`);
      }
    },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Upload failed'); setPendingFile(null); },
  });

  const addMutation = useMutation({
    mutationFn: () => api.post('/leave/holidays', {
      name: add.name.trim(), date: add.date,
      is_national: isNational, state: isNational ? null : scope,
      ...addAudience,
    }).then(r => r.data),
    onSuccess: (saved) => {
      invalidate();
      reachToast(saved, 'Holiday added');
      setAdd({ name: '', date: '' });
      setAddAudience(EVERYONE);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to add'),
  });

  const saveAudienceMutation = useMutation({
    mutationFn: (h: AdminHolidayRow) => api.put(`/leave/holidays/${h.id}`, {
      name: h.name, date: h.date,
      is_national: h.is_national, state: h.state,
      ...draft,
    }).then(r => r.data),
    onSuccess: (saved) => { invalidate(); reachToast(saved, 'Saved'); setOpenId(null); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/leave/holidays/${id}`),
    onSuccess: () => { invalidate(); toast.success('Holiday deleted'); setConfirmDel(null); },
    onError: (e: any) => { toast.error(e.response?.data?.error || 'Failed to delete'); setConfirmDel(null); },
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setPendingFile(file);
    if (fileRef.current) fileRef.current.value = '';
  }

  function openRow(h: AdminHolidayRow) {
    if (openId === h.id) { setOpenId(null); return; }
    setDraft({
      all_departments: h.all_departments,
      department_ids: [...h.department_ids],
      all_properties: h.all_properties,
      property_ids: [...h.property_ids],
    });
    setOpenId(h.id);
  }

  const zeroCount = holidays.filter((h) => h.reaches_count === 0).length;
  const shown = useMemo(
    () => (onlyZero ? holidays.filter((h) => h.reaches_count === 0) : holidays),
    [holidays, onlyZero],
  );
  const region = { is_national: isNational, state: isNational ? null : scope };
  const audienceSummary = (d: AudienceDraft) =>
    audienceSentence('', d, departments, properties, region).replace(/^\s*applies to /, '');

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl">
        <Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Holidays' }]} />
        <div>
          <h1 className="text-2xl font-bold text-foreground">Holidays</h1>
          <p className="text-secondary mt-1">
            Publish the holiday calendar and choose who each holiday is for. A holiday reaches
            someone only if it is for their region, their department <em>and</em> their hotel.
          </p>
        </div>

        {/* Standing audit: the combination nothing else can catch. */}
        {zeroCount > 0 && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <p className="font-medium text-red-900">
                {zeroCount} {zeroCount === 1 ? 'holiday reaches' : 'holidays reach'} nobody
              </p>
              <p className="text-red-800 mt-0.5">
                {zeroCount === 1 ? 'It is' : 'They are'} saved, but no one will see
                {zeroCount === 1 ? ' it' : ' them'}. Either no department is ticked, no hotel is
                ticked, or nobody works in the combination that was picked. Open each one and
                choose who it is for.
              </p>
              <button
                onClick={() => setOnlyZero((v) => !v)}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 border border-red-300 rounded-lg text-xs font-medium text-red-800 hover:bg-red-100 transition-colors"
              >
                {onlyZero ? 'Show all holidays' : `Show only ${zeroCount === 1 ? 'it' : 'these'}`}
              </button>
            </div>
          </div>
        )}

        {/* Region + upload */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Calendar</label>
              <select className={inputCls + ' min-w-[220px]'} value={scope} onChange={(e) => { setScope(e.target.value); setOpenId(null); setOnlyZero(false); }}>
                <option value="national">National (any hotel)</option>
                <optgroup label="State">
                  {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Import</label>
              <select className={inputCls} value={uploadMode} onChange={(e) => setUploadMode(e.target.value as any)}>
                <option value="append">Add to this calendar</option>
                <option value="replace">Replace the matching ones</option>
              </select>
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploadMutation.isPending || audienceIsIncomplete(uploadAudience)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {uploadMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                Upload CSV
              </button>
            </div>
          </div>

          <div className="pt-3 border-t border-border">
            <p className="text-xs font-medium text-secondary mb-2">Every imported holiday will apply to</p>
            <HolidayAudienceEditor
              value={uploadAudience} onChange={setUploadAudience}
              departments={departments} properties={properties}
              idPrefix="upload" catalogError={catalogError} onRetryCatalog={retryCatalog}
            />
          </div>

          <p className="text-xs text-secondary">
            CSV columns: <span className="font-medium text-foreground">Holiday Name, Date</span> (date as YYYY-MM-DD or DD-MM-YYYY).
            {uploadMode === 'replace'
              ? ' Replacing removes only the holidays already set to this same audience — anything narrowed by hand is left alone.'
              : ' Adding leaves everything already there untouched.'}
            {' '}Narrow individual holidays afterwards from the table below.
          </p>
        </div>

        {/* Manual add */}
        <div className="bg-card rounded-xl border border-border p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Add a holiday</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-secondary mb-1">Name</label>
              <input className={inputCls} value={add.name} onChange={(e) => setAdd((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Diwali" />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Date</label>
              <input type="date" className={inputCls} value={add.date} onChange={(e) => setAdd((p) => ({ ...p, date: e.target.value }))} />
            </div>
          </div>

          <div className="pt-3 border-t border-border">
            <p className="text-xs font-medium text-secondary mb-2">Who gets it</p>
            <HolidayAudienceEditor
              value={addAudience} onChange={setAddAudience}
              departments={departments} properties={properties}
              idPrefix="add" catalogError={catalogError} onRetryCatalog={retryCatalog}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p aria-live="polite" className="text-sm text-secondary min-w-0">
              {audienceSentence(add.name.trim(), addAudience, departments, properties, region)}
            </p>
            <button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !add.name.trim() || !add.date || audienceIsIncomplete(addAudience) || catalogError}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50 shrink-0"
            >
              {addMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">{isNational ? 'National' : scope} holidays</h2>
            {onlyZero && <span className="text-xs text-red-700 font-medium">Showing only the ones that reach nobody</span>}
          </div>

          {isLoading ? (
            <div className="animate-pulse divide-y divide-border">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <div className="h-4 w-40 bg-muted rounded" />
                  <div className="h-4 w-48 bg-muted rounded" />
                  <div className="h-4 w-28 bg-muted rounded ml-auto" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />
          ) : shown.length === 0 ? (
            <div className="p-8 text-center text-secondary">
              <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
              <p>No {isNational ? 'national' : scope} holidays yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-secondary">
                    <th className="px-4 py-3 font-medium w-8"></th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Holiday</th>
                    <th className="px-4 py-3 font-medium">Who gets it</th>
                    <th className="px-4 py-3 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((h) => {
                    const aud = audienceLabel(h, departments.length);
                    const open = openId === h.id;
                    return (
                      // The key belongs on the list child — the fragment — not on the rows inside it.
                      <Fragment key={h.id}>
                        <tr className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openRow(h)}
                              aria-expanded={open}
                              aria-controls={`hol-panel-${h.id}`}
                              title={open ? 'Close' : 'Change who gets this'}
                              className="p-1 rounded-lg text-secondary hover:text-foreground hover:bg-muted transition-colors"
                            >
                              {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-foreground">
                            {formatDate(h.date, { weekday: 'short' })}
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">{h.name}</td>
                          <td className="px-4 py-3">
                            <span
                              title={aud.detail}
                              className={`block max-w-[18rem] truncate text-sm ${
                                aud.tone === 'none' ? 'text-red-600 font-medium'
                                  : aud.tone === 'all' ? 'text-secondary'
                                    : 'text-foreground'
                              }`}
                            >
                              {aud.tone === 'none' && <AlertTriangle size={13} className="inline-block mr-1 -mt-0.5" />}
                              {aud.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setConfirmDel(h)} title="Delete"
                              className="p-1.5 rounded-lg text-secondary hover:text-red-600 hover:bg-red-50 transition-colors">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>

                        {open && (
                          <tr className="bg-muted/20">
                            <td colSpan={5} className="px-4 py-4" id={`hol-panel-${h.id}`}>
                              <h3 className="sr-only">Who gets {h.name}</h3>
                              <HolidayAudienceEditor
                                value={draft} onChange={setDraft}
                                departments={departments} properties={properties}
                                idPrefix={`row-${h.id}`} catalogError={catalogError} onRetryCatalog={retryCatalog}
                              />
                              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p aria-live="polite" className="text-sm text-foreground">
                                    {audienceSentence(h.name, draft, departments, properties, region)}
                                  </p>
                                  <p className="text-xs text-secondary mt-0.5">
                                    As saved, this reaches <span className="font-medium text-foreground">{h.reaches_count}</span>{' '}
                                    active employee(s). The number updates after you save.
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    onClick={() => setOpenId(null)}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm font-medium text-secondary hover:bg-muted transition-colors"
                                  >
                                    <X size={14} /> Cancel
                                  </button>
                                  <button
                                    onClick={() => saveAudienceMutation.mutate(h)}
                                    disabled={saveAudienceMutation.isPending || audienceIsIncomplete(draft) || catalogError}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                                  >
                                    {saveAudienceMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete holiday?"
        danger
        confirmLabel="Delete"
        message={confirmDel ? <>Remove <span className="font-medium text-foreground">{confirmDel.name}</span>?</> : undefined}
        loading={deleteMutation.isPending}
        onConfirm={() => confirmDel && deleteMutation.mutate(confirmDel.id)}
        onCancel={() => setConfirmDel(null)}
      />

      {/* The import used to delete a whole calendar with no confirmation. Now it says what it
          will remove and what audience it will stamp, before it does either. */}
      <ConfirmDialog
        open={!!pendingFile}
        title={uploadMode === 'replace' ? `Replace matching ${isNational ? 'National' : scope} holidays?` : `Import into ${isNational ? 'National' : scope}?`}
        danger={uploadMode === 'replace'}
        confirmLabel={uploadMode === 'replace' ? 'Replace and import' : 'Import'}
        message={
          <>
            Importing <span className="font-medium text-foreground">{pendingFile?.name}</span>.
            {uploadMode === 'replace'
              ? <> This first removes the {isNational ? 'national' : scope} holidays already set to the same audience — anything narrowed by hand is left alone.</>
              : <> Nothing already saved will be removed.</>}
            {' '}Every imported holiday will apply to{' '}
            <span className="font-medium text-foreground">{audienceSummary(uploadAudience)}</span>
          </>
        }
        loading={uploadMutation.isPending}
        onConfirm={() => pendingFile && uploadMutation.mutate(pendingFile)}
        onCancel={() => setPendingFile(null)}
      />
    </AppShell>
  );
}
