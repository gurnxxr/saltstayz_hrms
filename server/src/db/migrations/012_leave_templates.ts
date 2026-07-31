import type { Knex } from 'knex';

/**
 * Leave Templates — Step 1 (data foundation only; ZERO behaviour change).
 *
 * Leave rules stop being one company-wide set on `leave_types` and become reusable
 * TEMPLATES: a named bundle carrying, per leave type, the full rule set. Each employee
 * is assigned exactly one template (`employees.leave_template_id`).
 *
 * This migration only lays the tables and converts today's settings into ONE "Default"
 * template, byte-for-byte, then puts every current employee on it. Nothing reads the
 * templates yet (Step 2 does), so no balance, apply, approve, or payroll number moves.
 *
 * Scope notes:
 *  - The per-type settings copied are exactly the columns that drive leave today
 *    (see leave_types in the baseline). "Can't-club-with" is carried via
 *    leave_template_row_conflicts (mirrors leave_type_conflicts).
 *  - Department-scoping (leave_type_departments) is intentionally NOT part of a template
 *    — the plan folds that into "assign the right template to those employees", and there
 *    are no department restrictions in the data, so carrying none keeps it byte-for-byte.
 *  - `default_days` on a template row is the ISSUANCE figure (what a fresh entitlement gets).
 *    Existing per-employee leave_entitlements rows remain the balance ledger, which is why
 *    entitlement changes only ever apply going forward.
 */

// leave_types setting columns copied verbatim onto each template row.
const ROW_SETTING_COLUMNS = [
  'default_days', 'is_paid', 'is_encashable', 'min_days_per_request', 'max_days_per_request',
  'advance_notice_days', 'half_day_allowed', 'document_required_after_days', 'eligibility',
  'after_probation_only', 'count_sandwich_days',
] as const;

export async function up(knex: Knex): Promise<void> {
  // ── Tables ──
  if (!(await knex.schema.hasTable('leave_templates'))) {
    await knex.schema.createTable('leave_templates', (t) => {
      t.increments('id');
      t.string('name', 80).notNullable();
      t.boolean('is_default').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
    // Case-insensitive unique name (learned from employment_types — a case-sensitive
    // unique would let "Default"/"default" both exist while the app dedups case-insensitively).
    await knex.raw('CREATE UNIQUE INDEX leave_templates_name_lower_unique ON leave_templates (lower(name))');
    console.log('  created leave_templates');
  }

  if (!(await knex.schema.hasTable('leave_template_rows'))) {
    await knex.schema.createTable('leave_template_rows', (t) => {
      t.increments('id');
      t.integer('template_id').notNullable().references('id').inTable('leave_templates').onDelete('CASCADE');
      t.integer('leave_type_id').notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      // The full per-type rule set — same columns/types/defaults as leave_types.
      t.integer('default_days').notNullable().defaultTo(0);
      t.boolean('is_paid').notNullable().defaultTo(true);
      t.boolean('is_encashable').notNullable().defaultTo(false);
      t.integer('min_days_per_request');
      t.integer('max_days_per_request');
      t.integer('advance_notice_days');
      t.boolean('half_day_allowed').notNullable().defaultTo(true);
      t.integer('document_required_after_days');
      t.string('eligibility', 10).notNullable().defaultTo('any');
      t.boolean('after_probation_only').notNullable().defaultTo(false);
      t.boolean('count_sandwich_days').notNullable().defaultTo(false);
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['template_id', 'leave_type_id']); // one row per leave type in a template
    });
    console.log('  created leave_template_rows');
  }

  if (!(await knex.schema.hasTable('leave_template_row_conflicts'))) {
    await knex.schema.createTable('leave_template_row_conflicts', (t) => {
      t.increments('id');
      t.integer('template_row_id').notNullable().references('id').inTable('leave_template_rows').onDelete('CASCADE');
      t.integer('conflict_leave_type_id').notNullable().references('id').inTable('leave_types').onDelete('CASCADE');
      t.unique(['template_row_id', 'conflict_leave_type_id']);
    });
    console.log('  created leave_template_row_conflicts');
  }

  if (!(await knex.schema.hasColumn('employees', 'leave_template_id'))) {
    await knex.schema.alterTable('employees', (t) => { t.integer('leave_template_id'); });
    console.log('  added employees.leave_template_id');
  }

  // ── Build the Default template from today's settings, once ──
  const [{ c }] = await knex('leave_templates').count('id as c');
  if (Number(c) === 0) {
    const [{ id: templateId }] = await knex('leave_templates')
      .insert({ name: 'Default', is_default: true, is_active: true }).returning('id');

    // One row per ACTIVE leave type (active types are exactly what employees get today).
    const types = await knex('leave_types').where('is_active', true).orderBy('id').select('*');
    const rowIdByType = new Map<number, number>();
    for (const lt of types) {
      const row: Record<string, any> = { template_id: templateId, leave_type_id: lt.id };
      for (const col of ROW_SETTING_COLUMNS) row[col] = lt[col];
      const [{ id: rowId }] = await knex('leave_template_rows').insert(row).returning('id');
      rowIdByType.set(lt.id, rowId);
    }

    // Carry can't-club-with (empty today, but keep the conversion faithful).
    const conflicts = await knex('leave_type_conflicts').select('*');
    for (const cf of conflicts) {
      const rowId = rowIdByType.get(cf.leave_type_id);
      if (rowId && rowIdByType.has(cf.conflict_leave_type_id)) {
        await knex('leave_template_row_conflicts')
          .insert({ template_row_id: rowId, conflict_leave_type_id: cf.conflict_leave_type_id })
          .onConflict(['template_row_id', 'conflict_leave_type_id']).ignore();
      }
    }

    // Put every current employee on Default.
    const assigned = await knex('employees').whereNull('leave_template_id').update({ leave_template_id: templateId });
    console.log(`  built Default leave template (${types.length} rows, ${conflicts.length} conflicts) and assigned ${assigned} employees`);
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('employees', 'leave_template_id')) {
    await knex.schema.alterTable('employees', (t) => { t.dropColumn('leave_template_id'); });
  }
  await knex.schema.dropTableIfExists('leave_template_row_conflicts');
  await knex.schema.dropTableIfExists('leave_template_rows');
  await knex.schema.dropTableIfExists('leave_templates');
}
