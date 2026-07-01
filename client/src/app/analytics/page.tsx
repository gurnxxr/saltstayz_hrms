'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AppShell from '@/components/layout/AppShell';
import api from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import EmployeeAnalytics from '@/components/analytics/EmployeeAnalytics';
import {
  Users, TrendingDown, CalendarCheck, Briefcase, AlertTriangle, Clock,
  X, Download, Building2, CheckCircle2, XCircle, Plane, HelpCircle, LogOut, Maximize2,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line,
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
const EXIT_COLORS: Record<string, string> = {
  resignation: '#f59e0b', terminated: '#ef4444', absconded: '#8b5cf6',
  contract_end: '#06b6d4', other: '#94a3b8',
};

const STATUS_META = [
  { key: 'present', label: 'Present', tab: 'present', color: '#10b981', icon: CheckCircle2 },
  { key: 'absent', label: 'Absent', tab: 'absent', color: '#ef4444', icon: XCircle },
  { key: 'on_leave', label: 'On Leave', tab: 'on_leave', color: '#3b82f6', icon: Plane },
  { key: 'unmarked', label: 'Unmarked', tab: null, color: '#94a3b8', icon: HelpCircle },
  { key: 'exited', label: 'Exited', tab: 'exited', color: '#8b5cf6', icon: LogOut },
] as const;

type TabKey = 'workforce' | 'attrition' | 'attendance' | 'properties';
const TABS: { key: TabKey; label: string; icon: typeof Users }[] = [
  { key: 'workforce', label: 'Workforce', icon: Users },
  { key: 'attrition', label: 'Attrition', icon: TrendingDown },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'properties', label: 'Properties', icon: Building2 },
];

// ─── Small reusable card panel ───
function Panel({ title, subtitle, right, children, className = '' }: {
  title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`bg-card rounded-xl border border-border p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between mb-3 gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
            {subtitle && <p className="text-xs text-secondary mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-secondary p-4 bg-muted/40 rounded-lg text-center">{children}</p>;
}

function ChartSkeleton({ height = 240 }: { height?: number }) {
  return <div className="bg-muted rounded-lg animate-pulse" style={{ height }} />;
}

type BarSpec = { key: string; name?: string; color: string };

/**
 * Vertical (column) bar chart that fits the panel width — no forced sideways
 * scrolling. The panel is drag-resizable (taller) via the handle at its bottom
 * edge, and the Expand control opens it in a large overlay so every bar is
 * visible at once even when there are many categories.
 */
function AdaptiveBarChart({
  data, categoryKey, bars, stacked = false, baseHeight = 260, onBarClick,
  cellColorFn, valueDomain, valueFormatter, categoryFormatter, showLabels = false, title,
}: {
  data: any[];
  categoryKey: string;
  bars: BarSpec[];
  stacked?: boolean;
  baseHeight?: number;
  onBarClick?: (d: any) => void;
  cellColorFn?: (d: any) => string;
  valueDomain?: [number, number];
  valueFormatter?: (v: any) => string;
  categoryFormatter?: (v: string) => string;
  showLabels?: boolean;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const many = data.length > 10;
  const click = onBarClick ? { cursor: 'pointer', onClick: (d: any) => onBarClick(d) } : {};
  const catFmt = categoryFormatter ?? ((v: string) => (v && v.length > 16 ? v.slice(0, 14) + '…' : v));

  // Fresh element tree per call so the inline + expanded charts never share instances.
  const renderChart = (big = false) => (
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: many ? 56 : 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
      <XAxis
        dataKey={categoryKey}
        interval={0}
        tick={{ fontSize: big ? 12 : 10 }}
        tickFormatter={big ? undefined : catFmt}
        angle={many ? -45 : 0}
        textAnchor={many ? 'end' : 'middle'}
        height={many ? (big ? 110 : 72) : 24}
      />
      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} domain={valueDomain} tickFormatter={valueFormatter as any} />
      <Tooltip formatter={valueFormatter as any} />
      {bars.length > 1 && <Legend verticalAlign="top" height={28} />}
      {bars.map((b, i) => (
        <Bar
          key={b.key}
          dataKey={b.key}
          name={b.name ?? b.key}
          fill={b.color}
          stackId={stacked ? 'a' : undefined}
          radius={stacked && i !== bars.length - 1 ? [0, 0, 0, 0] : [2, 2, 0, 0]}
          label={showLabels && !stacked ? ({ position: 'top', fontSize: 11, fill: 'var(--color-secondary)' } as any) : undefined}
          {...click}
        >
          {cellColorFn && data.map((d, di) => <Cell key={di} fill={cellColorFn(d)} />)}
        </Bar>
      ))}
    </BarChart>
  );

  return (
    <>
      <div className="relative group">
        <button
          onClick={() => setExpanded(true)}
          title="Expand chart"
          aria-label="Expand chart"
          className="absolute top-1 right-1 z-10 p-1.5 rounded-md bg-card/80 backdrop-blur border border-border text-secondary hover:text-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        >
          <Maximize2 size={14} />
        </button>
        {/* Drag the bottom edge to resize taller; Expand for the full-width view. */}
        <div
          className="rounded-lg"
          style={{ resize: 'vertical', overflow: 'hidden', height: baseHeight + (many ? 40 : 0), minHeight: 200 }}
        >
          <ResponsiveContainer width="100%" height="100%">{renderChart()}</ResponsiveContainer>
        </div>
      </div>

      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8" onClick={() => setExpanded(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-card rounded-xl border border-border shadow-2xl w-full max-w-[1400px] h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground">{title || 'Chart'}</h3>
              <button onClick={() => setExpanded(false)} className="p-1.5 rounded-lg hover:bg-muted text-secondary" title="Close" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <ResponsiveContainer width="100%" height="100%">{renderChart(true)}</ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Drilldown Panel ───
function DrilldownPanel({ title, onClose, type, filter, dateFrom, dateTo }: {
  title: string; onClose: () => void; type: string; filter: string; dateFrom?: string; dateTo?: string;
}) {
  const params = new URLSearchParams({ type, filter });
  if (dateFrom) params.set('from', dateFrom);
  if (dateTo) params.set('to', dateTo);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['analytics-drilldown', type, filter, dateFrom, dateTo],
    queryFn: () => api.get(`/analytics/drilldown?${params}`).then(r => r.data),
  });

  const isExit = type.startsWith('exit_');

  function exportCsv() {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map((r: any) => keys.map(k => `"${r[k] ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${type}_${filter}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-xl bg-card border-l border-border h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-secondary">{rows.length} employees</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} className="p-2 hover:bg-muted rounded-lg transition-colors" title="Export CSV">
              <Download size={16} className="text-secondary" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors"><X size={16} /></button>
          </div>
        </div>
        <div className="p-6">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-muted rounded-lg animate-pulse" />)}</div>
          ) : rows.length === 0 ? (
            <p className="text-center text-secondary py-8">No data found</p>
          ) : (
            <div className="space-y-2">
              {rows.map((r: any, i: number) => (
                <div key={i} className="bg-muted/50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.first_name} {r.last_name}</p>
                      <p className="text-xs text-secondary">{r.employee_code} &middot; {r.role || r.department || '—'}</p>
                    </div>
                    <div className="text-right">
                      {isExit ? (
                        <>
                          <p className="text-xs text-secondary">{r.exit_date}</p>
                          <p className="text-xs text-red-600">{r.exit_reason}</p>
                        </>
                      ) : (
                        <p className="text-xs text-secondary">Joined {r.date_of_joining}</p>
                      )}
                    </div>
                  </div>
                  {(r.property || r.department) && (
                    <p className="text-xs text-secondary mt-1">{r.property || ''} {r.department ? `· ${r.department}` : ''}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───
function OrgAnalytics() {
  const [activeTab, setActiveTab] = useState<TabKey>('workforce');
  const [drilldown, setDrilldown] = useState<{ title: string; type: string; filter: string; from?: string; to?: string } | null>(null);

  // Properties tab state
  const [statusTab, setStatusTab] = useState('present');
  const [statusProperty, setStatusProperty] = useState('');
  const [statusDept, setStatusDept] = useState('');
  const [statusPage, setStatusPage] = useState(1);
  const [statusDate, setStatusDate] = useState('');

  const { data: kpi, isLoading: kpiLoading } = useQuery({
    queryKey: ['analytics-kpi'],
    queryFn: () => api.get('/analytics/kpi').then(r => r.data),
  });

  const { data: workforce, isLoading: wfLoading } = useQuery({
    queryKey: ['analytics-workforce'],
    queryFn: () => api.get('/analytics/workforce').then(r => r.data),
    enabled: activeTab === 'workforce',
  });

  const { data: attritionData, isLoading: attrLoading } = useQuery({
    queryKey: ['analytics-attrition-v2'],
    queryFn: () => api.get('/analytics/attrition-analysis').then(r => r.data),
    enabled: activeTab === 'attrition',
  });

  const { data: attendProd, isLoading: attendLoading } = useQuery({
    queryKey: ['analytics-attendance-prod'],
    queryFn: () => api.get('/analytics/attendance-productivity').then(r => r.data),
    enabled: activeTab === 'attendance',
  });

  const today = new Date().toISOString().split('T')[0];

  const { data: propAnalytics, isLoading: propAnalyticsLoading } = useQuery({
    queryKey: ['analytics-property', statusDate],
    queryFn: () => {
      const p = new URLSearchParams();
      if (statusDate) p.set('date', statusDate);
      return api.get(`/analytics/property-analytics?${p}`).then(r => r.data);
    },
    enabled: activeTab === 'properties',
  });

  const effectiveDate = statusDate || propAnalytics?.date || today;
  const scope = statusProperty
    ? (propAnalytics?.byProperty?.find((p: any) => p.property === statusProperty) ?? null)
    : propAnalytics?.totals ?? null;

  const statusParams = new URLSearchParams({ tab: statusTab, date: effectiveDate, page: String(statusPage) });
  if (statusProperty) statusParams.set('property', statusProperty);
  if (statusDept) statusParams.set('department', statusDept);

  const { data: propStatus, isLoading: propStatusLoading } = useQuery({
    queryKey: ['analytics-prop-status', statusTab, statusProperty, statusDept, statusPage, effectiveDate],
    queryFn: () => api.get(`/analytics/property-status?${statusParams}`).then(r => r.data),
    enabled: activeTab === 'properties' && !!propAnalytics,
  });

  // Department options for the Properties filter (org-wide list).
  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: () => api.get('/admin/departments').then(r => r.data).catch(() => []),
    enabled: activeTab === 'properties',
  });

  const kpiCards = [
    { label: 'Headcount', value: kpi?.totalHeadcount ?? '—', icon: Users, color: '#3b82f6', tab: 'workforce' as TabKey },
    { label: 'Attrition MTD', value: kpi ? `${kpi.attritionMtd}%` : '—', sub: kpi ? `${kpi.attritionExitsMtd} exits` : '', icon: TrendingDown, color: '#ef4444', tab: 'attrition' as TabKey },
    { label: 'Attendance Today', value: kpi ? `${kpi.attendanceRateToday}%` : '—', sub: kpi ? `${kpi.presentToday} present` : '', icon: CalendarCheck, color: '#10b981', tab: 'attendance' as TabKey },
    { label: 'Open Positions', value: kpi?.openPositions ?? '—', icon: Briefcase, color: '#8b5cf6', tab: 'workforce' as TabKey },
    { label: 'Absenteeism MTD', value: kpi ? `${kpi.absenteeismRateMtd}%` : '—', icon: AlertTriangle, color: '#f59e0b', tab: 'attendance' as TabKey },
    { label: 'Late Arrivals MTD', value: kpi ? `${kpi.lateArrivalRateMtd}%` : '—', sub: kpi ? `${kpi.lateCountMtd}/${kpi.totalCheckinsMtd}` : '', icon: Clock, color: '#f97316', tab: 'attendance' as TabKey },
  ];

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">HR Analytics</h1>
          <p className="text-secondary mt-1">Organization-wide insights — click a metric or chart to drill in</p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpiLoading
            ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="bg-card rounded-xl border border-border h-[88px] animate-pulse" />)
            : kpiCards.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.label}
                    onClick={() => setActiveTab(card.tab)}
                    className="bg-card rounded-xl border border-border p-4 text-left hover:border-primary/50 hover:shadow-sm transition-all"
                    style={{ borderLeft: `3px solid ${card.color}` }}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Icon size={14} style={{ color: card.color }} />
                      <span className="text-[11px] font-medium text-secondary uppercase tracking-wide leading-tight">{card.label}</span>
                    </div>
                    <p className="text-2xl font-bold text-foreground">{card.value}</p>
                    {card.sub && <p className="text-[11px] text-secondary mt-0.5">{card.sub}</p>}
                  </button>
                );
              })}
        </div>

        {/* Sticky tab bar */}
        <div className="sticky top-0 z-10 bg-background pt-1 pb-2">
          <div className="inline-flex gap-1 bg-muted p-1 rounded-xl">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'
                  }`}
                >
                  <Icon size={15} className={active ? 'text-primary' : ''} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ Workforce ═══ */}
        {activeTab === 'workforce' && (
          wfLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{Array.from({ length: 4 }).map((_, i) => <Panel key={i} title=" "><ChartSkeleton /></Panel>)}</div>
          ) : workforce ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Panel title="Headcount by Property">
                {workforce.byProperty.length === 0 ? <EmptyHint>No data</EmptyHint> : (
                  <AdaptiveBarChart
                    title="Headcount by Property"
                    data={workforce.byProperty}
                    categoryKey="property"
                    bars={[{ key: 'count', name: 'Headcount', color: '#3b82f6' }]}
                    showLabels
                    onBarClick={(d) => d?.property && setDrilldown({ title: `${d.property} — ${d.count} employees`, type: 'property', filter: d.property })}
                  />
                )}
              </Panel>

              <Panel title="Headcount by Department">
                {workforce.byDepartment.length === 0 ? <EmptyHint>No data</EmptyHint> : (
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={240}>
                      <PieChart>
                        <Pie data={workforce.byDepartment} dataKey="count" nameKey="department" cx="50%" cy="50%" outerRadius={95} innerRadius={55} paddingAngle={2} cursor="pointer"
                          onClick={(d: any) => d?.department && setDrilldown({ title: `${d.department} — ${d.count} employees`, type: 'department', filter: d.department })}>
                          {workforce.byDepartment.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5 max-h-[240px] overflow-y-auto">
                      {workforce.byDepartment.map((d: any, i: number) => (
                        <button key={d.department} onClick={() => setDrilldown({ title: `${d.department} — ${d.count} employees`, type: 'department', filter: d.department })}
                          className="flex items-center gap-2 w-full text-left hover:bg-muted/50 px-2 py-1 rounded transition-colors">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-sm text-foreground flex-1 truncate">{d.department}</span>
                          <span className="text-sm font-medium text-foreground">{d.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="Staff per Property">
                <div className="overflow-y-auto max-h-[280px]">
                  <table className="w-full">
                    <thead><tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Property</th>
                      <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">Staff</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {workforce.staffByProperty.map((p: any) => (
                        <tr key={p.property} className="hover:bg-muted/30">
                          <td className="px-3 py-2 text-sm text-foreground">{p.property || 'Unassigned'}</td>
                          <td className="px-3 py-2 text-sm text-right font-medium">{p.staff}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Open Positions" subtitle={`${workforce.openPositions.length} open`}>
                {workforce.openPositions.length === 0 ? <EmptyHint>No open positions</EmptyHint> : (
                  <div className="overflow-y-auto max-h-[280px]">
                    <table className="w-full">
                      <thead><tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Role</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Property</th>
                        <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">Days</th>
                      </tr></thead>
                      <tbody className="divide-y divide-border">
                        {[...workforce.openPositions].sort((a: any, b: any) => b.days_open - a.days_open).map((p: any, i: number) => (
                          <tr key={i} className="hover:bg-muted/30">
                            <td className="px-3 py-2 text-sm text-foreground">{p.role || '—'}</td>
                            <td className="px-3 py-2 text-sm text-secondary">{p.property || '—'}</td>
                            <td className={`px-3 py-2 text-sm text-right font-medium ${p.days_open > 30 ? 'text-red-600' : 'text-foreground'}`}>{p.days_open}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          ) : null
        )}

        {/* ═══ Attrition ═══ */}
        {activeTab === 'attrition' && (
          attrLoading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">{Array.from({ length: 4 }).map((_, i) => <Panel key={i} title=" "><ChartSkeleton /></Panel>)}</div>
          ) : attritionData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Panel title="Monthly Attrition Trend" subtitle="Last 6 months">
                {attritionData.monthlyTrend.length === 0 ? <EmptyHint>No exit data</EmptyHint> : (
                  <ResponsiveContainer width="100%" height={230}>
                    <LineChart data={attritionData.monthlyTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip />
                      <Line type="monotone" dataKey="exits" stroke="#ef4444" strokeWidth={2} name="Exits" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Panel>

              <Panel title="Exit Reasons">
                {attritionData.byReason.length === 0 ? <EmptyHint>No exit data</EmptyHint> : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {attritionData.byReason.map((r: any) => (
                      <div key={r.reason} className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: EXIT_COLORS[r.reason] || '#94a3b8' }} />
                        <span className="text-sm text-foreground capitalize">{r.reason?.replace(/_/g, ' ') || 'Unknown'}</span>
                        <span className="text-sm font-bold text-foreground">{r.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="Attrition by Property">
                {attritionData.byProperty.length === 0 ? <EmptyHint>No exit data</EmptyHint> : (
                  <AdaptiveBarChart
                    title="Attrition by Property"
                    data={attritionData.byProperty}
                    categoryKey="property"
                    bars={[{ key: 'exits', name: 'Exits', color: '#ef4444' }]}
                    showLabels
                    baseHeight={230}
                    onBarClick={(d) => d?.property && setDrilldown({ title: `Exits — ${d.property}`, type: 'exit_property', filter: d.property })}
                  />
                )}
              </Panel>

              <Panel title="Attrition by Department">
                {attritionData.byDepartment.length === 0 ? <EmptyHint>No exit data</EmptyHint> : (
                  <AdaptiveBarChart
                    title="Attrition by Department"
                    data={attritionData.byDepartment}
                    categoryKey="department"
                    bars={[{ key: 'exits', name: 'Exits', color: '#f59e0b' }]}
                    showLabels
                    baseHeight={230}
                    onBarClick={(d) => d?.department && setDrilldown({ title: `Exits — ${d.department}`, type: 'exit_department', filter: d.department })}
                  />
                )}
              </Panel>
            </div>
          ) : null
        )}

        {/* ═══ Attendance ═══ */}
        {activeTab === 'attendance' && (
          attendLoading ? (
            <div className="space-y-5"><Panel title=" "><ChartSkeleton height={260} /></Panel><div className="grid grid-cols-1 lg:grid-cols-2 gap-5"><Panel title=" "><ChartSkeleton /></Panel><Panel title=" "><ChartSkeleton /></Panel></div></div>
          ) : attendProd ? (
            <div className="space-y-5">
              <Panel title="Daily Attendance Trend" subtitle="Last 30 days — % present">
                {attendProd.dailyTrend.length === 0 ? <EmptyHint>No attendance data</EmptyHint> : (
                  <AdaptiveBarChart
                    title="Daily Attendance Trend — % present"
                    data={attendProd.dailyTrend}
                    categoryKey="date"
                    bars={[{ key: 'pct', name: 'Attendance %', color: '#10b981' }]}
                    cellColorFn={(d) => (d.pct >= 90 ? '#10b981' : d.pct >= 80 ? '#f59e0b' : '#ef4444')}
                    valueDomain={[0, 100]}
                    valueFormatter={(v) => `${v}%`}
                    categoryFormatter={(v) => String(v).slice(5)}
                    baseHeight={260}
                  />
                )}
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Panel title="Attendance by Property" subtitle="Today">
                  {attendProd.todayByProperty.length === 0 ? <EmptyHint>No attendance data for today</EmptyHint> : (
                    <div className="overflow-y-auto max-h-[260px]">
                      <table className="w-full">
                        <thead><tr className="border-b border-border">
                          <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Property</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">P</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">A</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">L</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-secondary uppercase">%</th>
                        </tr></thead>
                        <tbody className="divide-y divide-border">
                          {attendProd.todayByProperty.map((p: any) => (
                            <tr key={p.property} className="hover:bg-muted/30 cursor-pointer"
                              onClick={() => setDrilldown({ title: `${p.property} — Today's Attendance`, type: 'property', filter: p.property })}>
                              <td className="px-3 py-2 text-sm text-foreground">{p.property}</td>
                              <td className="px-3 py-2 text-sm text-right text-green-600 font-medium">{p.present}</td>
                              <td className="px-3 py-2 text-sm text-right text-red-600 font-medium">{p.absent}</td>
                              <td className="px-3 py-2 text-sm text-right text-blue-600 font-medium">{p.on_leave}</td>
                              <td className={`px-3 py-2 text-sm text-right font-bold ${Number(p.pct_present) >= 90 ? 'text-green-600' : Number(p.pct_present) >= 80 ? 'text-amber-600' : 'text-red-600'}`}>{p.pct_present}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                <Panel title="Late Arrival Trend" subtitle={`Last 30 days · avg ${attendProd.avgLateTime}`}>
                  {attendProd.lateTrend.length === 0 ? <EmptyHint>No data</EmptyHint> : (
                    <ResponsiveContainer width="100%" height={230}>
                      <LineChart data={attendProd.lateTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip labelFormatter={(l: any) => `Date: ${l}`} />
                        <Line type="monotone" dataKey="late_count" stroke="#f97316" strokeWidth={2} name="Late Arrivals" dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </Panel>
              </div>
            </div>
          ) : null
        )}

        {/* ═══ Properties ═══ */}
        {activeTab === 'properties' && (
          <div className="space-y-5">
            {/* Filters */}
            <div className="bg-card rounded-xl border border-border px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-secondary">Date</span>
                <select value={effectiveDate} onChange={e => { setStatusDate(e.target.value); setStatusPage(1); }}
                  className="px-3 py-1.5 border border-border rounded-lg bg-background text-xs">
                  {!propAnalytics?.availableDates?.includes(effectiveDate) && <option value={effectiveDate}>{effectiveDate}</option>}
                  {(propAnalytics?.availableDates ?? []).map((d: string) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-secondary">Property</span>
                <select value={statusProperty} onChange={e => { setStatusProperty(e.target.value); setStatusPage(1); }}
                  className="px-3 py-1.5 border border-border rounded-lg bg-background text-xs min-w-[160px]">
                  <option value="">All Properties</option>
                  {(propAnalytics?.byProperty ?? []).map((p: any) => <option key={p.property} value={p.property}>{p.property}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-secondary">Department</span>
                <select value={statusDept} onChange={e => { setStatusDept(e.target.value); setStatusPage(1); }}
                  className="px-3 py-1.5 border border-border rounded-lg bg-background text-xs min-w-[160px]">
                  <option value="">All Departments</option>
                  {(departments ?? []).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              {(statusProperty || statusDept || statusDate) && (
                <button onClick={() => { setStatusProperty(''); setStatusDept(''); setStatusDate(''); setStatusPage(1); }}
                  className="text-xs text-secondary hover:text-foreground underline">Reset</button>
              )}
              <span className="text-xs text-secondary ml-auto">
                {statusProperty || 'All Properties'} · {effectiveDate}
                {scope && <> · headcount <span className="font-semibold text-foreground">{scope.headcount}</span> · <span className="font-semibold text-green-600">{scope.pct_present}%</span> present</>}
              </span>
            </div>

            {propAnalyticsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
            ) : (
              <>
                {/* Status cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {STATUS_META.map(s => {
                    const Icon = s.icon;
                    const value = scope ? (scope as any)[s.key] ?? 0 : 0;
                    const active = s.tab && statusTab === s.tab;
                    return (
                      <button key={s.key} disabled={!s.tab}
                        onClick={() => { if (s.tab) { setStatusTab(s.tab); setStatusPage(1); } }}
                        className={`text-left rounded-xl border p-3 transition-all ${s.tab ? 'hover:shadow-sm cursor-pointer' : 'cursor-default'} ${active ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
                        style={{ background: `${s.color}0d` }}>
                        <div className="flex items-center gap-1.5 mb-1">
                          <Icon size={14} style={{ color: s.color }} />
                          <span className="text-[11px] font-medium text-secondary uppercase tracking-wide">{s.label}</span>
                        </div>
                        <p className="text-2xl font-bold" style={{ color: s.color }}>{value}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Chart + detail side by side on wide screens */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                  <Panel title={statusProperty ? `${statusProperty} — status mix` : 'Status by property'}>
                    {statusProperty ? (
                      <div className="flex items-center gap-4">
                        <ResponsiveContainer width="55%" height={230}>
                          <PieChart>
                            <Pie data={STATUS_META.filter(s => s.key !== 'exited' && scope && (scope as any)[s.key] > 0).map(s => ({ name: s.label, value: (scope as any)[s.key] }))}
                              dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} paddingAngle={2}>
                              {STATUS_META.filter(s => s.key !== 'exited' && scope && (scope as any)[s.key] > 0).map((s, i) => <Cell key={i} fill={s.color} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex-1 space-y-2">
                          {STATUS_META.map(s => (
                            <div key={s.key} className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                              <span className="text-sm text-foreground flex-1">{s.label}</span>
                              <span className="text-sm font-medium text-foreground">{scope ? (scope as any)[s.key] : 0}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      (propAnalytics?.byProperty?.length ?? 0) === 0 ? <EmptyHint>No property data</EmptyHint> : (
                        <AdaptiveBarChart
                          title="Status by property"
                          data={propAnalytics?.byProperty ?? []}
                          categoryKey="property"
                          stacked
                          baseHeight={240}
                          bars={[
                            { key: 'present', name: 'Present', color: '#10b981' },
                            { key: 'absent', name: 'Absent', color: '#ef4444' },
                            { key: 'on_leave', name: 'On Leave', color: '#3b82f6' },
                            { key: 'unmarked', name: 'Unmarked', color: '#94a3b8' },
                          ]}
                          onBarClick={(d) => d?.property && setStatusProperty(d.property)}
                        />
                      )
                    )}
                  </Panel>

                  <Panel
                    title="Employee Detail"
                    right={
                      <button
                        onClick={() => {
                          if (!propStatus?.rows?.length) return;
                          const keys = Object.keys(propStatus.rows[0]);
                          const csv = [keys.join(','), ...propStatus.rows.map((r: any) => keys.map((k) => `"${r[k] ?? ''}"`).join(','))].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = `${statusProperty || 'all'}_${statusTab}_${effectiveDate}.csv`; a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors"
                      >
                        <Download size={12} /> CSV
                      </button>
                    }
                  >
                    <div className="flex gap-1 bg-muted p-0.5 rounded-lg mb-3 w-fit">
                      {STATUS_META.filter(s => s.tab).map(s => (
                        <button key={s.tab} onClick={() => { setStatusTab(s.tab!); setStatusPage(1); }}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${statusTab === s.tab ? 'bg-card text-foreground shadow-sm' : 'text-secondary hover:text-foreground'}`}>
                          {s.label}
                        </button>
                      ))}
                    </div>

                    {propStatusLoading ? (
                      <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-9 bg-muted rounded animate-pulse" />)}</div>
                    ) : propStatus?.rows?.length === 0 ? (
                      <EmptyHint>No {statusTab.replace('_', ' ')} records</EmptyHint>
                    ) : (
                      <>
                        <div className="overflow-auto max-h-[320px]">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-card"><tr className="border-b border-border">
                              <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Employee</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Dept</th>
                              {statusTab === 'exited' ? <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Exit</th>
                                : statusTab === 'on_leave' ? <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Leave</th>
                                : <th className="text-left px-3 py-2 text-xs font-medium text-secondary uppercase">Check-In</th>}
                            </tr></thead>
                            <tbody className="divide-y divide-border">
                              {propStatus?.rows?.map((r: any, i: number) => (
                                <tr key={i} className="hover:bg-muted/30">
                                  <td className="px-3 py-2 text-sm font-medium text-foreground">
                                    {r.first_name} {r.last_name}
                                    <span className="block text-xs text-secondary font-normal">{r.employee_code} · {r.property || '—'}</span>
                                  </td>
                                  <td className="px-3 py-2 text-sm text-secondary">{r.department || '—'}</td>
                                  {statusTab === 'exited' ? (
                                    <td className="px-3 py-2 text-sm"><span className="text-red-600 capitalize">{r.exit_type?.replace(/_/g, ' ') || '—'}</span><span className="block text-xs text-secondary">{r.last_working_day || ''}</span></td>
                                  ) : statusTab === 'on_leave' ? (
                                    <td className="px-3 py-2 text-sm text-secondary">{r.leave_type || '—'}<span className="block text-xs">{r.start_date} → {r.end_date}</span></td>
                                  ) : (
                                    <td className="px-3 py-2 text-sm text-secondary">{r.check_in && !r.check_in.includes('NA') ? r.check_in.split(' ')[1]?.slice(0, 5) : '—'}</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {propStatus && propStatus.total > 25 && (
                          <div className="flex items-center justify-between mt-3">
                            <button onClick={() => setStatusPage(p => Math.max(1, p - 1))} disabled={statusPage <= 1}
                              className="px-3 py-1.5 border border-border rounded-lg text-xs disabled:opacity-40">Previous</button>
                            <span className="text-xs text-secondary">Page {statusPage} of {Math.ceil(propStatus.total / 25)}</span>
                            <button onClick={() => setStatusPage(p => p + 1)} disabled={statusPage >= Math.ceil(propStatus.total / 25)}
                              className="px-3 py-1.5 border border-border rounded-lg text-xs disabled:opacity-40">Next</button>
                          </div>
                        )}
                      </>
                    )}
                  </Panel>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {drilldown && (
        <DrilldownPanel title={drilldown.title} type={drilldown.type} filter={drilldown.filter}
          dateFrom={drilldown.from} dateTo={drilldown.to} onClose={() => setDrilldown(null)} />
      )}
    </AppShell>
  );
}

export default function AnalyticsPage() {
  const { isEmployee } = usePermissions();
  return isEmployee ? <EmployeeAnalytics /> : <OrgAnalytics />;
}
