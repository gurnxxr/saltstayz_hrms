import type { Knex } from 'knex';

// Dummy recruitment data: open vacancies across several properties + candidates
// spread over every pipeline stage. Idempotent — rows are tagged and re-created.
export async function seed(knex: Knex): Promise<void> {
  // Clear previously-seeded dummy rows (tagged by email / description).
  const dummyCandIds = await knex('candidates').where('email', 'like', '%@dummy.test').pluck('id');
  if (dummyCandIds.length) {
    await knex('candidate_history').whereIn('candidate_id', dummyCandIds).del();
    await knex('candidates').whereIn('id', dummyCandIds).del();
  }
  await knex('vacancies').where('description', 'like', 'DUMMY:%').del();

  const admin = await knex('users as u').join('roles as r', 'r.id', 'u.role_id')
    .where('r.name', 'admin').select('u.id').first();
  const mgr = await knex('employees').whereNot('employment_status', 'left').first('id');

  const jts = await knex('job_titles').select('id', 'title');
  const jt: Record<string, number> = {};
  jts.forEach((j: any) => { jt[j.title] = j.id; });
  const depts = await knex('departments').select('id', 'name');
  const dept: Record<string, number> = {};
  depts.forEach((d: any) => { dept[d.name] = d.id; });

  const props = await knex('properties').orderBy('id').limit(5).select('id', 'name');

  const roleDept: Record<string, string> = {
    'Housekeeping Attendant': 'Housekeeping',
    'F&B Server': 'Food & Beverage',
    'Front Desk Executive': 'Front Desk',
  };
  const stages = ['applied', 'interview', 'selected', 'rejected'];
  const firstNames = ['Aarav', 'Diya', 'Kabir', 'Isha', 'Rohan', 'Sara', 'Vivaan', 'Anaya', 'Arjun', 'Myra', 'Reyansh', 'Kiara'];
  const lastNames = ['Sharma', 'Verma', 'Iyer', 'Khan', 'Nair', 'Patel', 'Reddy', 'Bose', 'Gill', 'Rao'];

  let idx = 0;
  for (const p of props) {
    for (const role of Object.keys(roleDept)) {
      if (!jt[role] || !dept[roleDept[role]]) continue;
      const [vacId] = await knex('vacancies').insert({
        job_title_id: jt[role], department_id: dept[roleDept[role]], property_id: p.id,
        positions: 2, filled: 0, status: 'listed',
        description: `DUMMY: ${role} opening at ${p.name}`,
        reporting_manager_id: mgr?.id || null, posted_by: admin?.id,
      });

      const n = 3 + (idx % 3); // 3–5 candidates per vacancy
      for (let k = 0; k < n; k++) {
        const stage = stages[(idx + k) % stages.length];
        const fn = firstNames[(idx + k) % firstNames.length];
        const ln = lastNames[(idx * 2 + k) % lastNames.length];
        await knex('candidates').insert({
          vacancy_id: vacId,
          name: `${fn} ${ln}`,
          email: `${fn}.${ln}.${idx}${k}@dummy.test`.toLowerCase(),
          phone: `9${String(100000000 + idx * 137 + k).slice(-9)}`,
          stage,
          archived: stage === 'rejected',
          added_by: admin?.id,
        });
      }
      idx++;
    }
  }
}
