import type { Knex } from 'knex';

/**
 * Remove leave encashment entirely.
 *
 * Two features shared one name and both are gone:
 *
 *  1. The self-service **Encashment screen** — request, approve, reject. Record-only: it never
 *     reached payroll, because Finance settled the payment outside the product.
 *  2. The **Full & Final leave payout** — `encashable balance × basic ÷ 30`, added into settlement
 *     earnings on exit. That one WAS money, and removing it means a leaver's settlement no longer
 *     includes their unused leave. Settlements already saved keep their own figure:
 *     `offboarding_cases.fnf_details` stores the whole breakdown and `fnf_amount` the total, and
 *     neither is touched here.
 *
 * `is_encashable` therefore goes from BOTH tables that carry it — `leave_types` (the global
 * catalogue) and `leave_template_rows` (the per-template copy the F&F code actually read).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DESTROYS, stated plainly.
 *
 * `leave_encashments.per_day_rate` and `.amount` exist nowhere else in the schema. Audit logs
 * record who approved which request; notifications record the DAYS. Neither records the rupees.
 * Dropping the table therefore erases the only record of how much was authorised for every
 * encashment HR ever approved.
 *
 * The drop is unconditional by explicit instruction. Before running this anywhere that might hold
 * real rows, take the numbers first:
 *
 *     SELECT status, COUNT(*), SUM(days), SUM(amount) FROM leave_encashments GROUP BY status;
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY LEAVES ALONE.
 *
 * Approving an encashment debited the employee's balance — a negative `leave_accruals` row noted
 * `Encashed (request #N)`, or an increment to `leave_entitlements.used_days`. Those are real
 * debits against leave that was genuinely paid for, and reversing them would hand people back
 * days they have already been compensated for. They stay, and after this migration the accrual
 * note is the only surviving explanation for them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('leave_encashments');

  if (await knex.schema.hasColumn('leave_types', 'is_encashable')) {
    await knex.schema.alterTable('leave_types', (t) => { t.dropColumn('is_encashable'); });
  }
  if (await knex.schema.hasColumn('leave_template_rows', 'is_encashable')) {
    await knex.schema.alterTable('leave_template_rows', (t) => { t.dropColumn('is_encashable'); });
  }

  // The seeded 'Leave Encashment' payroll earning — a way to pay this manually, which is exactly
  // what is being withdrawn. Removed only when no salary structure references it: breaking a live
  // structure to tidy a catalogue entry would be a bad trade, and an unused row is harmless.
  const comp = await knex('salary_components').where('name', 'Leave Encashment').first();
  if (comp) {
    const used = await knex('salary_structure_components')
      .where('component_id', comp.id).count({ c: '*' }).first();
    if (Number((used as any)?.c || 0) === 0) {
      await knex('salary_components').where('id', comp.id).del();
    }
  }

  // Subscriptions to an event nothing emits any more. Inert, but they would sit in the
  // Notification Settings table forever pointing at a key the catalogue no longer knows.
  await knex('notification_settings').where('event_key', 'leave.encashment_approved').del();
}

/**
 * Rolls back the SHAPE, not the data.
 *
 * The table comes back empty and both flags come back `false` for every row. There is no way to
 * restore the encashment history or which leave types were once encashable — that information was
 * destroyed by `up()` and lives only in whatever backup was taken beforehand.
 */
export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('leave_types', 'is_encashable'))) {
    await knex.schema.alterTable('leave_types', (t) => {
      t.boolean('is_encashable').notNullable().defaultTo(false);
    });
  }
  if (!(await knex.schema.hasColumn('leave_template_rows', 'is_encashable'))) {
    await knex.schema.alterTable('leave_template_rows', (t) => {
      t.boolean('is_encashable').notNullable().defaultTo(false);
    });
  }

  if (!(await knex.schema.hasTable('leave_encashments'))) {
    await knex.schema.createTable('leave_encashments', (t) => {
      t.increments('id');
      t.integer('employee_id').notNullable();
      t.integer('leave_type_id').notNullable();
      t.integer('leave_period_id').notNullable();
      t.float('days').notNullable();
      t.float('per_day_rate').notNullable();
      t.float('amount').notNullable();
      t.string('status', 12).notNullable().defaultTo('pending');
      t.text('note');
      t.text('rejection_reason');
      t.integer('requested_by');
      t.integer('approved_by');
      t.text('approved_at');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    await knex.schema.alterTable('leave_encashments', (t) => {
      t.foreign('approved_by').references('id').inTable('users').onDelete('SET NULL');
      t.foreign('requested_by').references('id').inTable('users').onDelete('SET NULL');
      t.foreign('leave_period_id').references('id').inTable('leave_periods').onDelete('RESTRICT');
      t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('RESTRICT');
      t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    });
  }
}
