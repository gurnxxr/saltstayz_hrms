'use client';

import { employeeStatusMeta } from '@/lib/employeeStatus';

// The one badge used to render an employee's work status everywhere.
export default function EmployeeStatusChip({ status }: { status?: string | null }) {
  const m = employeeStatusMeta(status);
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}>
      {m.label}
    </span>
  );
}
