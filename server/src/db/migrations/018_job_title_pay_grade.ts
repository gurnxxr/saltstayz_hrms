import type { Knex } from 'knex';

/**
 * Make pay grades the system of record for salary bands, keyed off the ROLE.
 *
 * `pay_grades` has existed since the baseline (name + min_salary + max_salary, seeded with
 * Grade A–D) but was a completely orphaned pick-list: nothing read it. Meanwhile the real,
 * enforced ceiling lived in `manpower_sanctions.band_max` — one approved maximum per
 * property × role. This gives each job title a grade, so one band governs the role everywhere
 * and the sanctions table goes back to being purely about headcount and budget.
 *
 * DELIBERATELY NOT DROPPED: `manpower_sanctions`, and its `band_min`/`band_max` columns. That
 * table also carries `sanctioned_headcount` and `sanctioned_budget_monthly`, which are the
 * roll-up fallback for every "rolled_up" property's hiring budget — dropping it would break
 * hiring org-wide. The band columns are simply no longer read; leaving the data in place keeps
 * this migration reversible and preserves the audit trail of what each cap used to be.
 *
 * BACKFILL: unlike 016 (job title → department), which refused to guess because the association
 * was noisy and a wrong mapping hides a title under the wrong department, this derivation is
 * numeric and principled: a role whose approved ceiling was ₹22,000 genuinely belongs in the
 * grade whose band spans ₹22,000. Each title takes the HIGHEST ceiling it had across properties
 * (the most permissive, so nobody's existing pay is retroactively out-of-band because a quieter
 * property had a lower cap) and lands in the grade containing it, else the nearest grade.
 * Roles with no configured cap stay NULL — an unassigned role blocks offers until an admin sets
 * its grade, which is the intended behaviour, not an oversight.
 */

/** How far a value sits outside a grade's band (0 when it falls inside). */
function distanceToBand(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('job_titles', 'pay_grade_id'))) {
    await knex.schema.alterTable('job_titles', (t) => {
      t.integer('pay_grade_id').references('id').inTable('pay_grades').onDelete('SET NULL');
    });
  }

  // Only grades with BOTH bounds can contain a value; a half-open grade can't be reasoned about.
  const grades = (await knex('pay_grades').select('id', 'min_salary', 'max_salary'))
    .filter((g: any) => g.min_salary != null && g.max_salary != null)
    .map((g: any) => ({ id: g.id, min: Number(g.min_salary), max: Number(g.max_salary) }));
  if (grades.length === 0) return;

  // The highest approved ceiling each role carried, across every property.
  const caps = await knex('manpower_sanctions')
    .where('band_max', '>', 0)
    .groupBy('job_title_id')
    .select('job_title_id')
    .max({ cap: 'band_max' });

  for (const row of caps as any[]) {
    const cap = Number(row.cap);
    if (!Number.isFinite(cap) || cap <= 0) continue;
    const chosen = grades.reduce((best, g) =>
      distanceToBand(cap, g.min, g.max) < distanceToBand(cap, best.min, best.max) ? g : best);
    await knex('job_titles')
      .where('id', row.job_title_id)
      .whereNull('pay_grade_id')          // never overwrite a grade an admin already set
      .update({ pay_grade_id: chosen.id, updated_at: knex.fn.now() });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('job_titles', 'pay_grade_id')) {
    await knex.schema.alterTable('job_titles', (t) => t.dropColumn('pay_grade_id'));
  }
}
