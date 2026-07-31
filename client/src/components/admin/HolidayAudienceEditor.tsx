'use client';

import { Users, Filter, Building2, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import LoadError from '@/components/ui/LoadError';

export interface AudienceDraft {
  all_departments: boolean;
  department_ids: number[];
  all_properties: boolean;
  property_ids: number[];
}

interface Props {
  value: AudienceDraft;
  onChange: (next: AudienceDraft) => void;
  departments: Array<{ id: number; name: string }>;
  properties: Array<{ id: number; name: string }>;
  /** Distinct per instance — the radio `name` groups depend on it. */
  idPrefix: string;
  catalogError?: boolean;
  onRetryCatalog?: () => void;
}

/**
 * Who a holiday is for: departments and hotels, both explicit.
 *
 * The mode is a RADIO PAIR, never a bare checkbox list. Two clicks away, the Leave Control Panel
 * has a department checkbox list that means the opposite ("leave all unticked to make this
 * available to every department"). Same words, same product, inverted meaning — so here an
 * unticked list is unreachable: you cannot see the checkboxes until you have said "only some".
 */
export default function HolidayAudienceEditor({
  value, onChange, departments, properties, idPrefix, catalogError, onRetryCatalog,
}: Props) {
  if (catalogError) {
    return (
      <LoadError
        compact
        message="Couldn't load the department and hotel lists, so this can't be set safely."
        onRetry={onRetryCatalog}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <Axis
        legend="Departments"
        allLabel="Every department"
        someLabel="Only some departments"
        allIcon={<Users size={13} />}
        groupName={`${idPrefix}-dept`}
        isAll={value.all_departments}
        onAll={() => onChange({ ...value, all_departments: true, department_ids: [] })}
        onSome={() => onChange({ ...value, all_departments: false })}
        items={departments}
        selected={value.department_ids}
        onToggle={(id, on) => onChange({
          ...value,
          department_ids: on
            ? [...value.department_ids, id]
            : value.department_ids.filter((x) => x !== id),
        })}
        onSelectAll={() => onChange({ ...value, department_ids: departments.map((d) => d.id) })}
        onClear={() => onChange({ ...value, department_ids: [] })}
        emptyHint="No departments are set up yet."
        emptyAction={<Link href="/admin/organization" className="text-primary hover:underline">Set them up in Admin → Organization</Link>}
      />

      <Axis
        legend="Hotels"
        allLabel="Every hotel"
        someLabel="Only some hotels"
        allIcon={<Building2 size={13} />}
        groupName={`${idPrefix}-prop`}
        isAll={value.all_properties}
        onAll={() => onChange({ ...value, all_properties: true, property_ids: [] })}
        onSome={() => onChange({ ...value, all_properties: false })}
        items={properties}
        selected={value.property_ids}
        onToggle={(id, on) => onChange({
          ...value,
          property_ids: on
            ? [...value.property_ids, id]
            : value.property_ids.filter((x) => x !== id),
        })}
        onSelectAll={() => onChange({ ...value, property_ids: properties.map((p) => p.id) })}
        onClear={() => onChange({ ...value, property_ids: [] })}
        emptyHint="No hotels are set up yet."
        emptyAction={<Link href="/admin/organization" className="text-primary hover:underline">Set them up in Admin → Organization</Link>}
      />
    </div>
  );
}

const modeCls = (on: boolean) =>
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium cursor-pointer '
  + 'transition-colors focus-within:ring-2 focus-within:ring-primary/50 '
  + (on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-secondary hover:bg-muted');

const chipCls = (on: boolean) =>
  'inline-flex items-center gap-2 max-w-[14rem] px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer '
  + 'transition-colors '
  + (on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-secondary hover:bg-muted');

function Axis({
  legend, allLabel, someLabel, allIcon, groupName, isAll, onAll, onSome,
  items, selected, onToggle, onSelectAll, onClear, emptyHint, emptyAction,
}: {
  legend: string; allLabel: string; someLabel: string; allIcon: React.ReactNode;
  groupName: string; isAll: boolean; onAll: () => void; onSome: () => void;
  items: Array<{ id: number; name: string }>; selected: number[];
  onToggle: (id: number, on: boolean) => void;
  onSelectAll: () => void; onClear: () => void;
  emptyHint: string; emptyAction: React.ReactNode;
}) {
  const none = items.length === 0;
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-secondary mb-1.5">{legend}</legend>

      <div className="flex flex-wrap gap-2">
        {/* Real radios, visually hidden: arrow-key navigation and screen-reader grouping come
            free, and focus-within puts the ring on the pill. */}
        <label className={modeCls(isAll)}>
          <input type="radio" name={groupName} className="sr-only" checked={isAll} onChange={onAll} />
          {allIcon} {allLabel}
        </label>
        <label className={modeCls(!isAll)}>
          <input
            type="radio" name={groupName} className="sr-only"
            disabled={none} checked={!isAll} onChange={onSome}
          />
          <Filter size={13} /> {someLabel}
        </label>
      </div>

      {none && (
        <p className="mt-2 text-xs text-secondary">{emptyHint} {emptyAction}</p>
      )}

      {!isAll && !none && (
        <>
          {items.length > 8 && (
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={onSelectAll} className="text-xs font-medium text-primary hover:underline">Select all</button>
              <button type="button" onClick={onClear} className="text-xs font-medium text-primary hover:underline">Clear</button>
            </div>
          )}
          <div
            role="group"
            aria-label={`${legend} this holiday applies to`}
            className={`mt-2 flex flex-wrap gap-1.5 ${items.length > 8 ? 'max-h-32 overflow-y-auto rounded-lg border border-border p-2' : ''}`}
          >
            {items.map((it) => {
              const on = selected.includes(it.id);
              return (
                <label key={it.id} className={chipCls(on)}>
                  <input
                    type="checkbox"
                    className="accent-primary w-4 h-4 shrink-0"
                    checked={on}
                    onChange={(e) => onToggle(it.id, e.target.checked)}
                  />
                  <span className="truncate" title={it.name}>{it.name}</span>
                </label>
              );
            })}
          </div>
          {selected.length === 0 && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle size={12} /> Pick at least one, or choose &ldquo;{allLabel}&rdquo;.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Nothing is picked on an axis that says "only some" — the save that reaches nobody. */
export function audienceIsIncomplete(d: AudienceDraft): boolean {
  return (!d.all_departments && d.department_ids.length === 0)
    || (!d.all_properties && d.property_ids.length === 0);
}
