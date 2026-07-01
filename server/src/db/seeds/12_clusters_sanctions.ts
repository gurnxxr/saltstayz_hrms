import type { Knex } from 'knex';

// Clusters, per property x role sanctions, and demo backfill of monthly_ctc /
// employment_status so the Manpower guardrail and Property Analytics have data.
export async function seed(knex: Knex): Promise<void> {
  await knex('manpower_exceptions').del();
  await knex('employee_status_history').del();
  await knex('user_clusters').del();
  await knex('manpower_property_budgets').del();
  await knex('manpower_sanctions').del();
  await knex('clusters').del();

  // ─── Clusters ───
  const [delhiId] = await knex('clusters').insert({ name: 'Delhi NCR', description: 'Delhi properties' });
  const [ggnId] = await knex('clusters').insert({ name: 'Gurgaon Region', description: 'Gurgaon properties' });

  const properties = await knex('properties').select('id', 'name', 'city');
  for (const p of properties) {
    const clusterId = /gurgaon/i.test(p.name) || /gurgaon/i.test(p.city || '') ? ggnId : delhiId;
    await knex('properties').where('id', p.id).update({ cluster_id: clusterId });
  }

  // Scope the seeded Cluster HR to Delhi NCR.
  const clusterHr = await knex('users').where('email', 'clusterhr@saltstayz.com').first();
  if (clusterHr) await knex('user_clusters').insert({ user_id: clusterHr.id, cluster_id: delhiId });

  const adminUser = await knex('users as u').join('roles as r', 'r.id', 'u.role_id').where('r.name', 'admin').select('u.id').first();
  const adminId = adminUser?.id || null;

  // ─── Blue-collar role bands (monthly CTC) ───
  const jobTitles = await knex('job_titles').select('id', 'title');
  const jt: Record<string, number> = {};
  jobTitles.forEach((j: any) => { jt[j.title] = j.id; });

  const roleBands: { title: string; band_min: number; band_max: number }[] = [
    { title: 'F&B Server', band_min: 15000, band_max: 22000 },
    { title: 'Housekeeping Attendant', band_min: 14000, band_max: 20000 },
    { title: 'Housekeeping Supervisor', band_min: 20000, band_max: 28000 },
    { title: 'Front Desk Executive', band_min: 18000, band_max: 26000 },
  ];

  // ─── Sanctions per property × role + backfill committed CTC ───
  for (const p of properties) {
    for (const rb of roleBands) {
      const jobTitleId = jt[rb.title];
      if (!jobTitleId) continue;

      // Existing active staff in this property × role → committed at band_min.
      const staff = await knex('employees')
        .where('branch_name', p.name)
        .where('job_title_id', jobTitleId)
        .whereNot('employment_status', 'left')
        .select('id');

      const filled = staff.length;
      for (const s of staff) {
        await knex('employees').where('id', s.id).update({
          monthly_ctc: rb.band_min,
          created_by_user_id: clusterHr?.id || null,
        });
      }

      const sanctionedHeadcount = filled + 3;                       // room for 3 more
      const committedAtMin = filled * rb.band_min;
      const budget = committedAtMin + rb.band_min * 3 + 6000;       // headroom above committed

      await knex('manpower_sanctions').insert({
        property_id: p.id,
        job_title_id: jobTitleId,
        sanctioned_headcount: sanctionedHeadcount,
        sanctioned_budget_monthly: budget,
        band_min: rb.band_min,
        band_max: rb.band_max,
        created_by: adminId,
        updated_by: adminId,
      });
    }
  }

  // ─── Property-level budget caps = roll-up of role sanctions (Admin can edit) ───
  for (const p of properties) {
    const roll = await knex('manpower_sanctions').where('property_id', p.id)
      .sum({ budget: 'sanctioned_budget_monthly' }).sum({ head: 'sanctioned_headcount' }).first();
    await knex('manpower_property_budgets').insert({
      property_id: p.id,
      sanctioned_budget_monthly: Number(roll?.budget || 0),
      sanctioned_headcount: Number(roll?.head || 0),
      created_by: adminId, updated_by: adminId,
    });
  }

  // ─── Demo: one over-band hire (salary variance), one On Notice, one Left ───
  const demo = await knex('employees as e')
    .join('job_titles as jt2', 'jt2.id', 'e.job_title_id')
    .whereIn('jt2.title', ['F&B Server', 'Housekeeping Attendant', 'Front Desk Executive'])
    .whereNot('e.employment_status', 'left')
    .select('e.id', 'e.branch_name', 'jt2.title')
    .orderBy('e.id')
    .limit(6);

  const bandMap: Record<string, { min: number; max: number }> = {};
  roleBands.forEach((rb) => { bandMap[rb.title] = { min: rb.band_min, max: rb.band_max }; });

  if (demo[0]) {
    // Over-band hire — drives salary-variance analytics.
    const b = bandMap[demo[0].title];
    await knex('employees').where('id', demo[0].id).update({
      monthly_ctc: b.max + 3000,
      created_by_user_id: clusterHr?.id || null,
      sanction_variance: 3000,
    });
    // Give that sanction extra budget so it shows over-band, not over-budget.
    await knex('manpower_sanctions')
      .where({ property_id: (await knex('properties').where('name', demo[0].branch_name).first())?.id, job_title_id: jt[demo[0].title] })
      .increment('sanctioned_budget_monthly', 10000);
  }

  if (demo[1]) {
    // On Notice — last working day 18 days out.
    const lwd = new Date(); lwd.setDate(lwd.getDate() + 18);
    const lwdStr = lwd.toISOString().split('T')[0];
    await knex('employees').where('id', demo[1].id).update({ employment_status: 'on_notice', last_working_day: lwdStr });
    await knex('employee_status_history').insert({
      employee_id: demo[1].id, from_status: 'active', to_status: 'on_notice',
      effective_date: new Date().toISOString().split('T')[0], last_working_day: lwdStr,
      reason: 'Resignation (seed demo)', changed_by: clusterHr?.id || null,
    });
  }

  if (demo[2]) {
    // Left — short notice (10 days ago), slot open to backfill.
    const lwd = new Date(); lwd.setDate(lwd.getDate() - 10);
    const lwdStr = lwd.toISOString().split('T')[0];
    const noticed = new Date(); noticed.setDate(noticed.getDate() - 18); // 8-day gap → short notice
    await knex('employees').where('id', demo[2].id).update({
      employment_status: 'left', is_active: false, open_to_backfill: true, last_working_day: lwdStr,
    });
    await knex('employee_status_history').insert([
      { employee_id: demo[2].id, from_status: 'active', to_status: 'on_notice', effective_date: noticed.toISOString().split('T')[0], last_working_day: lwdStr, reason: 'Short-notice resignation (seed demo)', changed_by: clusterHr?.id || null, created_at: noticed.toISOString() },
      { employee_id: demo[2].id, from_status: 'on_notice', to_status: 'left', effective_date: lwdStr, last_working_day: lwdStr, reason: 'Exited (seed demo)', changed_by: clusterHr?.id || null },
    ]);
  }
}
