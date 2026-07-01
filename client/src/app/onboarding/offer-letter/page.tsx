'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { ArrowLeft, FileText, Download, Eye, Loader2, Percent, IndianRupee, AlertTriangle } from 'lucide-react';

export default function OfferLetterPage() {
  const employeeId = useSearchParams().get('employeeId');
  if (employeeId) return <EmployeeOfferEditor employeeId={employeeId} />;
  return <LegacyOfferLetterPage />;
}

function LegacyOfferLetterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const id = searchParams.get('id');
  const mode = id ? 'view' : 'create';

  // ─── View mode state ───
  const { data: letter, isLoading } = useQuery({
    queryKey: ['offer-letter', id],
    queryFn: () => api.get(`/onboarding/offer-letters/${id}`).then(r => r.data),
    enabled: !!id,
  });

  // ─── Create mode state ───
  const [form, setForm] = useState({
    employee_id: '',
    candidateName: '',
    designation: '',
    salary: '',
    joining_date: '',
  });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-for-offer'],
    queryFn: () => api.get('/employees').then(r => r.data),
    enabled: mode === 'create',
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post('/onboarding/offer-letters', {
        employee_id: Number(form.employee_id),
        template_data: {
          designation: form.designation,
          salary: form.salary,
          joining_date: form.joining_date,
        },
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['offer-letters'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-stats'] });
      toast.success('Offer letter created! Downloading PDF...');
      downloadPdf(res.data.id, `${form.candidateName}`);
      router.push('/onboarding');
    },
    onError: (err: any) => toast.error(err.response?.data?.error || 'Failed to create'),
  });

  function handleEmployeeChange(empId: string) {
    const emp = employees.find((e: any) => String(e.id) === empId);
    setForm(p => ({
      ...p,
      employee_id: empId,
      candidateName: emp ? `${emp.first_name} ${emp.last_name}` : '',
    }));
  }

  async function handlePreview() {
    if (!form.candidateName || !form.designation || !form.salary) {
      toast.error('Fill in all required fields first');
      return;
    }
    setPreviewing(true);
    try {
      const emp = employees.find((e: any) => String(e.id) === form.employee_id);
      const res = await api.post('/onboarding/offer-letters/preview-pdf', {
        candidateName: form.candidateName,
        designation: form.designation,
        salary: form.salary,
        joiningDate: form.joining_date,
        employeeCode: emp?.employee_code || '—',
      }, { responseType: 'blob' });

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      setPreviewUrl(url);
    } catch {
      toast.error('Failed to generate preview');
    } finally {
      setPreviewing(false);
    }
  }

  async function downloadPdf(letterId: number, name: string) {
    try {
      const res = await api.get(`/onboarding/offer-letters/${letterId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Offer_Letter_${name.replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download PDF');
    }
  }

  // ─── View Mode ───
  if (mode === 'view') {
    if (isLoading) {
      return (
        <AppShell>
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </AppShell>
      );
    }

    if (!letter) {
      return (
        <AppShell>
          <div className="text-center py-20 text-secondary">Offer letter not found.</div>
        </AppShell>
      );
    }

    const tpl = letter.template_data || {};
    const joiningDate = tpl.joining_date
      ? new Date(tpl.joining_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';

    return (
      <AppShell>
        <div className="max-w-3xl space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.push('/onboarding')}
              className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors"
            >
              <ArrowLeft size={16} /> Back to Onboarding
            </button>
            <button
              onClick={() => downloadPdf(letter.id, `${letter.first_name}_${letter.last_name}`)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Download size={14} /> Download PDF
            </button>
          </div>

          {/* Letter Preview Card */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="bg-primary px-8 py-6">
              <h1 className="text-2xl font-bold text-white">SaltStayz</h1>
              <p className="text-blue-200 text-sm">HOSPITALITY PVT. LTD.</p>
              <p className="text-blue-200 text-xs mt-1">OFFER OF EMPLOYMENT</p>
            </div>

            <div className="p-8 space-y-5">
              <p className="text-sm text-secondary">
                Date: {new Date(letter.created_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-sm text-secondary">Ref: SALT/OL/{letter.employee_code}/{new Date(letter.created_at).getFullYear()}</p>

              <p className="text-sm text-foreground">Dear <strong>{letter.first_name} {letter.last_name}</strong>,</p>

              <p className="text-sm text-foreground leading-relaxed">
                We are delighted to extend this offer of employment to you for the position of{' '}
                <strong>{tpl.designation}</strong> at SaltStayz Hospitality Pvt. Ltd.
                Your skills, experience, and enthusiasm stood out during our selection process, and we are confident
                you will make a significant contribution to our team.
              </p>

              <div className="bg-muted/50 rounded-lg p-5 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-secondary">Position</p>
                  <p className="text-sm font-semibold text-foreground">{tpl.designation}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Annual CTC</p>
                  <p className="text-sm font-semibold text-foreground">&#8377; {tpl.salary}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Date of Joining</p>
                  <p className="text-sm font-semibold text-foreground">{joiningDate}</p>
                </div>
                <div>
                  <p className="text-xs text-secondary">Employee Code</p>
                  <p className="text-sm font-semibold text-foreground">{letter.employee_code}</p>
                </div>
              </div>

              <p className="text-sm text-foreground leading-relaxed">
                We are excited to welcome you to the SaltStayz family and look forward to a rewarding journey together.
              </p>

              <div className="pt-4">
                <p className="text-sm text-foreground">Warm regards,</p>
                <p className="text-sm font-semibold text-foreground mt-4">Authorized Signatory</p>
                <p className="text-xs text-secondary">Human Resources Department</p>
                <p className="text-xs text-secondary">SaltStayz Hospitality Pvt. Ltd.</p>
              </div>
            </div>

            <div className="bg-primary px-8 py-3 text-center">
              <p className="text-xs text-blue-200">
                SaltStayz Hospitality Pvt. Ltd. | New Delhi, India | www.saltstayz.com | hr@saltstayz.com
              </p>
            </div>
          </div>

          <p className="text-xs text-secondary text-center">
            Generated by {letter.generated_by_email} on {new Date(letter.created_at).toLocaleDateString()}
          </p>
        </div>
      </AppShell>
    );
  }

  // ─── Create Mode ───
  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button
            onClick={() => router.push('/onboarding')}
            className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2"
          >
            <ArrowLeft size={16} /> Back to Onboarding
          </button>
          <h1 className="text-2xl font-bold text-foreground">Generate Offer Letter</h1>
          <p className="text-secondary mt-1">Fill in details and preview the PDF before generating</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form */}
          <div className="bg-card rounded-xl border border-border p-6 space-y-5">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <FileText size={18} className="text-primary" /> Letter Details
            </h2>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Employee *</label>
              <select
                required
                value={form.employee_id}
                onChange={(e) => handleEmployeeChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select employee</option>
                {employees.map((e: any) => (
                  <option key={e.id} value={e.id}>
                    {e.first_name} {e.last_name} ({e.employee_code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Designation *</label>
              <input
                required
                value={form.designation}
                onChange={(e) => setForm(p => ({ ...p, designation: e.target.value }))}
                placeholder="e.g. Front Desk Executive"
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Annual CTC (₹) *</label>
              <input
                required
                value={form.salary}
                onChange={(e) => setForm(p => ({ ...p, salary: e.target.value }))}
                placeholder="e.g. 6,00,000"
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Joining Date *</label>
              <input
                type="date"
                required
                value={form.joining_date}
                onChange={(e) => setForm(p => ({ ...p, joining_date: e.target.value }))}
                className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handlePreview}
                disabled={previewing || !form.employee_id || !form.designation || !form.salary}
                className="flex items-center gap-2 px-5 py-2.5 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 disabled:opacity-50 transition-colors"
              >
                {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                Preview PDF
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !form.employee_id || !form.designation || !form.salary || !form.joining_date}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Generate & Download
              </button>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                className="w-full h-[700px] border-0"
                title="Offer Letter Preview"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-[700px] text-secondary">
                <FileText size={48} className="opacity-20 mb-3" />
                <p className="text-sm">Fill in the details and click</p>
                <p className="text-sm font-medium">Preview PDF</p>
                <p className="text-sm">to see the letter here</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─── Offer-letter editor: structure-prefilled, with base-salary adjustment ───

const LWF_BY_CITY: Record<string, { employee: number; employer: number }> = {
  Delhi: { employee: 0.75, employer: 2.25 }, Gurugram: { employee: 31, employer: 62 },
  Haryana: { employee: 31, employer: 62 }, Noida: { employee: 0, employer: 0 },
  Mumbai: { employee: 25, employer: 75 }, Maharashtra: { employee: 25, employer: 75 },
  Bengaluru: { employee: 20, employer: 40 }, Karnataka: { employee: 20, employer: 40 },
  Chandigarh: { employee: 5, employer: 20 },
};
const inr = (n: any) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

// Mirrors server payslip.calc — recompute the breakdown from an adjusted monthly gross.
function computeOfferBreakdown(inputs: any, gross: number) {
  const r = Math.round;
  const p = inputs?.pct || {};
  const g = r(gross || 0);
  const basic = r(g * (Number(p.basic ?? 50) / 100));
  const hra = r(basic * (Number(p.hra ?? 50) / 100));
  const other = g - basic - hra;
  const pli = r(Number(inputs?.pli) || 0);
  const meal = r(Number(inputs?.meal) || 0);
  const accommodation = r(Number(inputs?.accommodation) || 0);
  const accAllow = r(Number(inputs?.accommodation_allowance) || 0);
  const cityLwf = LWF_BY_CITY[inputs?.city] || { employee: 20, employer: 40 };
  const lwf = r(inputs?.lwf_employee ?? cityLwf.employee);
  const empLwf = r(inputs?.lwf_employer ?? cityLwf.employer);
  const pfBase = basic + other;
  const empPf = r((Number(p.employee_pf ?? 12) / 100) * pfBase);
  const esi = r((Number(p.esi ?? 0.75) / 100) * g);
  const totalDed = empPf + esi + lwf + meal + accommodation;
  const net = g + pli - totalDed;
  const erPf = r((Number(p.employer_pf ?? 12) / 100) * pfBase);
  const gratuity = r((Number(p.gratuity ?? 4.81) / 100) * basic);
  const erEsi = r((Number(p.employer_esi ?? 3.25) / 100) * g);
  const ctc = g + pli + (erPf + gratuity + empLwf) + (erEsi + accAllow);
  return { basic, hra, other, grossEarnings: g + pli, net, ctc, annualCtc: ctc * 12 };
}

function OfferRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium text-foreground' : 'text-secondary'}>{label}</span>
      <span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{inr(value)}</span>
    </div>
  );
}

function EmployeeOfferEditor({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [designation, setDesignation] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [pct, setPct] = useState('0');
  const [finalBase, setFinalBase] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const { data: def, isLoading } = useQuery({
    queryKey: ['offer-defaults', employeeId],
    queryFn: () => api.get(`/onboarding/employees/${employeeId}/offer-defaults`).then(r => r.data),
  });

  useEffect(() => {
    if (!def) return;
    setDesignation(def.designation || '');
    setJoiningDate(def.joining_date ? String(def.joining_date).slice(0, 10) : '');
    setFinalBase(def.base_gross ? String(def.base_gross) : '');
    setPct('0');
  }, [def]);

  const baseGross = Number(def?.base_gross) || 0;
  const finalNum = Math.round(Number(finalBase) || 0);
  const bd = def?.inputs ? computeOfferBreakdown(def.inputs, finalNum) : null;
  // Manpower & Budget Control: offered monthly CTC cannot exceed the sanctioned band.
  const bandMax = def?.band_max ?? null;
  const overBand = bandMax != null && bd != null && bd.ctc > bandMax;

  const onPctChange = (v: string) => {
    setPct(v);
    if (baseGross > 0) setFinalBase(String(Math.round(baseGross * (1 + (Number(v) || 0) / 100))));
  };
  const onFinalChange = (v: string) => {
    setFinalBase(v);
    const f = Number(v) || 0;
    setPct(baseGross > 0 ? String(Math.round((f / baseGross - 1) * 10000) / 100) : '0');
  };

  async function handlePreview() {
    setPreviewing(true);
    try {
      const res = await api.post(`/onboarding/employees/${employeeId}/offer-letter/preview`,
        { base_gross: finalNum, designation, joining_date: joiningDate }, { responseType: 'blob' });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' })));
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Failed to generate preview');
    } finally { setPreviewing(false); }
  }

  const generateMutation = useMutation({
    mutationFn: () => api.post(`/onboarding/employees/${employeeId}/offer-letter`,
      { base_gross: finalNum, designation, joining_date: joiningDate }),
    onSuccess: async (res) => {
      toast.success('Offer letter issued');
      try {
        const pdf = await api.get(`/onboarding/offer-letters/${res.data.id}/pdf`, { responseType: 'blob' });
        const url = URL.createObjectURL(new Blob([pdf.data], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = `Offer_Letter_${(def?.name || 'employee').replace(/\s+/g, '_')}.pdf`; a.click();
        URL.revokeObjectURL(url);
      } catch { /* ignore download error */ }
      router.push('/onboarding');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to issue offer letter'),
  });

  if (isLoading) {
    return <AppShell><div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <button onClick={() => router.push('/onboarding')} className="flex items-center gap-2 text-secondary hover:text-foreground text-sm transition-colors mb-2">
            <ArrowLeft size={16} /> Back to Onboarding
          </button>
          <h1 className="text-2xl font-bold text-foreground">Generate Offer Letter — {def?.name}</h1>
          <p className="text-secondary mt-1">Adjust the base salary, preview, then issue. Base comes from the designation salary structure.</p>
        </div>

        {def && !def.configured ? (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-4 text-sm">
            No salary structure for this designation. Set it up in <a href="/admin/salary-structure" className="underline">Admin → Salary Structure</a> first.
          </div>
        ) : def?.already_issued ? (
          <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded-xl p-4 text-sm">
            An offer letter has already been issued for this employee.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border border-border p-6 space-y-5">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><FileText size={18} className="text-primary" /> Details</h2>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Designation</label>
                <input value={designation} onChange={(e) => setDesignation(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Joining Date</label>
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-foreground">Base salary (monthly)</p>
                <p className="text-xs text-secondary mb-3">From structure: <b>{inr(baseGross)}</b>/mo. Adjust by % or set the final amount — a negative % decrements.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Adjustment %</label>
                    <div className="relative">
                      <Percent size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                      <input type="number" step="any" value={pct} onChange={(e) => onPctChange(e.target.value)}
                        className="w-full pl-7 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-secondary mb-1">Final monthly base ₹</label>
                    <div className="relative">
                      <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" />
                      <input type="number" step="any" value={finalBase} onChange={(e) => onFinalChange(e.target.value)}
                        className="w-full pl-7 pr-3 py-2 border border-border rounded-lg bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                    </div>
                  </div>
                </div>
              </div>

              {bd && (
                <div className="bg-muted/40 rounded-lg p-4 text-sm space-y-1.5">
                  <OfferRow label="Basic" value={bd.basic} />
                  <OfferRow label="HRA" value={bd.hra} />
                  <OfferRow label="Other Allowance" value={bd.other} />
                  <OfferRow label="Gross Earnings" value={bd.grossEarnings} strong />
                  <OfferRow label="Net In-Hand (approx.)" value={bd.net} />
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-border">
                    <span className="font-semibold text-primary">Annual CTC (offer)</span>
                    <span className="font-bold text-primary">{inr(bd.annualCtc)}</span>
                  </div>
                  {bandMax != null && (
                    <div className={`flex items-center justify-between pt-1.5 text-xs ${overBand ? 'text-red-600 font-medium' : 'text-secondary'}`}>
                      <span>Sanctioned cap (monthly CTC)</span>
                      <span>{inr(bandMax)}/mo</span>
                    </div>
                  )}
                </div>
              )}

              {overBand && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>Offered monthly CTC <b>{inr(bd!.ctc)}</b> exceeds the sanctioned band maximum <b>{inr(bandMax!)}</b> for this role/property. Lower the base salary, or raise the band in Admin → Budget Control.</span>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={handlePreview} disabled={previewing || !finalNum}
                  className="flex items-center gap-2 px-5 py-2.5 border border-primary text-primary rounded-lg text-sm font-medium hover:bg-primary/5 disabled:opacity-50 transition-colors">
                  {previewing ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview PDF
                </button>
                <button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending || !finalNum || !joiningDate || overBand}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Generate & Download
                </button>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {previewUrl ? (
                <iframe src={previewUrl} className="w-full h-[700px] border-0" title="Offer Letter Preview" />
              ) : (
                <div className="flex flex-col items-center justify-center h-[700px] text-secondary">
                  <FileText size={48} className="opacity-20 mb-3" />
                  <p className="text-sm">Adjust the base salary and click <b>Preview PDF</b></p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
