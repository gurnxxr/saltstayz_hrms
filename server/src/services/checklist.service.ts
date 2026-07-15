import fs from 'fs';
import path from 'path';
import type { Knex } from 'knex';
import db from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';

/**
 * The one checklist. Templates (admin-editable) -> instances (per candidate OR per
 * employee) -> items -> completion (+ optional document).
 *
 * This replaces onboarding's copy. Steps 6 (Document Collection), 9 (Pre-joining
 * Formalities) and 10 (Joining Day) are all instances of this, distinguished only by
 * their template. Completing a phase's checklist is what unlocks the next stage, and
 * that is enforced in recruitment.service via `isComplete` — never in the UI.
 */

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads', 'checklists');

export const TEMPLATE_KEYS = ['document_collection', 'pre_joining', 'joining_day'] as const;
export type TemplateKey = typeof TEMPLATE_KEYS[number];

export type Subject = { candidate_id: number } | { employee_id: number };

function subjectWhere(subject: Subject) {
  return 'candidate_id' in subject
    ? { candidate_id: subject.candidate_id, employee_id: null as number | null }
    : { employee_id: subject.employee_id, candidate_id: null as number | null };
}

function sanitizeName(name: string) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

/**
 * Candidate checklist instances that should track their template live: the candidate
 * is still sitting in the phase this template gates (`checklist_templates.phase` equals
 * `candidates.stage`). A candidate who has already advanced past the phase — or an
 * onboarding employee instance — is NOT open, so their finished checklist stays frozen
 * as a record. Template edits propagate only to these open instances.
 */
async function openCandidateInstanceIds(templateId: number, cx: Knex | Knex.Transaction): Promise<number[]> {
  return cx('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .join('candidates as c', 'c.id', 'ci.candidate_id')
    .where('ci.template_id', templateId)
    .whereNotNull('ci.candidate_id')
    .whereRaw('c.stage = ct.phase')
    .pluck('ci.id');
}

// ─── Templates (admin) ───

export async function listTemplates() {
  const templates = await db('checklist_templates').orderBy('id');
  const items = await db('checklist_template_items').where('is_active', true).orderBy(['template_id', 'sort_order']);
  return templates.map((t: any) => ({
    ...t,
    supports_documents: !!t.supports_documents,
    is_active: !!t.is_active,
    items: items.filter((i: any) => i.template_id === t.id).map((i: any) => ({ ...i, is_active: !!i.is_active })),
  }));
}

export async function addTemplateItem(templateId: number, data: { label: string; category?: string }) {
  const template = await db('checklist_templates').where('id', templateId).first();
  if (!template) throw new NotFoundError('Checklist template');
  const label = String(data.label || '').trim();
  if (!label) throw new ValidationError('Item label is required');
  const category = data.category || 'General';

  return db.transaction(async (trx) => {
    const max = await trx('checklist_template_items').where('template_id', templateId).max({ m: 'sort_order' }).first();
    const sort = Number((max as any)?.m || 0) + 1;
    const [id] = await trx('checklist_template_items').insert({
      template_id: templateId, label, category, sort_order: sort, is_active: true,
    });
    // Live-sync: hand this new item to every candidate still in this checklist's phase,
    // so an in-flight document-collection list stays matched to the template. A newly
    // added, unticked item re-opens the phase — the stage gate re-blocks advancement.
    const openIds = await openCandidateInstanceIds(templateId, trx);
    if (openIds.length) {
      // Plain insert on purpose: the template item id was minted two statements up in
      // this transaction, so no instance row can already reference it — a conflict here
      // would be a real logic bug, and it should roll the transaction back loudly
      // rather than silently skip an instance.
      await trx('checklist_instance_items').insert(openIds.map((instance_id) => ({
        instance_id, template_item_id: id, label, category, sort_order: sort,
      })));
      for (const instanceId of openIds) await recomputeStatus(instanceId, trx);
    }
    return trx('checklist_template_items').where('id', id).first();
  });
}

export async function updateTemplateItem(itemId: number, data: { label?: string; category?: string; is_active?: boolean }) {
  const item = await db('checklist_template_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist template item');
  const patch: any = {};
  if ('label' in data) {
    const label = String(data.label || '').trim();
    if (!label) throw new ValidationError('Item label is required');
    patch.label = label;
  }
  if ('category' in data) patch.category = data.category || 'General';
  if ('is_active' in data) patch.is_active = !!data.is_active;

  return db.transaction(async (trx) => {
    await trx('checklist_template_items').where('id', itemId).update({ ...patch, updated_at: trx.fn.now() });

    const openIds = await openCandidateInstanceIds(item.template_id, trx);
    if (openIds.length) {
      // A rename / re-category flows through to the matching items in still-open
      // checklists so they keep matching the template.
      const relabel: any = {};
      if ('label' in patch) relabel.label = patch.label;
      if ('category' in patch) relabel.category = patch.category;
      if (Object.keys(relabel).length) {
        relabel.updated_at = trx.fn.now();
        await trx('checklist_instance_items')
          .whereIn('instance_id', openIds).where('template_item_id', itemId).update(relabel);
      }
      // Deactivating an item removes it from open checklists where it hasn't been
      // actioned yet (mirrors deleteTemplateItem); actioned copies are kept.
      if (patch.is_active === false) {
        await trx('checklist_instance_items')
          .whereIn('instance_id', openIds).where('template_item_id', itemId)
          .where('is_completed', false).whereNull('document_url').del();
      }
      for (const instanceId of openIds) await recomputeStatus(instanceId, trx);
    }
    return trx('checklist_template_items').where('id', itemId).first();
  });
}

/**
 * Deleting a template item drops it from still-open checklists too, so an in-flight
 * document-collection list keeps matching the template — but only where the candidate
 * hasn't actioned it yet. A copy that's already ticked or has an uploaded document is
 * kept (its `template_item_id` goes null via SET NULL when the template row is deleted),
 * so nothing a hire already worked is lost. Completed / advanced-past checklists are
 * frozen and untouched.
 */
export async function deleteTemplateItem(itemId: number) {
  const item = await db('checklist_template_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist template item');
  return db.transaction(async (trx) => {
    const openIds = await openCandidateInstanceIds(item.template_id, trx);
    // Remove the unworked copies BEFORE deleting the template row — after the delete,
    // SET NULL detaches the surviving (worked) copies and we can no longer match them.
    if (openIds.length) {
      await trx('checklist_instance_items')
        .whereIn('instance_id', openIds).where('template_item_id', itemId)
        .where('is_completed', false).whereNull('document_url').del();
    }
    await trx('checklist_template_items').where('id', itemId).del();
    if (openIds.length) for (const instanceId of openIds) await recomputeStatus(instanceId, trx);
    return { id: itemId };
  });
}

// ─── Instances ───

/** Idempotent: instantiating an existing phase checklist returns the existing one. */
export async function ensureInstance(
  key: TemplateKey, subject: Subject, userId?: number | null, trx?: Knex.Transaction,
) {
  const cx = trx || db;
  const template = await cx('checklist_templates').where('key', key).first();
  if (!template) throw new NotFoundError(`Checklist template "${key}"`);

  const where = subjectWhere(subject);
  const existing = await cx('checklist_instances').where({ template_id: template.id, ...where }).first();
  if (existing) return existing;

  // Two concurrent first-views can both pass the check above; the loser's insert then
  // hits unique(template_id, subject). That must not 500 a read — hand back the
  // winner's row instead.
  let instanceId: number;
  try {
    [instanceId] = await cx('checklist_instances').insert({
      template_id: template.id, ...where, status: 'pending', initiated_by: userId ?? null,
    });
  } catch (err) {
    const winner = await cx('checklist_instances').where({ template_id: template.id, ...where }).first();
    if (winner) return winner;
    throw err;
  }
  const templateItems = await cx('checklist_template_items')
    .where({ template_id: template.id, is_active: true }).orderBy('sort_order');
  if (templateItems.length) {
    // Target-less ignore: if this creator stalls here, a concurrent view can find the
    // instance and reconcile the same items in first — that must no-op, not throw.
    await cx('checklist_instance_items').insert(templateItems.map((ti: any, i: number) => ({
      instance_id: instanceId, template_item_id: ti.id, label: ti.label,
      category: ti.category, sort_order: ti.sort_order ?? i,
    }))).onConflict().ignore();
  }
  return cx('checklist_instances').where('id', instanceId).first();
}

/**
 * Bring one open instance in line with its template's current ACTIVE items: append any
 * template item it's missing and refresh the label/category of the ones it has. This is
 * the read-path catch-up for the eager propagation in the template mutations above — it
 * covers instances created before that propagation existed, so opening a candidate always
 * shows a document list matching the template. It never deletes (removals are handled at
 * edit time) and never touches custom (template_item_id null) items. Idempotent.
 */
export async function reconcileInstanceToTemplate(instanceId: number, trx?: Knex.Transaction) {
  const cx = trx || db;
  const instance = await cx('checklist_instances').where('id', instanceId).first();
  if (!instance) return;
  const templateItems = await cx('checklist_template_items')
    .where({ template_id: instance.template_id, is_active: true }).orderBy('sort_order');
  const instItems = await cx('checklist_instance_items').where('instance_id', instanceId);
  const linked = new Map<number, any>(
    instItems.filter((i: any) => i.template_item_id != null).map((i: any) => [i.template_item_id, i]),
  );

  let changed = false;
  const missing = templateItems.filter((ti: any) => !linked.has(ti.id));
  if (missing.length) {
    // Target-less ON CONFLICT DO NOTHING: this runs on every candidate view, so two
    // concurrent views can't double-insert the same template item (the race loses to
    // uq_cii_instance_template_item). No conflict target on purpose — a named target
    // makes SQLite reject the statement at prepare time when the index doesn't exist
    // yet (code deployed/hot-reloaded before migration 079), 500ing every view.
    await cx('checklist_instance_items').insert(missing.map((ti: any) => ({
      instance_id: instanceId, template_item_id: ti.id, label: ti.label, category: ti.category, sort_order: ti.sort_order,
    }))).onConflict().ignore();
    // A race loser can have every row ignored; only recompute when rows really landed.
    const afterCount = Number(
      ((await cx('checklist_instance_items').where('instance_id', instanceId).count({ c: '*' }).first()) as any)?.c ?? 0,
    );
    if (afterCount > instItems.length) changed = true;
  }
  for (const ti of templateItems) {
    const existing = linked.get(ti.id);
    if (existing && (existing.label !== ti.label || existing.category !== ti.category)) {
      await cx('checklist_instance_items').where('id', existing.id)
        .update({ label: ti.label, category: ti.category, updated_at: cx.fn.now() });
      changed = true;
    }
  }
  if (changed) await recomputeStatus(instanceId, trx);
}

export async function getInstance(instanceId: number) {
  const instance = await db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .where('ci.id', instanceId)
    .select('ci.*', 'ct.key as template_key', 'ct.name as template_name', 'ct.supports_documents')
    .first();
  if (!instance) throw new NotFoundError('Checklist');
  const items = await db('checklist_instance_items as cii')
    .leftJoin('users as u', 'u.id', 'cii.completed_by')
    .where('cii.instance_id', instanceId)
    .select('cii.*', 'u.email as completed_by_email')
    // id tiebreaker: template items and per-instance custom items number independently,
    // so sort_order can tie — without it SQLite's tie order is unspecified and the
    // list can reshuffle between loads.
    .orderBy([{ column: 'cii.sort_order' }, { column: 'cii.id' }]);
  return {
    ...instance,
    supports_documents: !!instance.supports_documents,
    items: items.map((i: any) => ({ ...i, is_completed: !!i.is_completed })),
  };
}

/** Every checklist attached to a subject, newest phase last. */
export async function listForSubject(subject: Subject) {
  const instances = await db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .where(subjectWhere(subject))
    .select('ci.*', 'ct.key as template_key', 'ct.name as template_name', 'ct.supports_documents')
    .orderBy('ci.id');
  if (!instances.length) return [];
  const items = await db('checklist_instance_items')
    .whereIn('instance_id', instances.map((i: any) => i.id))
    .orderBy([{ column: 'sort_order' }, { column: 'id' }]); // stable when sort_order ties
  return instances.map((inst: any) => {
    const own = items.filter((i: any) => i.instance_id === inst.id);
    return {
      ...inst,
      supports_documents: !!inst.supports_documents,
      total_items: own.length,
      completed_items: own.filter((i: any) => i.is_completed).length,
      items: own.map((i: any) => ({ ...i, is_completed: !!i.is_completed })),
    };
  });
}

/**
 * Is a subject's phase checklist finished? An instance that was never created is NOT
 * complete — the stage gate must not pass just because nobody started the checklist.
 */
export async function isComplete(key: TemplateKey, subject: Subject, trx?: Knex.Transaction): Promise<boolean> {
  const cx = trx || db;
  const template = await cx('checklist_templates').where('key', key).first();
  if (!template) return false;
  const instance = await cx('checklist_instances').where({ template_id: template.id, ...subjectWhere(subject) }).first();
  if (!instance) return false;
  const items = await cx('checklist_instance_items').where('instance_id', instance.id).select('is_completed');
  return items.length > 0 && items.every((i: any) => i.is_completed);
}

async function recomputeStatus(instanceId: number, trx?: Knex.Transaction) {
  const cx = trx || db;
  const items = await cx('checklist_instance_items').where('instance_id', instanceId).select('is_completed');
  const all = items.length > 0 && items.every((i: any) => i.is_completed);
  const any = items.some((i: any) => i.is_completed);
  await cx('checklist_instances').where('id', instanceId).update({
    status: all ? 'completed' : any ? 'in_progress' : 'pending',
    completed_at: all ? cx.fn.now() : null,
    updated_at: cx.fn.now(),
  });
}

// ─── Items ───

export async function toggleItem(itemId: number, userId: number) {
  const item = await db('checklist_instance_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  const next = !item.is_completed;
  if (!next && item.document_url) {
    throw new ValidationError('Remove the uploaded document before marking this item incomplete.');
  }
  await db('checklist_instance_items').where('id', itemId).update({
    is_completed: next,
    completed_at: next ? db.fn.now() : null,
    completed_by: next ? userId : null,
    updated_at: db.fn.now(),
  });
  await recomputeStatus(item.instance_id);
  return db('checklist_instance_items').where('id', itemId).first();
}

export async function addItem(instanceId: number, data: { label: string; category?: string }) {
  const instance = await db('checklist_instances').where('id', instanceId).first();
  if (!instance) throw new NotFoundError('Checklist');
  const label = String(data.label || '').trim();
  if (!label) throw new ValidationError('Item label is required');
  const max = await db('checklist_instance_items').where('instance_id', instanceId).max({ m: 'sort_order' }).first();
  const [id] = await db('checklist_instance_items').insert({
    instance_id: instanceId, label, category: data.category || 'General',
    sort_order: Number((max as any)?.m || 0) + 1,
  });
  await recomputeStatus(instanceId); // a new unticked item can un-complete the phase
  return db('checklist_instance_items').where('id', id).first();
}

export async function deleteItem(itemId: number) {
  const item = await db('checklist_instance_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  // A template-linked item on a still-open candidate checklist would be re-added by
  // the reconcile on the next view — deleting it here is a confusing no-op loop, so
  // refuse and point at the template, where a delete actually sticks. Custom items
  // and items on frozen (advanced-past) checklists delete as before.
  if (item.template_item_id != null) {
    const open = await db('checklist_instances as ci')
      .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
      .join('candidates as c', 'c.id', 'ci.candidate_id')
      .where('ci.id', item.instance_id)
      .whereRaw('c.stage = ct.phase')
      .first();
    if (open) {
      throw new ValidationError(
        'This item comes from the checklist template, so it would be re-added automatically. Remove it from Recruitment → Checklist Templates instead.',
      );
    }
  }
  if (item.document_url) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(item.document_url))); } catch { /* already gone */ }
  }
  await db('checklist_instance_items').where('id', itemId).del();
  await recomputeStatus(item.instance_id);
  return { id: itemId };
}

// ─── Per-item documents (as onboarding had) ───

export async function uploadItemDocument(itemId: number, file: { originalname: string; buffer: Buffer }, userId: number) {
  const item = await db('checklist_instance_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  if (!file) throw new ValidationError('No file uploaded');

  const instance = await db('checklist_instances as ci')
    .join('checklist_templates as ct', 'ct.id', 'ci.template_id')
    .where('ci.id', item.instance_id).select('ct.supports_documents').first();
  if (!instance?.supports_documents) throw new ValidationError('This checklist does not accept documents.');

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = `${itemId}_${Date.now()}_${sanitizeName(file.originalname)}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.buffer);

  if (item.document_url) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(item.document_url))); } catch { /* ignore */ }
  }

  await db('checklist_instance_items').where('id', itemId).update({
    document_url: `uploads/checklists/${stored}`,
    document_name: file.originalname.slice(0, 255),
    is_completed: true,
    completed_at: db.fn.now(),
    completed_by: userId,
    updated_at: db.fn.now(),
  });
  await recomputeStatus(item.instance_id);
  return db('checklist_instance_items').where('id', itemId).first();
}

export async function getItemDocument(itemId: number) {
  const item = await db('checklist_instance_items').where('id', itemId).first();
  if (!item || !item.document_url) throw new NotFoundError('Document');
  return {
    absPath: path.join(UPLOAD_DIR, path.basename(item.document_url)),
    name: item.document_name || path.basename(item.document_url),
  };
}

export async function removeItemDocument(itemId: number) {
  const item = await db('checklist_instance_items').where('id', itemId).first();
  if (!item) throw new NotFoundError('Checklist item');
  if (item.document_url) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(item.document_url))); } catch { /* ignore */ }
  }
  await db('checklist_instance_items').where('id', itemId).update({
    document_url: null, document_name: null,
    is_completed: false, completed_at: null, completed_by: null,
    updated_at: db.fn.now(),
  });
  await recomputeStatus(item.instance_id);
  return db('checklist_instance_items').where('id', itemId).first();
}
