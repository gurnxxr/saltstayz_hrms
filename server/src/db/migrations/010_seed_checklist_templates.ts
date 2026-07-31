import type { Knex } from 'knex';

/**
 * Seeds the three standard onboarding checklist templates + their items.
 *
 * The Postgres baseline created `checklist_templates` / `checklist_template_items`
 * EMPTY — the original seeding lived in the archived SQLite migration
 * (071_recruitment_rebuild.ts), which is not run on Postgres, and no seed replaced it.
 * Result: the Recruitment → Checklist screen had nothing to show, and the page only
 * lets you add items to templates that already exist (no "create template" control),
 * so it could not recover on its own.
 *
 * These three templates gate the three onboarding phases (Document Collection,
 * Pre-joining Formalities, Joining Day). Seeded only when the table is empty, so an
 * admin's later edits are never clobbered.
 */

const DOCUMENT_COLLECTION_ITEMS = [
  'Personal documents submitted',
  'ID proof verified',
  'Address proof verified',
  'Bank account details submitted',
  'PAN card copy submitted',
  'Aadhaar card copy submitted',
  'Photo submitted',
  'Emergency contact details provided',
  'NDA / employment agreement signed',
  'IT equipment issued',
  'Email / system access created',
  'Property tour completed',
  'Team introduction done',
  'HR policy handbook acknowledged',
];
const PRE_JOINING_ITEMS = [
  'Background verification cleared',
  'Reference check completed',
  'Medical fitness certificate received',
  'Joining date confirmed with candidate',
  'Workstation / uniform arranged',
  'Payroll and statutory details captured',
];
const JOINING_DAY_ITEMS = [
  'Candidate reported at property',
  'Original documents verified in person',
  'Joining report signed',
  'Induction session completed',
  'Employee code and ID card issued',
];

// [key, name, phase, supports_documents, items]
const TEMPLATES: Array<[string, string, string, boolean, string[]]> = [
  ['document_collection', 'Document Collection', 'document_collection', true, DOCUMENT_COLLECTION_ITEMS],
  ['pre_joining', 'Pre-joining Formalities', 'pre_joining', true, PRE_JOINING_ITEMS],
  ['joining_day', 'Joining Day', 'joining', false, JOINING_DAY_ITEMS],
];

export async function up(knex: Knex): Promise<void> {
  const [{ count }] = await knex('checklist_templates').count('id as count');
  if (Number(count) > 0) {
    console.log('  checklist_templates already populated — skipping seed');
    return;
  }
  for (const [key, name, phase, supportsDocs, items] of TEMPLATES) {
    const [{ id: templateId }] = await knex('checklist_templates')
      .insert({ key, name, phase, supports_documents: supportsDocs, is_active: true })
      .returning('id');
    await knex('checklist_template_items').insert(
      items.map((label, i) => ({
        template_id: templateId, category: 'General', label, sort_order: i, is_active: true,
      })),
    );
    console.log(`  seeded checklist "${name}" with ${items.length} items`);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Only remove the three seeded templates (and their items via app-level delete),
  // leaving any admin-created ones untouched.
  const keys = TEMPLATES.map((t) => t[0]);
  const ids = await knex('checklist_templates').whereIn('key', keys).pluck('id');
  if (ids.length) {
    await knex('checklist_template_items').whereIn('template_id', ids).del();
    await knex('checklist_templates').whereIn('id', ids).del();
  }
}
