import type { Knex } from 'knex';

// Attendance regularisation (self-service correction of a missing / mis-punched day).
//
// The attendance_regularisations table exists since migration 005 but was never
// wired: it keyed off an existing attendance_id and had no `date`, so a *missing*
// day (no record at all) couldn't be requested. This adds the fields the feature
// needs while keeping the table as the audit trail (who requested vs what was
// applied, who decided, when):
//   date            — the day being corrected (may have no attendance_records row)
//   applied_status  — the status written on approval (present / short_punch / …)
//   reviewer_comment— the approver's note (mandatory on reject)
//   decided_at      — when the request was approved/rejected
//
// SQLite: add columns one ALTER at a time (guarded so re-running is safe).

const TABLE = 'attendance_regularisations';

async function addColumn(knex: Knex, name: string, build: (t: Knex.AlterTableBuilder) => void) {
  if (!(await knex.schema.hasColumn(TABLE, name))) {
    await knex.schema.alterTable(TABLE, build);
  }
}

export async function up(knex: Knex): Promise<void> {
  await addColumn(knex, 'date', (t) => t.date('date'));
  await addColumn(knex, 'applied_status', (t) => t.string('applied_status', 20));
  await addColumn(knex, 'reviewer_comment', (t) => t.text('reviewer_comment'));
  await addColumn(knex, 'decided_at', (t) => t.timestamp('decided_at'));
  await knex.raw(`CREATE INDEX IF NOT EXISTS idx_reg_emp_status ON ${TABLE}(employee_id, status)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_reg_emp_status');
  for (const col of ['decided_at', 'reviewer_comment', 'applied_status', 'date']) {
    if (await knex.schema.hasColumn(TABLE, col)) {
      await knex.schema.alterTable(TABLE, (t) => t.dropColumn(col));
    }
  }
}
