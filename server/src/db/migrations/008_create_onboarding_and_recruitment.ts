import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('onboarding_checklists', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.string('status', 20).defaultTo('pending');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('onboarding_items', (table) => {
    table.increments('id').primary();
    table.integer('checklist_id').unsigned().notNullable().references('id').inTable('onboarding_checklists').onDelete('CASCADE');
    table.string('item_name', 100).notNullable();
    table.boolean('is_completed').defaultTo(false);
    table.string('document_url', 500);
    table.timestamp('completed_at', );
    table.integer('verified_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('offer_letters', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().references('id').inTable('employees').onDelete('CASCADE');
    table.json('template_data').notNullable();
    table.string('pdf_url', 500);
    table.timestamp('generated_at', ).defaultTo(knex.fn.now());
    table.integer('generated_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('vacancies', (table) => {
    table.increments('id').primary();
    table.integer('job_title_id').unsigned().notNullable().references('id').inTable('job_titles').onDelete('RESTRICT');
    table.integer('department_id').unsigned().notNullable().references('id').inTable('departments').onDelete('RESTRICT');
    table.integer('property_id').unsigned().notNullable().references('id').inTable('properties').onDelete('RESTRICT');
    table.integer('positions').notNullable().defaultTo(1);
    table.integer('filled').defaultTo(0);
    table.string('status', 20).defaultTo('open');
    table.text('description');
    table.integer('posted_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('candidates', (table) => {
    table.increments('id').primary();
    table.integer('vacancy_id').unsigned().notNullable().references('id').inTable('vacancies').onDelete('CASCADE');
    table.string('name', 200).notNullable();
    table.string('email', 255);
    table.string('phone', 15);
    table.string('resume_url', 500);
    table.string('stage', 20).defaultTo('screening');
    table.text('notes');
    table.integer('added_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('candidate_history', (table) => {
    table.increments('id').primary();
    table.integer('candidate_id').unsigned().notNullable().references('id').inTable('candidates').onDelete('CASCADE');
    table.string('from_stage', 50).notNullable();
    table.string('to_stage', 50).notNullable();
    table.text('notes');
    table.integer('changed_by').unsigned().notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.timestamp('created_at', ).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('candidate_history');
  await knex.schema.dropTableIfExists('candidates');
  await knex.schema.dropTableIfExists('vacancies');
  await knex.schema.dropTableIfExists('offer_letters');
  await knex.schema.dropTableIfExists('onboarding_items');
  await knex.schema.dropTableIfExists('onboarding_checklists');
}
