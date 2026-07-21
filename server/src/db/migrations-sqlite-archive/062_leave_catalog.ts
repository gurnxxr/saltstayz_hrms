import type { Knex } from 'knex';

// Payroll v2 Phase 4 — Leave Categories.
// Align the everyday leave catalog with the four agreed categories:
//   Casual Leave (paid), Sick Leave (paid), Privilege Leave (paid, encashable),
//   Loss of Pay (unpaid → produces LOP days).
// Maternity/Paternity stay as statutory paid types outside the four.
//
//   Earned Leave  → Privilege Leave  (keeps is_paid + is_encashable)
//   Unpaid Leave  → Loss of Pay      (is_paid stays false)
// Pure data rename; the engine keys off is_paid / is_encashable, never the name.

export async function up(knex: Knex): Promise<void> {
  await knex('leave_types').where('name', 'Earned Leave').update({ name: 'Privilege Leave' });
  await knex('leave_types').where('name', 'Unpaid Leave').update({ name: 'Loss of Pay' });
  // Privilege Leave carries encashment (migration 055 set this on 'Earned Leave',
  // but a fresh seed inserts leave types after migrations run, so re-assert it).
  await knex('leave_types').where('name', 'Privilege Leave').update({ is_encashable: true });
}

export async function down(knex: Knex): Promise<void> {
  await knex('leave_types').where('name', 'Privilege Leave').update({ name: 'Earned Leave' });
  await knex('leave_types').where('name', 'Loss of Pay').update({ name: 'Unpaid Leave' });
}
