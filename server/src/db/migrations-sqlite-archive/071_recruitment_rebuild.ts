import type { Knex } from 'knex';

// Recruitment rebuilt around the real eleven-step hiring process, with Onboarding
// absorbed into it. Steps 1-2 are states of a vacancy; steps 3-11 are states of a
// candidate. Nothing here is a page — they are the state of a record.
//
//   1 Vacancy/New Role   vacancies.status = 'new_role'
//   2 Job Listing        vacancies.status = 'listed'
//   3 Shortlisting       candidates.stage = 'applied'
//   4 Interview                            'interview'
//   5 Selection                            'selected'
//   6 Document Collection                  'document_collection'   [checklist]
//   7 Offer Release                        'offer_released'
//   8 Offer Acceptance                     'offer_accepted'
//   9 Pre-joining Formalities              'pre_joining'           [checklist]
//  10 Joining Day                          'joining'               [checklist]
//  11 Transfer to Manager                  'transferred'           (terminal)
//
// Off-ramps: 'rejected' (before an offer), 'offer_declined' (at acceptance),
// 'no_show' (at pre-joining or joining day).
//
// The three checklist phases (6, 9, 10) run on ONE generalized checklist rather than
// a fourth copy-pasted implementation: templates -> instances -> items, attached to a
// candidate OR an employee. The 14 hardcoded DEFAULT_CHECKLIST_ITEMS from
// onboarding.service.ts become the seeded document-collection template.

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

export async function up(knex: Knex): Promise<void> {
  // ── One generalized checklist ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('checklist_templates'))) {
    await knex.schema.createTable('checklist_templates', (t) => {
      t.increments('id').primary();
      t.string('key', 40).notNullable().unique();      // 'document_collection' | 'pre_joining' | 'joining_day'
      t.string('name', 100).notNullable();
      t.string('phase', 40);                            // the candidate stage this checklist gates
      t.boolean('supports_documents').notNullable().defaultTo(false);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('checklist_template_items'))) {
    await knex.schema.createTable('checklist_template_items', (t) => {
      t.increments('id').primary();
      t.integer('template_id').unsigned().notNullable().references('id').inTable('checklist_templates').onDelete('CASCADE');
      t.string('category', 40).notNullable().defaultTo('General');
      t.string('label', 200).notNullable();
      t.integer('sort_order').notNullable().defaultTo(0);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.timestamps(true, true);
    });
  }

  // An instance belongs to exactly one subject. SQLite has no polymorphic FK, so we
  // keep two nullable real FKs and assert exactly-one — referential integrity and
  // cascades stay intact, unlike a (subject_type, subject_id) pair.
  if (!(await knex.schema.hasTable('checklist_instances'))) {
    await knex.schema.createTable('checklist_instances', (t) => {
      t.increments('id').primary();
      t.integer('template_id').unsigned().notNullable().references('id').inTable('checklist_templates').onDelete('RESTRICT');
      t.integer('candidate_id').unsigned().references('id').inTable('candidates').onDelete('CASCADE');
      t.integer('employee_id').unsigned().references('id').inTable('employees').onDelete('CASCADE');
      t.string('status', 20).notNullable().defaultTo('pending'); // pending | in_progress | completed
      t.timestamp('completed_at');
      t.integer('initiated_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
      t.unique(['template_id', 'candidate_id']);
      t.unique(['template_id', 'employee_id']);
    });
    await knex.raw(`
      CREATE TRIGGER checklist_instances_one_subject
      BEFORE INSERT ON checklist_instances
      FOR EACH ROW WHEN (NEW.candidate_id IS NULL) = (NEW.employee_id IS NULL)
      BEGIN SELECT RAISE(ABORT, 'checklist_instances needs exactly one of candidate_id / employee_id'); END;
    `);
  }

  if (!(await knex.schema.hasTable('checklist_instance_items'))) {
    await knex.schema.createTable('checklist_instance_items', (t) => {
      t.increments('id').primary();
      t.integer('instance_id').unsigned().notNullable().references('id').inTable('checklist_instances').onDelete('CASCADE');
      t.integer('template_item_id').unsigned().references('id').inTable('checklist_template_items').onDelete('SET NULL');
      t.string('category', 40).notNullable().defaultTo('General');
      t.string('label', 200).notNullable();
      t.boolean('is_completed').notNullable().defaultTo(false);
      t.timestamp('completed_at');
      t.integer('completed_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.string('document_url', 500);   // only when the template supports documents
      t.string('document_name', 255);
      t.text('note');
      t.integer('sort_order').notNullable().defaultTo(0);
      t.timestamps(true, true);
      t.index(['instance_id', 'is_completed']);
    });
  }

  // ── Seed the three phase templates ───────────────────────────────────────────
  const templates: Array<[string, string, string, boolean, string[]]> = [
    ['document_collection', 'Document Collection', 'document_collection', true, DOCUMENT_COLLECTION_ITEMS],
    ['pre_joining', 'Pre-joining Formalities', 'pre_joining', true, PRE_JOINING_ITEMS],
    ['joining_day', 'Joining Day', 'joining', false, JOINING_DAY_ITEMS],
  ];
  for (const [key, name, phase, supportsDocs, items] of templates) {
    const existing = await knex('checklist_templates').where('key', key).first();
    if (existing) continue;
    const [templateId] = await knex('checklist_templates').insert({
      key, name, phase, supports_documents: supportsDocs, is_active: true,
    });
    await knex('checklist_template_items').insert(
      items.map((label, i) => ({ template_id: templateId, label, sort_order: i, category: 'General', is_active: true })),
    );
  }

  // ── One offer letter, issued at Offer Release (before the employee exists) ────
  // The old table was employee_id NOT NULL, so a letter could only exist after
  // acceptance. SQLite cannot drop a NOT NULL, so rebuild. Verified empty first —
  // if a row ever exists we refuse rather than silently discard an issued offer.
  if (await knex.schema.hasTable('offer_letters')) {
    const [{ n }] = await knex('offer_letters').count({ n: '*' });
    if (Number(n) > 0) {
      throw new Error(`071: offer_letters has ${n} row(s); migrate them before rebuilding the table.`);
    }
    await knex.schema.dropTable('offer_letters');
  }
  await knex.schema.createTable('offer_letters', (t) => {
    t.increments('id').primary();
    t.integer('candidate_id').unsigned().references('id').inTable('candidates').onDelete('CASCADE');
    t.integer('employee_id').unsigned().references('id').inTable('employees').onDelete('SET NULL'); // set on acceptance
    t.json('template_data').notNullable();       // designation, salary, joining_date, base_gross, adjustment_pct, breakdown
    t.decimal('offered_base', 12, 2);
    t.decimal('offered_ctc', 14, 2);
    t.decimal('offer_adjustment_pct', 6, 2);
    t.string('status', 20).notNullable().defaultTo('issued'); // issued | accepted | declined
    t.string('pdf_url', 500);
    t.timestamp('issued_at').defaultTo(knex.fn.now());
    t.integer('issued_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('responded_at');
    t.timestamps(true, true);
    t.unique(['candidate_id']);
  });

  // ── Candidate stage vocabulary ───────────────────────────────────────────────
  // No accepted offers exist, so 'offered' maps wholly to 'offer_released'; the
  // employee_id branch is kept for safety if this runs against other data.
  const stageMap: Array<[string, string]> = [
    ['screening', 'applied'],
    ['interview', 'interview'],
    ['shortlisted', 'selected'],
    ['rejected', 'rejected'],
  ];
  for (const [from, to] of stageMap) {
    if (from !== to) await knex('candidates').where('stage', from).update({ stage: to });
  }
  await knex('candidates').where('stage', 'offered').whereNotNull('employee_id').update({ stage: 'offer_accepted' });
  await knex('candidates').where('stage', 'offered').update({ stage: 'offer_released' });

  // ── Vacancy status vocabulary: an existing open vacancy is a live job listing ──
  await knex('vacancies').where('status', 'open').update({ status: 'listed' });

  // ── Onboarding's checklist is superseded by the generalized one ──────────────
  // Both tables are empty (verified); migrate any rows rather than drop them blind.
  if (await knex.schema.hasTable('onboarding_checklists')) {
    const [{ n }] = await knex('onboarding_items').count({ n: '*' });
    const [{ c }] = await knex('onboarding_checklists').count({ c: '*' });
    if (Number(n) > 0 || Number(c) > 0) {
      const template = await knex('checklist_templates').where('key', 'document_collection').first();
      for (const cl of await knex('onboarding_checklists').select('*')) {
        const [instanceId] = await knex('checklist_instances').insert({
          template_id: template.id, employee_id: cl.employee_id, status: cl.status || 'pending',
          created_at: cl.created_at, updated_at: cl.updated_at,
        });
        const items = await knex('onboarding_items').where('checklist_id', cl.id).select('*');
        if (items.length) {
          await knex('checklist_instance_items').insert(items.map((it: any, i: number) => ({
            instance_id: instanceId, label: it.item_name, is_completed: !!it.is_completed,
            completed_at: it.completed_at, completed_by: it.verified_by,
            document_url: it.document_url, document_name: it.document_name, sort_order: i,
          })));
        }
      }
    }
    await knex.schema.dropTableIfExists('onboarding_items');
    await knex.schema.dropTableIfExists('onboarding_checklists');
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('candidates').where('stage', 'applied').update({ stage: 'screening' });
  await knex('candidates').where('stage', 'selected').update({ stage: 'shortlisted' });
  await knex('candidates').whereIn('stage', ['document_collection', 'offer_released', 'offer_accepted', 'pre_joining', 'joining', 'transferred']).update({ stage: 'offered' });
  await knex('candidates').whereIn('stage', ['offer_declined', 'no_show']).update({ stage: 'rejected' });
  await knex('vacancies').whereIn('status', ['listed', 'new_role']).update({ status: 'open' });

  await knex.schema.dropTableIfExists('checklist_instance_items');
  await knex.raw('DROP TRIGGER IF EXISTS checklist_instances_one_subject');
  await knex.schema.dropTableIfExists('checklist_instances');
  await knex.schema.dropTableIfExists('checklist_template_items');
  await knex.schema.dropTableIfExists('checklist_templates');

  await knex.schema.dropTableIfExists('offer_letters');
  await knex.schema.createTable('offer_letters', (t) => {
    t.increments('id').primary();
    t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.json('template_data').notNullable();
    t.string('pdf_url', 500);
    t.timestamp('generated_at').defaultTo(knex.fn.now());
    t.integer('generated_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    t.timestamps(true, true);
  });

  if (!(await knex.schema.hasTable('onboarding_checklists'))) {
    await knex.schema.createTable('onboarding_checklists', (t) => {
      t.increments('id').primary();
      t.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
      t.string('status', 20).defaultTo('pending');
      t.timestamps(true, true);
    });
    await knex.schema.createTable('onboarding_items', (t) => {
      t.increments('id').primary();
      t.integer('checklist_id').unsigned().notNullable().references('id').inTable('onboarding_checklists').onDelete('CASCADE');
      t.string('item_name', 100).notNullable();
      t.boolean('is_completed').defaultTo(false);
      t.string('document_url', 500);
      t.string('document_name', 255);
      t.timestamp('completed_at');
      t.integer('verified_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
      t.timestamps(true, true);
    });
  }
}
