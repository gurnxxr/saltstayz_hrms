import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { computePayslip, DEFAULT_COMPOSITION, type SalaryInputs, type PayslipBreakdown } from './payslip.calc';
import { getStatutoryRates } from './statutory.service';

const TABLE = 'designation_salary_structures';

function num(v: any): number {
  return v === null || v === undefined || v === '' ? 0 : Number(v);
}

/**
 * Builds the calc inputs (gross, amounts, composition percentages) from a stored
 * structure row. Statutory rates (PF/ESI/LWF) are NOT taken from the structure —
 * they come from Statutory Components settings (the legacy pct_employee_pf/pct_esi
 * columns are ignored; retired in Phase 2).
 */
export function structureToInputs(s: any): SalaryInputs {
  return {
    gross: num(s.gross),
    city: s.city,
    pli: num(s.pli),
    meal: num(s.meal),
    accommodation: num(s.accommodation),
    accommodation_allowance: num(s.accommodation_allowance),
    lwf_employee: s.lwf_employee === null || s.lwf_employee === undefined ? null : num(s.lwf_employee),
    lwf_employer: s.lwf_employer === null || s.lwf_employer === undefined ? null : num(s.lwf_employer),
    pct: {
      basic: num(s.pct_basic ?? DEFAULT_COMPOSITION.basic),
      hra: num(s.pct_hra ?? DEFAULT_COMPOSITION.hra),
      gratuity: num(s.pct_gratuity ?? DEFAULT_COMPOSITION.gratuity),
    },
  };
}

export async function breakdownForStructure(s: any): Promise<PayslipBreakdown> {
  const rates = await getStatutoryRates(s.city);
  return computePayslip(structureToInputs(s), rates);
}

// Advertised CTC headroom above the structure's exact CTC (the structure CTC is the floor).
export const JD_CTC_BAND_PCT = 15;

export interface CtcRange {
  configured: boolean;
  monthly_ctc: number;
  annual_low: number;
  annual_high: number;
  label: string; // e.g. "₹2.32 – 2.67 LPA"
}

/**
 * Resolves the advertised CTC range for a designation from its salary structure.
 * Single source of truth shared by the vacancy form, vacancy detail, and JD PDF —
 * computed live so structure edits always reflect on postings. Range = structure
 * CTC (floor) up to +JD_CTC_BAND_PCT% headroom, expressed annually (LPA).
 */
export async function getCtcRange(jobTitleId: number): Promise<CtcRange> {
  const row = await getStructureRow(jobTitleId);
  if (!row) {
    return { configured: false, monthly_ctc: 0, annual_low: 0, annual_high: 0, label: '' };
  }
  const monthly_ctc = Math.round((await breakdownForStructure(row)).ctc);
  const annual_low = monthly_ctc * 12;
  const annual_high = Math.round(annual_low * (1 + JD_CTC_BAND_PCT / 100));
  const lpa = (n: number) => (n / 100000).toFixed(2);
  const label = `₹${lpa(annual_low)} – ${lpa(annual_high)} LPA`;
  return { configured: true, monthly_ctc, annual_low, annual_high, label };
}

/** All designations with their structure (if configured) + a computed breakdown. */
export async function listStructures() {
  const rows = await db('job_titles as jt')
    .leftJoin(`${TABLE} as ss`, 'ss.job_title_id', 'jt.id')
    .select('jt.id as job_title_id', 'jt.title as designation', 'ss.*')
    .orderBy('jt.title');

  // employee counts per designation (active)
  const counts = await db('employees')
    .where('is_active', true)
    .whereNotNull('job_title_id')
    .select('job_title_id')
    .count('id as c')
    .groupBy('job_title_id');
  const countMap = new Map<number, number>(counts.map((r: any) => [r.job_title_id, Number(r.c)]));

  return Promise.all(rows.map(async (r: any) => {
    const configured = r.gross !== null && r.gross !== undefined;
    return {
      job_title_id: r.job_title_id,
      designation: r.designation,
      configured,
      employee_count: countMap.get(r.job_title_id) ?? 0,
      structure: configured ? structureFields(r) : null,
      breakdown: configured ? await breakdownForStructure(r) : null,
    };
  }));
}

function structureFields(r: any) {
  return {
    gross: num(r.gross),
    city: r.city ?? 'Haryana',
    pct_basic: num(r.pct_basic),
    pct_hra: num(r.pct_hra),
    pct_employee_pf: num(r.pct_employee_pf),
    pct_esi: num(r.pct_esi),
    pct_employer_pf: num(r.pct_employer_pf),
    pct_gratuity: num(r.pct_gratuity),
    pct_employer_esi: num(r.pct_employer_esi),
    pli: num(r.pli),
    lwf_employee: r.lwf_employee === null || r.lwf_employee === undefined ? null : num(r.lwf_employee),
    lwf_employer: r.lwf_employer === null || r.lwf_employer === undefined ? null : num(r.lwf_employer),
    meal: num(r.meal),
    accommodation: num(r.accommodation),
    accommodation_allowance: num(r.accommodation_allowance),
  };
}

export async function getStructureRow(jobTitleId: number) {
  return db(TABLE).where('job_title_id', jobTitleId).first();
}

export async function getStructure(jobTitleId: number) {
  const jt = await db('job_titles').where('id', jobTitleId).first();
  if (!jt) throw new NotFoundError('Designation');
  const row = await getStructureRow(jobTitleId);
  return {
    job_title_id: jobTitleId,
    designation: jt.title,
    configured: !!row,
    structure: row ? structureFields(row) : null,
    breakdown: row ? await breakdownForStructure(row) : null,
  };
}

const EDITABLE = [
  'gross', 'city',
  'pct_basic', 'pct_hra', 'pct_employee_pf', 'pct_esi', 'pct_employer_pf', 'pct_gratuity', 'pct_employer_esi',
  'pli', 'lwf_employee', 'lwf_employer', 'meal', 'accommodation', 'accommodation_allowance',
];

export async function upsertStructure(jobTitleId: number, data: any) {
  const jt = await db('job_titles').where('id', jobTitleId).first();
  if (!jt) throw new NotFoundError('Designation');
  if (data.gross === undefined && !(await getStructureRow(jobTitleId))) {
    throw new ValidationError('Gross salary is required');
  }

  const payload: any = {};
  for (const key of EDITABLE) {
    if (data[key] !== undefined) {
      payload[key] = (key === 'city')
        ? data[key]
        : (data[key] === null || data[key] === '' ? (key.startsWith('lwf_') ? null : 0) : Number(data[key]));
    }
  }

  const existing = await getStructureRow(jobTitleId);
  if (existing) {
    await db(TABLE).where('job_title_id', jobTitleId).update({ ...payload, updated_at: db.fn.now() });
  } else {
    await db(TABLE).insert({ job_title_id: jobTitleId, ...payload });
  }
  return getStructure(jobTitleId);
}
