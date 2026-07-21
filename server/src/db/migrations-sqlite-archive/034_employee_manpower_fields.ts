import type { Knex } from 'knex';

// Lifecycle + budget fields on employees. employment_status drives the headcount/budget
// "commit": active | pip | on_notice all consume a slot + budget; left frees them.
// monthly_ctc is the all-in CTC captured at hire (summed for committed budget).
// created_by/approved_by/sanction_variance form the hire audit trail.
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('employees', 'employment_status'))) {
    await knex.schema.alterTable('employees', (t) => {
      t.string('employment_status', 20).notNullable().defaultTo('active'); // active|pip|on_notice|left
      t.decimal('monthly_ctc', 12, 2);          // all-in monthly CTC (budget figure)
      t.date('last_working_day');               // required for on_notice / left
      t.date('pip_start_date');                 // required for pip
      t.date('pip_end_date');                   // required for pip
      t.text('status_reason');
      t.boolean('open_to_backfill').notNullable().defaultTo(false); // set when left
      t.integer('created_by_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.integer('approved_by_user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.decimal('sanction_variance', 12, 2);    // offered CTC - band_max at hire (>0 = over band)
    });

    // Backfill from the existing is_active flag.
    await knex('employees').where('is_active', true).update({ employment_status: 'active' });
    await knex('employees').where('is_active', false).update({ employment_status: 'left' });
  }
}

export async function down(knex: Knex): Promise<void> {
  // SQLite drops one column per alterTable (knex rebuilds the table each time).
  const cols = [
    'employment_status', 'monthly_ctc', 'last_working_day', 'pip_start_date',
    'pip_end_date', 'status_reason', 'open_to_backfill', 'created_by_user_id',
    'approved_by_user_id', 'sanction_variance',
  ];
  for (const col of cols) {
    if (await knex.schema.hasColumn('employees', col)) {
      await knex.schema.alterTable('employees', (t) => { t.dropColumn(col); });
    }
  }
}
