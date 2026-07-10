'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import LoadError from '@/components/ui/LoadError';
import { CalendarDays, MapPin } from 'lucide-react';

// Read-only: the holidays that apply to the logged-in person — national + the
// holidays for their property's state.
export default function MyHolidays() {
  const { data, isError, refetch } = useQuery({
    queryKey: ['my-holidays'],
    queryFn: () => api.get('/leave/holidays/me').then(r => r.data),
  });

  if (isError) return <LoadError message="Couldn't load holidays." onRetry={() => refetch()} />;

  const holidays: any[] = data?.holidays ?? [];
  const state: string | null = data?.region?.state ?? null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary inline-flex items-center gap-1.5">
        <MapPin size={14} className="text-primary" />
        Showing national holidays{state ? <> + holidays for <span className="font-medium text-foreground">{state}</span></> : <> (your work location has no state set)</>}.
      </p>

      <div className="bg-card rounded-xl border border-border overflow-hidden">
        {holidays.length === 0 ? (
          <div className="p-8 text-center text-secondary">
            <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
            <p>No holidays published yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-secondary">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Holiday</th>
                <th className="px-4 py-3 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holidays.map((h: any) => (
                <tr key={h.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 whitespace-nowrap text-foreground">
                    {new Date(h.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{h.name}</td>
                  <td className="px-4 py-3">
                    {h.is_national
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">National</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">{h.state || 'State'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
