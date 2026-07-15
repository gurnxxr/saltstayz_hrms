import type { Knex } from 'knex';

// A template item must appear at most once per checklist instance. The read-path
// reconcile (reconcileInstanceToTemplate) inserted "missing" template items without a
// DB-level guard, so two concurrent loads of the same candidate could each insert the
// same item — duplicating a document row and skewing the "x/y complete" count + the
// stage gate. This adds a unique index to make that impossible; the insert paths use
// target-less ON CONFLICT DO NOTHING so a lost race is a harmless no-op.
//
// Custom, per-candidate items keep template_item_id NULL. SQLite treats NULLs as
// distinct in a unique index, so any number of custom items per instance still allowed.
//
// Run with the dev server STOPPED: a write committed by live old code between the
// dedupe read and this migration's first write can abort it with SQLITE_BUSY
// (snapshot conflict — busy_timeout does not apply). The migration is transactional,
// so a failed run rolls back cleanly and can simply be re-run.
const INDEX = 'uq_cii_instance_template_item';

export async function up(knex: Knex): Promise<void> {
  // Collapse any duplicates an earlier race already created. Keep the most valuable
  // copy: the NEWEST row with an uploaded document (the latest upload supersedes),
  // else the OLDEST completed row (original sign-off provenance), else the oldest row.
  // Rows are only deleted, never their files — anything discarded that carried a
  // document is logged so an admin can recover it from data/uploads/checklists.
  const dupes = await knex('checklist_instance_items')
    .whereNotNull('template_item_id')
    .select('instance_id', 'template_item_id')
    .groupBy('instance_id', 'template_item_id')
    .havingRaw('count(*) > 1');

  const touchedInstances = new Set<number>();
  for (const d of dupes as any[]) {
    const rows = await knex('checklist_instance_items')
      .where({ instance_id: d.instance_id, template_item_id: d.template_item_id })
      .orderBy('id');
    const docRows = rows.filter((r: any) => r.document_url);
    const keep = docRows[docRows.length - 1] || rows.find((r: any) => r.is_completed) || rows[0];
    const remove = rows.filter((r: any) => r.id !== keep.id);
    for (const r of remove as any[]) {
      if (r.document_url) {
        // eslint-disable-next-line no-console
        console.warn(
          `[079] dropping duplicate checklist item ${r.id} (instance ${r.instance_id}, template item ${r.template_item_id}) ` +
          `that carried document "${r.document_name || ''}" at ${r.document_url} — file left on disk for recovery`,
        );
      }
    }
    if (remove.length) {
      await knex('checklist_instance_items').whereIn('id', remove.map((r: any) => r.id)).del();
      touchedInstances.add(d.instance_id);
    }
  }

  // Deleting an unticked duplicate can leave every surviving item complete while the
  // parent instance still says 'in_progress' — recompute the aggregate for every
  // instance the dedupe touched (mirrors checklist.service recomputeStatus).
  for (const instanceId of touchedInstances) {
    const items = await knex('checklist_instance_items').where('instance_id', instanceId).select('is_completed');
    const all = items.length > 0 && items.every((i: any) => i.is_completed);
    const any = items.some((i: any) => i.is_completed);
    const current = await knex('checklist_instances').where('id', instanceId).select('completed_at').first();
    await knex('checklist_instances').where('id', instanceId).update({
      status: all ? 'completed' : any ? 'in_progress' : 'pending',
      // Preserve an existing completion timestamp — don't rewrite history.
      completed_at: all ? (current?.completed_at ?? knex.fn.now()) : null,
      updated_at: knex.fn.now(),
    });
  }

  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON checklist_instance_items (instance_id, template_item_id)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
}
