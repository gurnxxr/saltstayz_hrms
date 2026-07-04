import fs from 'fs';
import path from 'path';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { notifyEmployee, notifyRole } from './notification.service';
import { getStructureByJobTitle, computeForStructure, getCtcRange } from './salaryStructure.service';
import { generateOfferLetterPdf } from './offerLetterPdf.service';
import { createEmployeeFromCandidate } from './recruitment.service';
import { getBandForEmployee } from './manpower.service';

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'onboarding');

const DEFAULT_CHECKLIST_ITEMS = [
  'Personal documents submitted',
  'ID proof verified',
  'Address proof verified',
  'Bank account details submitted',
  'PAN card copy submitted',
  'Aadhaar card copy submitted',
  'Photo submitted',
  'Emergency contact details provided',
  'NDA / employment agreement signed',
  'IT equipment issued',
  'Email / system access created',
  'Property tour completed',
  'Team introduction done',
  'HR policy handbook acknowledged',
];

// ─── Checklists ───

export async function listChecklists(filters: { status?: string; search?: string }) {
  const query = db('onboarding_checklists')
    .join('employees', 'employees.id', 'onboarding_checklists.employee_id')
    .select(
      'onboarding_checklists.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'employees.date_of_joining',
      'employees.branch_name',
      'employees.dept_name'
    )
    .orderBy('onboarding_checklists.created_at', 'desc');

  if (filters.status) query.where('onboarding_checklists.status', filters.status);
  if (filters.search) {
    query.where(function () {
      this.where('employees.first_name', 'like', `%${filters.search}%`)
        .orWhere('employees.last_name', 'like', `%${filters.search}%`)
        .orWhere('employees.employee_code', 'like', `%${filters.search}%`);
    });
  }

  const checklists = await query;

  for (const cl of checklists) {
    const items = await db('onboarding_items').where('checklist_id', cl.id);
    cl.total_items = items.length;
    cl.completed_items = items.filter((i: any) => i.is_completed).length;
  }

  return checklists;
}

export async function getChecklist(id: number) {
  const checklist = await db('onboarding_checklists')
    .join('employees', 'employees.id', 'onboarding_checklists.employee_id')
    .leftJoin('job_titles', 'job_titles.id', 'employees.job_title_id')
    .where('onboarding_checklists.id', id)
    .select(
      'onboarding_checklists.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'employees.email',
      'employees.phone',
      'employees.date_of_joining',
      'employees.branch_name',
      'employees.dept_name',
      'job_titles.title as job_title'
    )
    .first();

  if (!checklist) throw new NotFoundError('Onboarding checklist');

  checklist.items = await db('onboarding_items')
    .leftJoin('users', 'users.id', 'onboarding_items.verified_by')
    .where('checklist_id', id)
    .select('onboarding_items.*', 'users.email as verified_by_email')
    .orderBy('onboarding_items.id');

  return checklist;
}

export async function createChecklist(employeeId: number) {
  const existing = await db('onboarding_checklists').where('employee_id', employeeId).first();
  if (existing) throw new Error('Onboarding checklist already exists for this employee');

  const [id] = await db('onboarding_checklists').insert({ employee_id: employeeId });

  for (const itemName of DEFAULT_CHECKLIST_ITEMS) {
    await db('onboarding_items').insert({ checklist_id: id, item_name: itemName });
  }

  await notifyEmployee(employeeId, {
    type: 'onboarding_assigned',
    title: 'Onboarding started',
    message: 'Your onboarding checklist has been created. Please complete the pending items.',
    link: '/onboarding',
  });

  return getChecklist(id);
}

export async function addChecklistItem(checklistId: number, itemName: string) {
  const checklist = await db('onboarding_checklists').where('id', checklistId).first();
  if (!checklist) throw new NotFoundError('Onboarding checklist');

  const [id] = await db('onboarding_items').insert({ checklist_id: checklistId, item_name: itemName });
  return db('onboarding_items').where('id', id).first();
}

export async function toggleItem(itemId: number, userId: number) {
  const item = await db('onboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');

  const isCompleted = !item.is_completed;
  await db('onboarding_items').where('id', itemId).update({
    is_completed: isCompleted,
    completed_at: isCompleted ? db.fn.now() : null,
    verified_by: isCompleted ? userId : null,
    updated_at: db.fn.now(),
  });

  const checklistId = item.checklist_id;
  const allItems = await db('onboarding_items').where('checklist_id', checklistId);
  const allComplete = allItems.every((i: any) => i.id === itemId ? isCompleted : i.is_completed);

  await db('onboarding_checklists').where('id', checklistId).update({
    status: allComplete ? 'completed' : 'in_progress',
    updated_at: db.fn.now(),
  });

  return db('onboarding_items').where('id', itemId).first();
}

export async function deleteItem(itemId: number) {
  const item = await db('onboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  await db('onboarding_items').where('id', itemId).delete();
}

export async function updateChecklistStatus(id: number, status: string) {
  await db('onboarding_checklists').where('id', id).update({ status, updated_at: db.fn.now() });
  return getChecklist(id);
}

// ─── Offer Letters ───

export async function listOfferLetters() {
  return db('offer_letters')
    .join('employees', 'employees.id', 'offer_letters.employee_id')
    .join('users', 'users.id', 'offer_letters.generated_by')
    .select(
      'offer_letters.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'users.email as generated_by_email'
    )
    .orderBy('offer_letters.created_at', 'desc');
}

export async function createOfferLetter(employeeId: number, templateData: any, generatedBy: number) {
  const [id] = await db('offer_letters').insert({
    employee_id: employeeId,
    template_data: JSON.stringify(templateData),
    generated_by: generatedBy,
  });

  await notifyEmployee(employeeId, {
    type: 'offer_letter',
    title: 'Offer letter generated',
    message: `An offer letter${templateData?.designation ? ` for ${templateData.designation}` : ''} has been generated for you.`,
    link: '/onboarding',
  });

  return db('offer_letters')
    .join('employees', 'employees.id', 'offer_letters.employee_id')
    .where('offer_letters.id', id)
    .select('offer_letters.*', 'employees.first_name', 'employees.last_name')
    .first();
}

export async function getOfferLetter(id: number) {
  const letter = await db('offer_letters')
    .join('employees', 'employees.id', 'offer_letters.employee_id')
    .join('users', 'users.id', 'offer_letters.generated_by')
    .where('offer_letters.id', id)
    .select(
      'offer_letters.*',
      'employees.first_name',
      'employees.last_name',
      'employees.employee_code',
      'employees.email',
      'employees.job_title_id',
      'users.email as generated_by_email'
    )
    .first();

  if (!letter) throw new NotFoundError('Offer letter');
  if (letter.template_data && typeof letter.template_data === 'string') {
    letter.template_data = JSON.parse(letter.template_data);
  }
  return letter;
}

export async function getOnboardingStats() {
  const total = await db('onboarding_checklists').count('* as count').first();
  const pending = await db('onboarding_checklists').where('status', 'pending').count('* as count').first();
  const inProgress = await db('onboarding_checklists').where('status', 'in_progress').count('* as count').first();
  const completed = await db('onboarding_checklists').where('status', 'completed').count('* as count').first();
  const offerLetters = await db('offer_letters').count('* as count').first();
  const offersPending = await db('candidates').where('offer_status', 'pending').count('* as count').first();
  const offersSent = await db('candidates').where('offer_status', 'sent').count('* as count').first();

  return {
    total: total?.count ?? 0,
    pending: pending?.count ?? 0,
    inProgress: inProgress?.count ?? 0,
    completed: completed?.count ?? 0,
    offerLetters: offerLetters?.count ?? 0,
    offersPending: offersPending?.count ?? 0,
    offersSent: offersSent?.count ?? 0,
  };
}

// ─── Offer flow (candidate-centric until acceptance) ───

const inrAmount = (n: number) => Math.round(n).toLocaleString('en-IN');

/** Candidates that are in the offer pipeline (offer_status set), with vacancy context. */
export async function listOfferCandidates() {
  const rows = await db('candidates as c')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .join('job_titles as jt', 'jt.id', 'v.job_title_id')
    .join('departments as d', 'd.id', 'v.department_id')
    .join('properties as p', 'p.id', 'v.property_id')
    .whereNotNull('c.offer_status')
    .select(
      'c.id', 'c.name', 'c.email', 'c.phone', 'c.offer_status', 'c.offer_generated_at',
      'c.offer_responded_at', 'c.employee_id', 'c.vacancy_id',
      'v.job_title_id', 'jt.title as designation',
      'd.name as department_name', 'p.name as property_name'
    )
    .orderBy('c.updated_at', 'desc');

  return Promise.all(rows.map(async (r: any) => {
    const range = await getCtcRange(r.job_title_id);
    return { ...r, ctc_label: range.label, ctc_configured: range.configured };
  }));
}

async function getOfferCandidate(candidateId: number) {
  const c = await db('candidates as c')
    .join('vacancies as v', 'v.id', 'c.vacancy_id')
    .where('c.id', candidateId)
    .select('c.*', 'v.job_title_id')
    .first();
  if (!c) throw new NotFoundError('Candidate');
  if (c.offer_data && typeof c.offer_data === 'string') {
    try { c.offer_data = JSON.parse(c.offer_data); } catch { c.offer_data = null; }
  }
  return c;
}

/** Generates (or regenerates) the offer for a candidate, snapshotting designation + CTC. */
export async function generateCandidateOffer(
  candidateId: number,
  input: { joining_date?: string },
  userId: number
) {
  const c = await getOfferCandidate(candidateId);
  if (c.offer_status === 'accepted') throw new ValidationError('This offer has already been accepted.');

  const range = await getCtcRange(c.job_title_id);
  if (!range.configured) {
    throw new ValidationError('This designation has no salary structure. Set it up in Admin → Salary Structure before generating an offer.');
  }
  const jt = await db('job_titles').where('id', c.job_title_id).first();

  const offerData = {
    designation: jt?.title || 'Position',
    annual_ctc: range.annual_low,           // structure CTC × 12
    joining_date: input.joining_date || null,
  };

  await db('candidates').where('id', candidateId).update({
    offer_status: 'sent',
    offer_data: JSON.stringify(offerData),
    offer_generated_at: db.fn.now(),
    offer_generated_by: userId,
    updated_at: db.fn.now(),
  });

  return { ...offerData, offer_status: 'sent' };
}

/** Builds the offer-letter PDF for a candidate from the snapshot + live salary structure. */
export async function downloadCandidateOfferPdf(candidateId: number) {
  const c = await getOfferCandidate(candidateId);
  if (!c.offer_data) throw new ValidationError('Generate the offer letter first.');

  const struct = await getStructureByJobTitle(c.job_title_id);
  const salaryBreakdown = struct ? await computeForStructure(struct, Number(struct.default_base) || 0) : undefined;

  const joiningDate = c.offer_data.joining_date
    ? new Date(c.offer_data.joining_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  const generatedDate = c.offer_generated_at
    ? new Date(c.offer_generated_at).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const buffer = await generateOfferLetterPdf({
    candidateName: c.name,
    designation: c.offer_data.designation || '—',
    salary: inrAmount(Number(c.offer_data.annual_ctc) || 0),
    joiningDate,
    employeeCode: c.employee_id ? `NH-${String(c.id).padStart(4, '0')}` : 'To be assigned',
    generatedBy: '',
    generatedDate,
    salaryBreakdown,
  });
  return { buffer, candidateName: c.name };
}

/**
 * HR marks the offer accepted → the employee record is created (the first time a
 * record exists for this person), the document-collection checklist is seeded, an
 * offer_letters record is filed, and the vacancy slot is filled — all atomically.
 */
export async function acceptCandidateOffer(candidateId: number, userId: number) {
  const c = await getOfferCandidate(candidateId);
  if (c.offer_status === 'accepted') throw new ValidationError('This offer has already been accepted.');
  if (c.offer_status !== 'sent') throw new ValidationError('Generate the offer letter before accepting.');
  if (!c.offer_data) throw new ValidationError('Generate the offer letter first.');

  const employeeId = await db.transaction(async (trx) => {
    const empId = await createEmployeeFromCandidate(c, c.offer_data.joining_date || undefined, trx);

    await trx('candidates').where('id', candidateId).update({
      employee_id: empId,
      offer_status: 'accepted',
      offer_responded_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    // Document-collection checklist begins now (post-acceptance). The offer letter
    // is NOT filed here — it is generated from the Offer Letter tab only once the
    // checklist is complete (see generateOfferLetterForEmployee).
    const [checklistId] = await trx('onboarding_checklists').insert({ employee_id: empId });
    for (const itemName of DEFAULT_CHECKLIST_ITEMS) {
      await trx('onboarding_items').insert({ checklist_id: checklistId, item_name: itemName });
    }

    // Fill the vacancy; close it once all positions are taken.
    await trx('vacancies').where('id', c.vacancy_id).increment('filled', 1);
    const vac = await trx('vacancies').where('id', c.vacancy_id).first();
    if (vac && vac.filled >= vac.positions) {
      await trx('vacancies').where('id', c.vacancy_id).update({ status: 'closed' });
    }

    return empId;
  });

  await notifyRole('hr', {
    type: 'onboarding_assigned',
    title: 'Offer accepted',
    message: `${c.name} accepted their offer. Document collection has started.`,
    link: '/onboarding',
  });

  return { employee_id: employeeId };
}

/** HR marks the offer declined → no employee, no vacancy fill; candidate is archived. */
export async function declineCandidateOffer(candidateId: number, userId: number) {
  const c = await getOfferCandidate(candidateId);
  if (c.offer_status === 'accepted') throw new ValidationError('This offer has already been accepted.');

  await db('candidates').where('id', candidateId).update({
    offer_status: 'declined',
    offer_responded_at: db.fn.now(),
    stage: 'rejected',
    archived: true,
    updated_at: db.fn.now(),
  });
  await db('candidate_history').insert({
    candidate_id: candidateId,
    from_stage: c.stage,
    to_stage: 'rejected',
    notes: 'Offer declined',
    changed_by: userId,
  });
  return { offer_status: 'declined' };
}

// ─── Per-item document upload ───

function sanitizeName(name: string) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function recomputeChecklistStatus(checklistId: number) {
  const items = await db('onboarding_items').where('checklist_id', checklistId);
  const allComplete = items.length > 0 && items.every((i: any) => i.is_completed);
  const anyComplete = items.some((i: any) => i.is_completed);
  await db('onboarding_checklists').where('id', checklistId).update({
    status: allComplete ? 'completed' : anyComplete ? 'in_progress' : 'pending',
    updated_at: db.fn.now(),
  });
}

/** Stores an uploaded document for a checklist item and marks the item collected. */
export async function uploadItemDocument(itemId: number, file: { originalname: string; buffer: Buffer }, userId: number) {
  const item = await db('onboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  if (!file) throw new ValidationError('No file uploaded');

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = `${itemId}_${Date.now()}_${sanitizeName(file.originalname)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.buffer);

  // Best-effort: remove a previously stored file for this item.
  if (item.document_url) {
    const prev = path.join(UPLOAD_DIR, path.basename(item.document_url));
    try { fs.unlinkSync(prev); } catch { /* ignore */ }
  }

  await db('onboarding_items').where('id', itemId).update({
    document_url: `uploads/onboarding/${stored}`,
    document_name: file.originalname.slice(0, 255),
    is_completed: true,
    completed_at: db.fn.now(),
    verified_by: userId,
    updated_at: db.fn.now(),
  });
  await recomputeChecklistStatus(item.checklist_id);
  return db('onboarding_items').where('id', itemId).first();
}

/** Returns the absolute path + display name for an item's stored document. */
export async function getItemDocument(itemId: number) {
  const item = await db('onboarding_items').where('id', itemId).first();
  if (!item || !item.document_url) throw new NotFoundError('Document');
  return {
    absPath: path.join(UPLOAD_DIR, path.basename(item.document_url)),
    name: item.document_name || path.basename(item.document_url),
  };
}

/** Removes an item's document and reverts the item to not-collected. */
export async function removeItemDocument(itemId: number) {
  const item = await db('onboarding_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  if (item.document_url) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(item.document_url))); } catch { /* ignore */ }
  }
  await db('onboarding_items').where('id', itemId).update({
    document_url: null,
    document_name: null,
    is_completed: false,
    completed_at: null,
    verified_by: null,
    updated_at: db.fn.now(),
  });
  await recomputeChecklistStatus(item.checklist_id);
  return db('onboarding_items').where('id', itemId).first();
}

// ─── Offer letter issued after onboarding completes ───

/** Employees whose document checklist is complete but who have no offer letter yet. */
export async function listOfferReadyEmployees() {
  const rows = await db('onboarding_checklists as cl')
    .join('employees as e', 'e.id', 'cl.employee_id')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .leftJoin('offer_letters as ol', 'ol.employee_id', 'e.id')
    .where('cl.status', 'completed')
    .whereNull('ol.id')
    .select(
      'e.id as employee_id', 'e.first_name', 'e.last_name', 'e.employee_code',
      'e.dept_name', 'e.branch_name', 'e.job_title_id',
      'jt.title as designation', 'cl.updated_at as completed_at'
    )
    .orderBy('cl.updated_at', 'desc');

  return Promise.all(rows.map(async (r: any) => {
    const range = await getCtcRange(r.job_title_id);
    return { ...r, ctc_label: range.label, ctc_configured: range.configured };
  }));
}

/** Recompute the full breakdown for a designation at an (optionally adjusted) monthly gross. */
async function offerBreakdownFor(jobTitleId: number, baseGross?: number) {
  const struct = await getStructureByJobTitle(jobTitleId);
  if (!struct) return null;
  const structGross = Math.round(Number(struct.default_base) || 0);
  const gross = baseGross != null && baseGross > 0 ? Math.round(baseGross) : structGross;
  const breakdown = await computeForStructure(struct, gross);
  return { structGross, gross, breakdown, annual_ctc: Math.round(breakdown.ctc) * 12 };
}

/** Live offer preview for the editor: breakdown for an employee's designation at a base. */
export async function getEmployeeOfferBreakdown(employeeId: number, baseGross?: number) {
  const emp = await db('employees').where('id', employeeId).select('job_title_id').first();
  if (!emp) throw new NotFoundError('Employee');
  if (!emp.job_title_id) return null;
  return offerBreakdownFor(emp.job_title_id, baseGross);
}

/** Editor prefill: designation, joining date, structure base + calc inputs for live recompute. */
export async function getOfferDefaults(employeeId: number) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.id', employeeId)
    .select('e.id', 'e.first_name', 'e.last_name', 'e.employee_code', 'e.job_title_id', 'e.date_of_joining', 'jt.title as designation')
    .first();
  if (!emp) throw new NotFoundError('Employee');
  const struct = emp.job_title_id ? await getStructureByJobTitle(emp.job_title_id) : null;
  const range = await getCtcRange(emp.job_title_id);
  const issued = await db('offer_letters').where('employee_id', employeeId).first();
  const band = await getBandForEmployee(employeeId);
  return {
    employee_id: emp.id,
    name: `${emp.first_name} ${emp.last_name}`,
    employee_code: emp.employee_code,
    designation: emp.designation || 'Position',
    joining_date: emp.date_of_joining || null,
    configured: !!struct,
    base_gross: struct ? Math.round(Number(struct.default_base) || 0) : 0,
    ctc_label: range.label,
    already_issued: !!issued,
    // Sanctioned monthly-CTC band cap (null when no band is configured for this role/property).
    band_max: band.configured ? band.band_max : null,
  };
}

/** Renders the offer-letter PDF for an employee at an adjusted base — no save (preview). */
export async function previewOfferLetterForEmployee(
  employeeId: number,
  input: { base_gross?: number; designation?: string; joining_date?: string }
) {
  const emp = await db('employees as e')
    .leftJoin('job_titles as jt', 'jt.id', 'e.job_title_id')
    .where('e.id', employeeId)
    .select('e.first_name', 'e.last_name', 'e.employee_code', 'e.job_title_id', 'e.date_of_joining', 'jt.title as designation')
    .first();
  if (!emp) throw new NotFoundError('Employee');
  const ob = await offerBreakdownFor(emp.job_title_id, input.base_gross);
  if (!ob) throw new ValidationError('This designation has no salary structure.');
  const joining = input.joining_date || emp.date_of_joining;
  const joiningDate = joining
    ? new Date(joining).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';
  return generateOfferLetterPdf({
    candidateName: `${emp.first_name} ${emp.last_name}`,
    designation: input.designation || emp.designation || 'Position',
    salary: inrAmount(ob.annual_ctc),
    joiningDate,
    employeeCode: emp.employee_code || '—',
    generatedBy: '',
    generatedDate: new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
    salaryBreakdown: ob.breakdown,
  });
}

/**
 * Issues (files) the offer letter for an onboarding-complete employee, at an
 * optionally adjusted monthly base. Records the final offered salary on the
 * employee record (NOT salary_setup / payroll), and snapshots the breakdown.
 */
export async function generateOfferLetterForEmployee(
  employeeId: number,
  userId: number,
  opts: { base_gross?: number; designation?: string; joining_date?: string } = {}
) {
  const emp = await db('employees').where('id', employeeId).first();
  if (!emp) throw new NotFoundError('Employee');

  const existing = await db('offer_letters').where('employee_id', employeeId).first();
  if (existing) throw new ValidationError('An offer letter has already been generated for this employee.');

  const ob = await offerBreakdownFor(emp.job_title_id, opts.base_gross);
  if (!ob) {
    throw new ValidationError('This designation has no salary structure. Set it up in Admin → Salary Structure before generating the offer letter.');
  }

  // Manpower & Budget Control: the offered salary can't exceed the sanctioned band.
  const band = await getBandForEmployee(employeeId);
  if (band.configured && ob.breakdown.ctc > band.band_max) {
    const inr = (n: number) => Math.round(n).toLocaleString('en-IN');
    throw new ValidationError(
      `Offered monthly CTC ₹${inr(ob.breakdown.ctc)} exceeds the sanctioned salary band maximum ₹${inr(band.band_max)} for this role at the property. ` +
      `Lower the base salary or raise the band in Admin → Budget Control.`
    );
  }

  const jt = await db('job_titles').where('id', emp.job_title_id).first();
  const pct = ob.structGross > 0 ? Math.round((ob.gross / ob.structGross - 1) * 10000) / 100 : 0;

  // Record the final offered salary on the employee — independent of the
  // designation structure and of salary_setup (payroll is untouched).
  await db('employees').where('id', employeeId).update({
    offered_base: ob.gross,
    offered_ctc: ob.annual_ctc,
    offer_adjustment_pct: pct,
    updated_at: db.fn.now(),
  });

  return createOfferLetter(employeeId, {
    designation: opts.designation || jt?.title || 'Position',
    salary: inrAmount(ob.annual_ctc),
    joining_date: opts.joining_date || emp.date_of_joining || null,
    base_gross: ob.gross,
    adjustment_pct: pct,
    breakdown: ob.breakdown,
  }, userId);
}
