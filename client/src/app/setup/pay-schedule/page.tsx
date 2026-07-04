'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppShell from '@/components/layout/AppShell';
import Breadcrumb from '@/components/ui/Breadcrumb';
import LoadError from '@/components/ui/LoadError';
import api from '@/lib/api';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import { CalendarClock, Info, Save, Loader2 } from 'lucide-react';

// Weekday indices 0=Sun … 6=Sat (matches the server's work_week storage).
const DAYS = [
  { i: 0, label: 'SUN' },
  { i: 1, label: 'MON' },
  { i: 2, label: 'TUE' },
  { i: 3, label: 'WED' },
  { i: 4, label: 'THU' },
  { i: 5, label: 'FRI' },
  { i: 6, label: 'SAT' },
];

const Req = () => <span className="text-red-600">*</span>;

export default function PaySchedulePage() {
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pay-schedule'],
    queryFn: () => api.get('/pay-schedule').then((r) => r.data),
  });

  const [workWeek, setWorkWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [method, setMethod] = useState<'actual_days' | 'fixed_days'>('actual_days');
  const [payType, setPayType] = useState<'last_day' | 'fixed_day'>('last_day');
  const [payDay, setPayDay] = useState(1);
  const [unmarkedPolicy, setUnmarkedPolicy] = useState<'present' | 'absent'>('present');
  const [holidaysPaid, setHolidaysPaid] = useState(true);
  const [dirty, setDirty] = useState(false);

  // Hydrate the form once settings load.
  useEffect(() => {
    if (!data) return;
    setWorkWeek(Array.isArray(data.work_week) ? data.work_week : [1, 2, 3, 4, 5]);
    setMethod(data.salary_calculation_method === 'fixed_days' ? 'fixed_days' : 'actual_days');
    setPayType(data.pay_date_type === 'fixed_day' ? 'fixed_day' : 'last_day');
    setPayDay(Number(data.pay_date_day) || 1);
    setUnmarkedPolicy(data.unmarked_day_policy === 'absent' ? 'absent' : 'present');
    setHolidaysPaid(data.holidays_paid !== false);
    setDirty(false);
  }, [data]);

  useUnsavedChangesWarning(dirty);

  const toggleDay = (i: number) => {
    setDirty(true);
    setWorkWeek((prev) => (prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i].sort((a, b) => a - b)));
  };

  const save = useMutation({
    mutationFn: () =>
      api.put('/pay-schedule', {
        work_week: workWeek,
        salary_calculation_method: method,
        pay_date_type: payType,
        pay_date_day: payDay,
        unmarked_day_policy: unmarkedPolicy,
        holidays_paid: holidaysPaid,
      }),
    onSuccess: () => {
      toast.success('Pay schedule saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['pay-schedule'] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save'),
  });

  const onSave = () => {
    if (workWeek.length === 0) {
      toast.error('Select at least one working day.');
      return;
    }
    save.mutate();
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-3xl">
        <Breadcrumb items={[{ label: 'Payroll' }, { label: 'Pay Schedule' }]} />
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><CalendarClock className="text-primary" size={20} /></div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pay Schedule</h1>
            <p className="text-secondary text-sm">Set your working week, salary calculation method, and pay date.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-card rounded-xl border border-border p-10 text-center text-secondary text-sm">Loading…</div>
        ) : isError ? (
          <div className="bg-card rounded-xl border border-border"><LoadError message="Couldn't load the pay schedule." onRetry={() => refetch()} /></div>
        ) : (
          <div className="bg-card rounded-xl border border-border p-6 space-y-10">
            {/* ── Work Week ── */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Work Week <Req /></h2>
              <div>
                <p className="text-sm text-secondary">Select your organisation&apos;s working days.<Req /></p>
                <p className="text-sm text-secondary">These days will be considered when calculating payable days and loss of pay.</p>
              </div>
              <div className="grid grid-cols-7 max-w-lg overflow-hidden rounded-lg border border-border">
                {DAYS.map((d, idx) => {
                  const on = workWeek.includes(d.i);
                  return (
                    <button
                      key={d.i}
                      type="button"
                      onClick={() => toggleDay(d.i)}
                      aria-pressed={on}
                      className={`py-2.5 text-xs font-semibold text-center transition-colors ${idx > 0 ? 'border-l border-border' : ''} ${
                        on ? 'bg-primary/10 text-primary' : 'bg-card text-foreground hover:bg-muted'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* ── Salary Calculation Method ── */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Salary Calculation Method <Req /></h2>
              <p className="text-sm text-secondary">Select how monthly salary should be calculated.<Req /></p>
              <div className="space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                  <input type="radio" name="calc-method" className="accent-primary w-4 h-4"
                    checked={method === 'actual_days'} onChange={() => { setMethod('actual_days'); setDirty(true); }} />
                  <span className="text-sm text-foreground">Actual days in a month</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                  <input type="radio" name="calc-method" className="accent-primary w-4 h-4"
                    checked={method === 'fixed_days'} onChange={() => { setMethod('fixed_days'); setDirty(true); }} />
                  <span className="text-sm text-foreground inline-flex items-center gap-1.5">
                    Based on fixed working days per month
                    <span
                      className="inline-flex text-secondary cursor-help"
                      title="Uses a fixed number of working days as the denominator instead of the actual calendar days, so per-day pay stays constant across months."
                      aria-label="More info"
                    >
                      <Info size={14} />
                    </span>
                  </span>
                </label>
              </div>
            </section>

            {/* ── Pay Date ── */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Pay Date <Req /></h2>
              <p className="text-sm text-secondary">Select when employees should be paid.<Req /></p>
              <div className="space-y-2.5">
                <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                  <input type="radio" name="pay-date" className="accent-primary w-4 h-4"
                    checked={payType === 'last_day'} onChange={() => { setPayType('last_day'); setDirty(true); }} />
                  <span className="text-sm text-foreground">On the last day of every month</span>
                </label>
                <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                  <input type="radio" name="pay-date" className="accent-primary w-4 h-4"
                    checked={payType === 'fixed_day'} onChange={() => { setPayType('fixed_day'); setDirty(true); }} />
                  <span className="text-sm text-foreground">On Day</span>
                  <select
                    value={payDay}
                    onChange={(e) => { setPayDay(Number(e.target.value)); setPayType('fixed_day'); setDirty(true); }}
                    className="px-2 py-1 border border-border rounded-lg bg-background text-sm"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <span className="text-sm text-foreground">of every month</span>
                </label>
              </div>
              <p className="text-xs text-secondary">
                <span className="font-semibold text-foreground">Note:</span> If the selected pay date falls on a non-working day or holiday, payment will be processed on the previous working day.
              </p>
            </section>

            {/* ── Attendance Policies (payable-days engine) ── */}
            <section className="space-y-3">
              <h2 className="text-base font-semibold text-foreground">Attendance Policies <Req /></h2>
              <p className="text-sm text-secondary">How the payable-days engine treats edge cases when computing Loss of Pay.</p>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-foreground mb-1.5">A working day with no attendance record counts as</p>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                      <input type="radio" name="unmarked-policy" className="accent-primary w-4 h-4"
                        checked={unmarkedPolicy === 'present'} onChange={() => { setUnmarkedPolicy('present'); setDirty(true); }} />
                      <span className="text-sm text-foreground">Present — no pay is deducted (typical for salaried staff)</span>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                      <input type="radio" name="unmarked-policy" className="accent-primary w-4 h-4"
                        checked={unmarkedPolicy === 'absent'} onChange={() => { setUnmarkedPolicy('absent'); setDirty(true); }} />
                      <span className="text-sm text-foreground">Absent — one day of pay is deducted (strict, biometric-driven)</span>
                    </label>
                  </div>
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer w-fit">
                  <input type="checkbox" className="accent-primary w-4 h-4 mt-0.5"
                    checked={holidaysPaid} onChange={(e) => { setHolidaysPaid(e.target.checked); setDirty(true); }} />
                  <span>
                    <span className="text-sm font-medium text-foreground">Holidays are paid working days</span>
                    <span className="block text-xs text-secondary mt-0.5">Regional holidays count as automatically-paid days (standard hospitality practice). Unchecked, they are excluded like weekly offs.</span>
                  </span>
                </label>
              </div>
            </section>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                onClick={onSave}
                disabled={save.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                Save
              </button>
              <span className="text-sm text-red-600">All fields are mandatory.</span>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
