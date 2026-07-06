import type { Knex } from 'knex';

const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Repairs the users → employees link wherever it is missing.
 *
 * Employee rows get re-imported from CSV over the project's life (see
 * import-csv.ts), and CSV rows carry no email — so the `users.employee_id`
 * FK is easily orphaned and the demo logins can't be matched back by address
 * alone. This is the idempotent repair step, resolving each unlinked account:
 *   1. exact email match — the seven documented logins share their employee's
 *      email (chro@ → SS-0002, hr@ → SS-0003, …).
 *   2. name match — the demo logins created in seed 06 derive their address
 *      from the employee's name (`first.last@…`). We reverse that:
 *      normalized(local-part) === normalized(first_name + last_name), against
 *      an active employee not already claimed by another user.
 *
 * Only NULL links are touched, and an employee already linked to another user
 * is never poached. Safe to run repeatedly. Returns the number of links made.
 */
export async function linkUserProfiles(knex: Knex): Promise<number> {
  const unlinked = await knex('users').whereNull('employee_id').select('id', 'email');
  if (!unlinked.length) return 0;

  const takenRows = await knex('users').whereNotNull('employee_id').pluck('employee_id');
  const taken = new Set<number>(takenRows as number[]);

  const employees = await knex('employees').select('id', 'email', 'first_name', 'last_name', 'is_active');
  const byEmail = new Map<string, { id: number }>();
  for (const e of employees) {
    if (e.email) byEmail.set(String(e.email).toLowerCase(), e);
  }

  let linked = 0;
  for (const u of unlinked) {
    const emailLc = String(u.email || '').toLowerCase();

    // 1) exact email match
    let match = byEmail.get(emailLc);

    // 2) fall back to a unique active-employee name match
    if (!match || taken.has(match.id)) {
      const localKey = norm(emailLc.split('@')[0]);
      const candidates = localKey
        ? employees.filter(
            (e) => e.is_active && !taken.has(e.id) && norm(`${e.first_name}${e.last_name}`) === localKey,
          )
        : [];
      match = candidates.length === 1 ? candidates[0] : undefined;
    }

    if (match && !taken.has(match.id)) {
      await knex('users').where('id', u.id).update({ employee_id: match.id });
      taken.add(match.id);
      linked += 1;
    }
  }

  return linked;
}
