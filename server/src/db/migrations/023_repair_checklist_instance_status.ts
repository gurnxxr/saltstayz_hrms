import type { Knex } from 'knex';

/**
 * One-time repair for checklist instances whose stored status disagrees with their own items.
 *
 * `checklist_instances.status` is written in exactly one place — `recomputeStatus` — and until now
 * that ran as a separate statement AFTER the item write, outside any transaction. A failure between
 * the two left the status stale permanently, because nothing on the read path recomputed it. The
 * same is true of any checklist ticked out of band: a data fix or an import that sets
 * `checklist_instance_items.is_completed` directly never rolls the parent up.
 *
 * The service is now transactional and reconcile self-heals on read, so this only has to correct
 * what drifted before. Expected to touch zero rows on a clean database.
 */
export async function up(knex: Knex): Promise<void> {
  const result: any = await knex.raw(`
    UPDATE checklist_instances ci
       SET status = agg.expected,
           completed_at = CASE WHEN agg.expected = 'completed'
                               THEN COALESCE(ci.completed_at, CURRENT_TIMESTAMP::text)
                               ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
      FROM (
        SELECT i.id,
               CASE WHEN COUNT(it.id) > 0
                     AND COUNT(it.id) = COUNT(*) FILTER (WHERE it.is_completed) THEN 'completed'
                    WHEN COUNT(*) FILTER (WHERE it.is_completed) > 0 THEN 'in_progress'
                    ELSE 'pending' END AS expected
          FROM checklist_instances i
          LEFT JOIN checklist_instance_items it ON it.instance_id = i.id
         GROUP BY i.id
      ) agg
     WHERE agg.id = ci.id
       AND ci.status IS DISTINCT FROM agg.expected
  `);
  const n = Number(result?.rowCount ?? 0);
  console.log(n === 0
    ? '  checklist status: no instances had drifted.'
    : `  checklist status: repaired ${n} instance(s) whose status disagreed with their items.`);
}

export async function down(): Promise<void> {
  // Data repair — there is no meaningful rollback to a status that was wrong.
}
