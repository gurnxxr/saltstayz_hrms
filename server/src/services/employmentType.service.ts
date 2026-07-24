import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { buildCsv, parseCsv } from '../utils/csv';

// ─────────────────────────────────────────────────────────────────────────────
// Employment Types master (Admin config). A catalogue of employment types with
// their HR variables. Catalog-only: not yet attached to employees or payroll.
// Restrictions are a self-referential many-to-many held in employment_type_restrictions.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v: any): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
const intOrNull = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};
const toBool = (v: any): boolean => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return ['y', 'yes', 'true', '1'].includes(s);
};

export interface EmploymentTypeInput {
  name: string;
  is_confirmed: boolean;
  prefix: string | null;
  probation_period_months: number | null;
  notice_period_days: number;
  is_active: boolean;
  restricted_type_ids: number[];
}

/** One row hydrated with its restriction ids + names. */
async function hydrate(rows: any[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const links = await db('employment_type_restrictions as r')
    .join('employment_types as t', 't.id', 'r.restricted_type_id')
    .whereIn('r.employment_type_id', ids)
    .select('r.employment_type_id', 'r.restricted_type_id', 't.name as restricted_name');
  const byType = new Map<number, Array<{ id: number; name: string }>>();
  for (const l of links) {
    const arr = byType.get(l.employment_type_id) ?? [];
    arr.push({ id: l.restricted_type_id, name: l.restricted_name });
    byType.set(l.employment_type_id, arr);
  }
  return rows.map((r) => {
    const restr = (byType.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    return {
      ...r,
      is_confirmed: !!r.is_confirmed,
      is_active: !!r.is_active,
      restricted_type_ids: restr.map((x) => x.id),
      restricted_type_names: restr.map((x) => x.name),
    };
  });
}

export async function listEmploymentTypes() {
  const rows = await db('employment_types').orderBy('name');
  return hydrate(rows);
}

export async function getEmploymentType(id: number) {
  const row = await db('employment_types').where('id', id).first();
  if (!row) throw new NotFoundError('Employment type');
  return (await hydrate([row]))[0];
}

// Sane bounds so bad input surfaces as a clean 400, not a raw Postgres error (name maps
// to varchar(60); the periods to int4). Commas are barred in names because the CSV
// restriction column is comma-separated — a comma in a name would corrupt the round-trip.
const NAME_MAX = 60;
const PROBATION_MAX = 240; // months
const NOTICE_MAX = 3650;   // days

function assertScalarsValid(name: string, probation: number | null, notice: number) {
  if (name.length > NAME_MAX) throw new ValidationError(`Name is too long (max ${NAME_MAX} characters)`);
  if (name.includes(',')) throw new ValidationError('Name cannot contain a comma');
  if (notice < 0) throw new ValidationError('Notice period cannot be negative');
  if (notice > NOTICE_MAX) throw new ValidationError(`Notice period looks too large (max ${NOTICE_MAX} days)`);
  if (probation !== null && probation < 0) throw new ValidationError('Probation period cannot be negative');
  if (probation !== null && probation > PROBATION_MAX) throw new ValidationError(`Probation period looks too large (max ${PROBATION_MAX} months)`);
}

/** Translate a Postgres unique-violation into the friendly duplicate-name error. */
function rethrowDuplicate(e: any): never {
  if (e && e.code === '23505') throw new ValidationError('An employment type with this name already exists');
  throw e;
}

/** Validates + normalises a create/update payload. `excludeId` skips self on rename. */
async function validate(data: any, excludeId?: number): Promise<EmploymentTypeInput> {
  const name = String(data.name ?? '').trim();
  if (!name) throw new ValidationError('Employment type name is required');
  const dup = db('employment_types').whereRaw('lower(name) = lower(?)', [name]);
  if (excludeId) dup.whereNot('id', excludeId);
  if (await dup.first()) throw new ValidationError('An employment type with this name already exists');

  const notice = intOrNull(data.notice_period_days) ?? 0;
  const probation = intOrNull(data.probation_period_months);
  assertScalarsValid(name, probation, notice);

  // Restrictions: accept ids; a type cannot restrict itself; every id must exist.
  let restricted_type_ids: number[] = Array.isArray(data.restricted_type_ids)
    ? [...new Set<number>(data.restricted_type_ids.map((x: any) => Number(x)).filter((n: number) => !!n))]
    : [];
  if (excludeId) restricted_type_ids = restricted_type_ids.filter((rid) => rid !== excludeId);
  if (restricted_type_ids.length) {
    const found = await db('employment_types').whereIn('id', restricted_type_ids).pluck('id');
    if (found.length !== restricted_type_ids.length) {
      throw new ValidationError('A restricted employment type no longer exists');
    }
  }

  return {
    name,
    is_confirmed: toBool(data.is_confirmed),
    prefix: data.prefix ? String(data.prefix).trim().slice(0, 10) : null,
    probation_period_months: probation,
    notice_period_days: notice,
    is_active: data.is_active === undefined ? true : !!data.is_active,
    restricted_type_ids,
  };
}

async function writeRestrictions(trx: Knex.Transaction | typeof db, typeId: number, restrictedIds: number[]) {
  await trx('employment_type_restrictions').where('employment_type_id', typeId).del();
  if (restrictedIds.length) {
    await trx('employment_type_restrictions').insert(
      restrictedIds.map((rid) => ({ employment_type_id: typeId, restricted_type_id: rid })),
    );
  }
}

export async function createEmploymentType(data: any) {
  const input = await validate(data);
  try {
    const id = await db.transaction(async (trx) => {
      const [{ id: newId }] = await trx('employment_types').insert({
        name: input.name, is_confirmed: input.is_confirmed, prefix: input.prefix,
        probation_period_months: input.probation_period_months, notice_period_days: input.notice_period_days,
        is_active: input.is_active,
      }).returning('id');
      await writeRestrictions(trx, newId, input.restricted_type_ids);
      return newId;
    });
    return getEmploymentType(id);
  } catch (e) {
    // Belt-and-suspenders for the check-then-insert race: the DB unique index (on lower(name))
    // is the real guard; here we just turn its 23505 into the friendly 400.
    rethrowDuplicate(e);
  }
}

export async function updateEmploymentType(id: number, data: any) {
  const existing = await db('employment_types').where('id', id).first();
  if (!existing) throw new NotFoundError('Employment type');
  const input = await validate(data, id);
  try {
    await db.transaction(async (trx) => {
      await trx('employment_types').where('id', id).update({
        name: input.name, is_confirmed: input.is_confirmed, prefix: input.prefix,
        probation_period_months: input.probation_period_months, notice_period_days: input.notice_period_days,
        is_active: input.is_active, updated_at: trx.fn.now(),
      });
      await writeRestrictions(trx, id, input.restricted_type_ids);
    });
  } catch (e) {
    rethrowDuplicate(e);
  }
  return getEmploymentType(id);
}

export async function deleteEmploymentType(id: number) {
  const existing = await db('employment_types').where('id', id).first();
  if (!existing) throw new NotFoundError('Employment type');
  // Restriction links (both directions) cascade via FK; the row itself is removed here.
  await db('employment_types').where('id', id).del();
  return { id };
}

// ─── CSV export / import ───

const CSV_HEADER = ['Employment Type', 'Is Confirmed', 'Prefix', 'Restriction for Employment Type', 'Probation Period (In Months)', 'Notice Period (In Days)'];

export async function exportEmploymentTypesCsv(): Promise<string> {
  const types = await listEmploymentTypes();
  const rows = types.map((t: any) => [
    t.name,
    t.is_confirmed ? 'Y' : 'N',
    t.prefix ?? '',
    (t.restricted_type_names ?? []).join(', '),
    t.probation_period_months ?? '',
    t.notice_period_days ?? 0,
  ]);
  return buildCsv(CSV_HEADER, rows);
}

// CSV header cell (normalised: lowercased, alphanumerics only) → canonical field.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const HEADER_ALIASES: Record<string, string> = {
  employmenttype: 'name', name: 'name', type: 'name',
  isconfirmed: 'is_confirmed', confirmed: 'is_confirmed',
  prefix: 'prefix', code: 'prefix',
  restrictionforemploymenttype: 'restrictions', restriction: 'restrictions', restrictions: 'restrictions', restrictedtypes: 'restrictions',
  probationperiodinmonths: 'probation', probationperiod: 'probation', probation: 'probation', probationmonths: 'probation',
  noticeperiodindays: 'notice', noticeperiod: 'notice', notice: 'notice', noticedays: 'notice',
};

/**
 * Import employment types from a CSV shaped like the Employment Type master export.
 * Upserts by name (case-insensitive). Two passes: first every type is created/updated so
 * a Restriction that names a type further down the file still resolves; then the
 * restriction links are wired. A row with no name is skipped with an error.
 */
export async function importEmploymentTypesCsv(csvContent: string) {
  const rows = parseCsv(csvContent);
  if (rows.length < 2) throw new ValidationError('The CSV has no data rows');

  const header = rows[0].map((h) => HEADER_ALIASES[norm(h)]);
  if (!header.includes('name')) throw new ValidationError('The CSV needs an "Employment Type" column');
  // Only the columns actually present may be written. An OMITTED column must never reset
  // a field on a matched existing type — a partial CSV updates only what it carries.
  const present = new Set(header.filter(Boolean));

  const errors: string[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Restriction names to wire in pass two, keyed by lower(name). A type only appears here
  // when the CSV actually carries a Restriction column, so an omitted column leaves
  // existing links alone while a present-but-blank cell clears them (empty array).
  const restrictionsByName = new Map<string, string[]>();

  // Pass 1 — upsert the scalar fields, column-aware.
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const rec: Record<string, string> = {};
    header.forEach((field, idx) => { if (field) rec[field] = cells[idx] ?? ''; });

    const name = (rec.name ?? '').trim();
    if (!name) { skipped++; errors.push(`Row ${i + 1}: missing Employment Type — skipped`); continue; }

    // Parse only the columns the CSV carries; `undefined` means "column absent → don't touch".
    const probation = present.has('probation') ? intOrNull(rec.probation) : undefined;
    const notice = present.has('notice') ? (intOrNull(rec.notice) ?? 0) : undefined;
    try {
      // Same value rules the interactive create/update enforce — the import must not bypass them.
      assertScalarsValid(name, probation ?? null, notice ?? 0);
    } catch (e: any) {
      skipped++; errors.push(`Row ${i + 1} (${name}): ${e.message}`); continue;
    }

    if (present.has('restrictions')) {
      restrictionsByName.set(name.toLowerCase(),
        rec.restrictions ? rec.restrictions.split(',').map((s) => s.trim()).filter(Boolean) : []);
    }

    const patch: Record<string, any> = {};
    if (present.has('is_confirmed')) patch.is_confirmed = toBool(rec.is_confirmed);
    if (present.has('prefix')) patch.prefix = rec.prefix ? rec.prefix.trim().slice(0, 10) : null;
    if (probation !== undefined) patch.probation_period_months = probation;
    if (notice !== undefined) patch.notice_period_days = notice;

    try {
      const existing = await db('employment_types').whereRaw('lower(name) = lower(?)', [name]).first();
      if (existing) {
        await db('employment_types').where('id', existing.id).update({ ...patch, updated_at: db.fn.now() });
        updated++;
      } else {
        // A brand-new row takes column defaults for anything the CSV omitted.
        await db('employment_types').insert({ name, ...patch });
        created++;
      }
    } catch (e: any) {
      skipped++; errors.push(`Row ${i + 1} (${name}): ${e.message || 'could not be saved'}`);
    }
  }

  // Pass 2 — wire restrictions now that every referenced type exists. Per-type try/catch so
  // one bad type doesn't abort the whole pass or lose the summary.
  const all = await db('employment_types').select('id', 'name');
  const idByLowerName = new Map<string, number>(all.map((t: any) => [t.name.toLowerCase(), t.id]));
  for (const [lowerName, restrictNames] of restrictionsByName) {
    const typeId = idByLowerName.get(lowerName);
    if (!typeId) continue;
    try {
      const restrictedIds: number[] = [];
      for (const rn of restrictNames) {
        const rid = idByLowerName.get(rn.toLowerCase());
        if (rid && rid !== typeId) restrictedIds.push(rid);
        else if (!rid) errors.push(`${all.find((t: any) => t.id === typeId)?.name}: restriction "${rn}" is not a known employment type`);
      }
      await writeRestrictions(db, typeId, [...new Set(restrictedIds)]);
    } catch (e: any) {
      errors.push(`${all.find((t: any) => t.id === typeId)?.name}: could not update restrictions (${e.message})`);
    }
  }

  return { total: rows.length - 1, created, updated, skipped, errors };
}
