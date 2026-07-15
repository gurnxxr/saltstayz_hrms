import type { Knex } from 'knex';

// A template item must appear at most once per checklist instance. The read-path
// reconcile (reconcileInstanceToTemplate) inserted "missing" template items without a
// DB-level guard, so two concurrent loads of the same candidate could each insert the
// same item — duplicating a document row and skewing the "x/y complete" count + the
// stage gate. This adds a unique index to make that impossible; the insert paths also
// use ON CONFLICT DO NOTHING so a lost race is a harmless no-op.
//
// Custom, per-candidate items keep template_item_id NULL. SQLite treats NULLs as
// distinct in a unique index, so any number of custom items per instance still allowed.
const INDEX = 'uq_cii_instance_template_item';

export async function up(knex: Knex): Promise<void> {
  // Collapse any duplicates an earlier race already created — keep the most valuable
  // copy (one with an uploaded document, else a ticked one, else the oldest row).
  const dupes = await knex('checklist_instance_items')
    .whereNotNull('template_item_id')
    .select('instance_id', 'template_item_id')
    .count({ c: '*' })
    .groupBy('instance_id', 'template_item_id')
    .havingRaw('count(*) > 1');

  for (const d of dupes as any[]) {
    const rows = await knex('checklist_instance_items')
      .where({ instance_id: d.instance_id, template_item_id: d.template_item_id })
      .orderBy('id');
    const keep = rows.find((r: any) => r.document_url) || rows.find((r: any) => r.is_completed) || rows[0];
    const remove = rows.filter((r: any) => r.id !== keep.id).map((r: any) => r.id);
    if (remove.length) await knex('checklist_instance_items').whereIn('id', remove).del();
  }

  await knex.raw(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX} ON checklist_instance_items (instance_id, template_item_id)`,
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX}`);
}
