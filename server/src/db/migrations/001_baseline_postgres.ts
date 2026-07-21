import type { Knex } from 'knex';

// PostgreSQL baseline schema — squashed from the 82 SQLite migrations (kept in migrations/archive/
// for reference). Generated from the live schema, then reviewed. Date/time columns are TEXT by
// design: the app stores and compares them as strings and slices them with substr().

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('account', (t) => {
    t.increments('id');
    t.text('accountId').notNullable();
    t.text('providerId').notNullable();
    t.integer('userId').notNullable();
    t.text('accessToken');
    t.text('refreshToken');
    t.text('idToken');
    t.timestamp('accessTokenExpiresAt', { useTz: true });
    t.timestamp('refreshTokenExpiresAt', { useTz: true });
    t.text('scope');
    t.text('password');
    t.timestamp('createdAt', { useTz: true }).notNullable();
    t.timestamp('updatedAt', { useTz: true }).notNullable();
  });
  await knex.schema.createTable('asset_assignments', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('asset_type_id').notNullable();
    t.string('identifier', 120);
    t.text('assigned_date').notNullable();
    t.integer('assigned_by');
    t.string('status', 12).notNullable().defaultTo('assigned');
    t.text('returned_date');
    t.integer('returned_collected_by');
    t.integer('exit_interview_id');
    t.text('note');
    t.text('condition_note');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('asset_types', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.string('category', 40).notNullable().defaultTo('Other');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('attendance_records', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('date').notNullable();
    t.text('check_in');
    t.text('check_out');
    t.string('status', 20).defaultTo('present');
    t.float('working_hours');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('location', 150);
    t.boolean('is_regularised').notNullable().defaultTo(false);
  });
  await knex.schema.createTable('attendance_regularisations', (t) => {
    t.increments('id');
    t.integer('attendance_id');
    t.integer('employee_id').notNullable();
    t.text('requested_check_in');
    t.text('requested_check_out');
    t.text('reason');
    t.string('status', 20).defaultTo('pending');
    t.integer('approved_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('date');
    t.string('applied_status', 20);
    t.text('reviewer_comment');
    t.text('decided_at');
    t.string('requested_status', 20);
    t.text('end_date');
  });
  await knex.schema.createTable('attendance_upload_logs', (t) => {
    t.increments('id');
    t.integer('uploaded_by');
    t.string('uploaded_by_email', 255);
    t.string('file_name', 255);
    t.integer('rows_total').notNullable().defaultTo(0);
    t.integer('rows_created').notNullable().defaultTo(0);
    t.integer('rows_updated').notNullable().defaultTo(0);
    t.integer('rows_skipped').notNullable().defaultTo(0);
    t.integer('unmatched_count').notNullable().defaultTo(0);
    t.string('date_from', 10);
    t.string('date_to', 10);
    t.integer('dates_count').notNullable().defaultTo(0);
    t.text('locations');
    t.string('status', 12).notNullable().defaultTo('success');
    t.text('error_note');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id');
    t.integer('user_id');
    t.string('actor_email', 160);
    t.string('actor_role', 40);
    t.string('action', 40).notNullable();
    t.string('module', 60).notNullable();
    t.string('entity', 60);
    t.string('target_id', 60);
    t.string('method', 8).notNullable();
    t.string('path', 255).notNullable();
    t.integer('status_code');
    t.string('summary', 255);
    t.text('metadata');
    t.string('ip_address', 60);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('biometric_api_keys', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.string('key_hash', 255).notNullable();
    t.string('key_prefix', 8).notNullable();
    t.boolean('is_active').defaultTo(true);
    t.string('allowed_ips', 500);
    t.text('last_used_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('biometric_devices', (t) => {
    t.increments('id');
    t.string('serial_number', 100).notNullable();
    t.string('name', 100);
    t.string('location', 200);
    t.boolean('is_active').defaultTo(true);
    t.text('last_seen_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('biometric_logs', (t) => {
    t.increments('id');
    t.string('employee_code', 20).notNullable();
    t.integer('employee_id');
    t.text('log_datetime').notNullable();
    t.string('log_time', 8).notNullable();
    t.string('device_sn', 100).notNullable();
    t.text('downloaded_at');
    t.string('status', 20).defaultTo('pending');
    t.boolean('is_processed').defaultTo(false);
    t.string('processing_error', 255);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('candidate_history', (t) => {
    t.increments('id');
    t.integer('candidate_id').notNullable();
    t.string('from_stage', 50).notNullable();
    t.string('to_stage', 50).notNullable();
    t.text('notes');
    t.integer('changed_by').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('candidates', (t) => {
    t.increments('id');
    t.integer('vacancy_id').notNullable();
    t.string('name', 200).notNullable();
    t.string('email', 255);
    t.string('phone', 15);
    t.string('resume_url', 500);
    t.string('stage', 20).defaultTo('screening');
    t.text('notes');
    t.integer('added_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('archived').notNullable().defaultTo(false);
    t.integer('employee_id');
    t.string('offer_status', 20);
    t.text('offer_data');
    t.text('offer_generated_at');
    t.integer('offer_generated_by');
    t.text('offer_responded_at');
    t.string('address', 500);
  });
  await knex.schema.createTable('checklist_instance_items', (t) => {
    t.increments('id');
    t.integer('instance_id').notNullable();
    t.integer('template_item_id');
    t.string('category', 40).notNullable().defaultTo('General');
    t.string('label', 200).notNullable();
    t.boolean('is_completed').notNullable().defaultTo(false);
    t.text('completed_at');
    t.integer('completed_by');
    t.string('document_url', 500);
    t.string('document_name', 255);
    t.text('note');
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('checklist_instances', (t) => {
    t.increments('id');
    t.integer('template_id').notNullable();
    t.integer('candidate_id');
    t.integer('employee_id');
    t.string('status', 20).notNullable().defaultTo('pending');
    t.text('completed_at');
    t.integer('initiated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('checklist_template_items', (t) => {
    t.increments('id');
    t.integer('template_id').notNullable();
    t.string('category', 40).notNullable().defaultTo('General');
    t.string('label', 200).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('checklist_templates', (t) => {
    t.increments('id');
    t.string('key', 40).notNullable();
    t.string('name', 100).notNullable();
    t.string('phase', 40);
    t.boolean('supports_documents').notNullable().defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('clusters', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.text('description');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('departments', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.integer('property_id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.float('working_hours_per_day');
  });
  await knex.schema.createTable('designation_salary_structures', (t) => {
    t.increments('id');
    t.integer('job_title_id').notNullable();
    t.float('gross').notNullable().defaultTo(0);
    t.string('city', 80).defaultTo('Haryana');
    t.float('pct_basic').notNullable().defaultTo(50);
    t.float('pct_hra').notNullable().defaultTo(50);
    t.float('pct_employee_pf').notNullable().defaultTo(12);
    t.float('pct_esi').notNullable().defaultTo(0.75);
    t.float('pct_employer_pf').notNullable().defaultTo(12);
    t.float('pct_gratuity').notNullable().defaultTo(4.81);
    t.float('pct_employer_esi').notNullable().defaultTo(3.25);
    t.float('pli').defaultTo(0);
    t.float('lwf_employee');
    t.float('lwf_employer');
    t.float('meal').defaultTo(0);
    t.float('accommodation').defaultTo(0);
    t.float('accommodation_allowance').defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_bank_details', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('account_name', 150).notNullable();
    t.string('name_as_per_uid', 150).notNullable();
    t.string('bank_account_number', 30).notNullable();
    t.string('pan_card', 10).notNullable();
    t.string('ifsc_code', 11).notNullable();
    t.string('branch_name', 150).notNullable();
    t.string('payment_mode', 30).notNullable().defaultTo('Bank Transfer');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_categories', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_esi_periods', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('period_key', 12).notNullable();
    t.boolean('covered').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_exits', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('exit_date').notNullable();
    t.string('exit_reason', 50).notNullable();
    t.text('exit_details');
    t.integer('tenure_months');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_module_access', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('module', 50).notNullable();
    t.boolean('allowed').notNullable().defaultTo(true);
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_promotions', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('promotion_date').notNullable();
    t.integer('from_job_title_id');
    t.integer('to_job_title_id').notNullable();
    t.float('from_base');
    t.float('to_base');
    t.text('note');
    t.integer('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_qualifications', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('type', 50).notNullable();
    t.string('name', 200).notNullable();
    t.text('details');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_shift_assignments', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('shift_type_id').notNullable();
    t.integer('assigned_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_shift_change_requests', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('date').notNullable();
    t.integer('from_shift_type_id');
    t.string('from_day_type', 20).notNullable().defaultTo('working');
    t.integer('to_shift_type_id');
    t.string('to_day_type', 20).notNullable().defaultTo('working');
    t.text('reason');
    t.string('status', 20).notNullable().defaultTo('pending');
    t.integer('reviewed_by');
    t.text('review_note');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_status_history', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('from_status', 20);
    t.string('to_status', 20).notNullable();
    t.float('monthly_ctc');
    t.text('effective_date');
    t.text('last_working_day');
    t.text('reason');
    t.integer('changed_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_transfers', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('transfer_date').notNullable();
    t.string('from_branch', 150);
    t.string('to_branch', 150);
    t.string('from_dept', 150);
    t.string('to_dept', 150);
    t.text('note');
    t.integer('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employee_upload_logs', (t) => {
    t.increments('id');
    t.integer('uploaded_by');
    t.string('uploaded_by_email', 255);
    t.string('file_name', 255);
    t.integer('rows_total').notNullable().defaultTo(0);
    t.integer('rows_created').notNullable().defaultTo(0);
    t.integer('rows_updated').notNullable().defaultTo(0);
    t.integer('rows_skipped').notNullable().defaultTo(0);
    t.text('errors');
    t.string('status', 12).notNullable().defaultTo('success');
    t.text('error_note');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('employees', (t) => {
    t.increments('id');
    t.string('employee_code', 20).notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('email', 255);
    t.string('phone', 15);
    t.text('date_of_birth');
    t.text('date_of_joining').notNullable();
    t.integer('job_title_id');
    t.integer('reporting_manager_id');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('father_name', 100);
    t.string('aadhaar_number', 12);
    t.string('dept_name', 100);
    t.string('branch_name', 100);
    t.float('offered_base');
    t.float('offered_ctc');
    t.float('offer_adjustment_pct');
    t.string('employment_status', 20).notNullable().defaultTo('active');
    t.float('monthly_ctc');
    t.text('last_working_day');
    t.text('pip_start_date');
    t.text('pip_end_date');
    t.text('status_reason');
    t.boolean('open_to_backfill').notNullable().defaultTo(false);
    t.integer('created_by_user_id');
    t.integer('approved_by_user_id');
    t.float('sanction_variance');
    t.string('job_id', 20);
    t.string('gender', 10);
    t.text('probation_end_date');
  });
  await knex.schema.createTable('employment_statuses', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('exit_interviews', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.text('interview_date').notNullable();
    t.string('status', 12).notNullable().defaultTo('scheduled');
    t.string('reason_for_leaving', 60);
    t.integer('overall_rating');
    t.boolean('would_recommend');
    t.text('feedback');
    t.text('suggestions');
    t.integer('interviewer_id');
    t.integer('created_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('holidays', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.text('date').notNullable();
    t.integer('property_id');
    t.boolean('is_recurring').defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('region_id');
    t.boolean('is_national').defaultTo(false);
    t.string('state', 100);
  });
  await knex.schema.createTable('job_titles', (t) => {
    t.increments('id');
    t.string('title', 100).notNullable();
    t.text('description');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
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
  await knex.schema.createTable('leave_entitlements', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('leave_type_id').notNullable();
    t.integer('leave_period_id').notNullable();
    t.float('total_days').notNullable();
    t.float('used_days').defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('leave_periods', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.text('start_date').notNullable();
    t.text('end_date').notNullable();
    t.boolean('is_current').defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('leave_requests', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('leave_type_id').notNullable();
    t.text('start_date').notNullable();
    t.text('end_date').notNullable();
    t.float('days').notNullable();
    t.text('reason');
    t.string('status', 20).defaultTo('pending');
    t.integer('approved_by');
    t.text('rejection_reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('leave_type_conflicts', (t) => {
    t.increments('id');
    t.integer('leave_type_id').notNullable();
    t.integer('conflict_leave_type_id').notNullable();
  });
  await knex.schema.createTable('leave_type_departments', (t) => {
    t.increments('id');
    t.integer('leave_type_id').notNullable();
    t.integer('department_id').notNullable();
  });
  await knex.schema.createTable('leave_types', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.integer('default_days').notNullable();
    t.boolean('is_paid').defaultTo(true);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.boolean('is_encashable').notNullable().defaultTo(false);
    t.integer('min_days_per_request');
    t.integer('max_days_per_request');
    t.integer('advance_notice_days');
    t.boolean('half_day_allowed').notNullable().defaultTo(true);
    t.integer('document_required_after_days');
    t.string('eligibility', 10).notNullable().defaultTo('any');
    t.boolean('after_probation_only').notNullable().defaultTo(false);
    t.boolean('count_sandwich_days').notNullable().defaultTo(false);
  });
  await knex.schema.createTable('manpower_exceptions', (t) => {
    t.increments('id');
    t.integer('property_id').notNullable();
    t.integer('job_title_id').notNullable();
    t.integer('requested_by');
    t.string('candidate_name', 150).notNullable();
    t.float('requested_ctc').notNullable();
    t.string('exception_type', 20).notNullable();
    t.float('band_min');
    t.float('band_max');
    t.float('sanctioned_budget_monthly');
    t.float('committed_amount');
    t.float('remaining_budget');
    t.integer('sanctioned_headcount');
    t.integer('non_left_headcount');
    t.float('suggested_ctc');
    t.float('variance_amount');
    t.text('join_date');
    t.text('request_reason');
    t.string('status', 12).notNullable().defaultTo('pending');
    t.text('admin_note');
    t.integer('reviewed_by');
    t.text('reviewed_at');
    t.integer('created_employee_id');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('manpower_property_budgets', (t) => {
    t.increments('id');
    t.integer('property_id').notNullable();
    t.float('sanctioned_budget_monthly').notNullable().defaultTo(0);
    t.integer('sanctioned_headcount').notNullable().defaultTo(0);
    t.text('notes');
    t.integer('created_by');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('manpower_sanctions', (t) => {
    t.increments('id');
    t.integer('property_id').notNullable();
    t.integer('job_title_id').notNullable();
    t.integer('sanctioned_headcount').notNullable().defaultTo(0);
    t.float('sanctioned_budget_monthly').notNullable().defaultTo(0);
    t.float('band_min').notNullable().defaultTo(0);
    t.float('band_max').notNullable().defaultTo(0);
    t.boolean('is_locked').notNullable().defaultTo(false);
    t.text('notes');
    t.integer('created_by');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('notifications', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable();
    t.string('type', 40).notNullable().defaultTo('info');
    t.string('title', 160).notNullable();
    t.text('message');
    t.string('link', 255);
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('offboarding_cases', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.string('status', 20).notNullable().defaultTo('initiated');
    t.string('exit_type', 30).notNullable().defaultTo('resignation');
    t.text('reason');
    t.text('resignation_date');
    t.text('last_working_day').notNullable();
    t.integer('notice_period_days').defaultTo(0);
    t.text('exit_interview_notes');
    t.float('fnf_amount');
    t.text('fnf_details');
    t.integer('initiated_by');
    t.text('completed_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('offboarding_items', (t) => {
    t.increments('id');
    t.integer('case_id').notNullable();
    t.string('category', 40).notNullable().defaultTo('General');
    t.string('item_name', 200).notNullable();
    t.boolean('is_completed').defaultTo(false);
    t.text('completed_at');
    t.integer('verified_by');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('offer_letters', (t) => {
    t.increments('id');
    t.integer('candidate_id');
    t.integer('employee_id');
    t.text('template_data').notNullable();
    t.float('offered_base');
    t.float('offered_ctc');
    t.float('offer_adjustment_pct');
    t.string('status', 20).notNullable().defaultTo('issued');
    t.string('pdf_url', 500);
    t.text('issued_at').defaultTo(knex.raw("to_char(now(), 'YYYY-MM-DD HH24:MI:SS')"));
    t.integer('issued_by');
    t.text('responded_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('pay_grades', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.float('min_salary');
    t.float('max_salary');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('pay_schedule_settings', (t) => {
    t.increments('id');
    t.text('work_week').notNullable().defaultTo('[1,2,3,4,5]');
    t.string('salary_calculation_method', 20).notNullable().defaultTo('actual_days');
    t.integer('fixed_working_days').notNullable().defaultTo(30);
    t.string('pay_date_type', 20).notNullable().defaultTo('last_day');
    t.integer('pay_date_day').notNullable().defaultTo(1);
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    t.string('unmarked_day_policy', 10).notNullable().defaultTo('present');
    t.boolean('holidays_paid').notNullable().defaultTo(true);
    t.float('overtime_multiplier').notNullable().defaultTo(2);
    t.integer('grace_minutes').notNullable().defaultTo(15);
    t.float('standard_day_hours').notNullable().defaultTo(8);
    t.integer('miss_punch_allowance').notNullable().defaultTo(3);
    t.float('miss_punch_lop').notNullable().defaultTo(0.5);
    t.float('short_punch_lop').notNullable().defaultTo(0.5);
    t.integer('attendance_gate_pct').notNullable().defaultTo(10);
  });
  await knex.schema.createTable('payroll_adjustments', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('month').notNullable();
    t.integer('year').notNullable();
    t.float('lop_override');
    t.float('adjustment_amount').notNullable().defaultTo(0);
    t.string('adjustment_label', 120);
    t.text('note');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('payroll_runs', (t) => {
    t.increments('id');
    t.integer('month').notNullable();
    t.integer('year').notNullable();
    t.string('status', 20).notNullable().defaultTo('draft');
    t.integer('employee_count').defaultTo(0);
    t.float('total_net').defaultTo(0);
    t.float('total_ctc').defaultTo(0);
    t.integer('generated_by');
    t.integer('locked_by');
    t.text('locked_at');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('failure_report');
    t.text('register_snapshot');
    t.text('unlocked_at');
    t.integer('unlocked_by');
    t.text('unlock_reason');
  });
  await knex.schema.createTable('payslip_history', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('month').notNullable();
    t.integer('year').notNullable();
    t.text('pay_date');
    t.float('gross_earnings').notNullable();
    t.float('total_deduction').notNullable();
    t.float('net_pay').notNullable();
    t.float('ctc').notNullable();
    t.text('snapshot').notNullable();
    t.integer('generated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('run_id');
  });
  await knex.schema.createTable('payslips', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('month').notNullable();
    t.integer('year').notNullable();
    t.integer('salary_structure_id').notNullable();
    t.integer('days_worked');
    t.integer('days_absent');
    t.float('amount_paid').notNullable();
    t.string('pdf_url', 500);
    t.string('status', 20).defaultTo('draft');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('module', 50).notNullable();
    t.string('action', 50).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('properties', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.text('address');
    t.string('city', 100);
    t.string('state', 100);
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('hotel_id', 50);
    t.string('category', 100);
    t.integer('cluster_id');
    t.integer('region_id');
  });
  await knex.schema.createTable('property_categories', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('property_department_workers', (t) => {
    t.increments('id');
    t.integer('property_id').notNullable();
    t.string('department', 100).notNullable();
    t.integer('worker_count').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('regions', (t) => {
    t.increments('id');
    t.string('name', 100).notNullable();
    t.text('description');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').notNullable();
    t.integer('permission_id').notNullable();
    t.primary(['role_id', 'permission_id']);
  });
  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.text('description');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('salary_components', (t) => {
    t.increments('id');
    t.string('category', 20).notNullable();
    t.string('name', 150).notNullable();
    t.string('name_in_payslip', 150).notNullable();
    t.string('status', 12).notNullable().defaultTo('active');
    t.integer('is_system').notNullable().defaultTo(0);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.text('config').notNullable().defaultTo('{}');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('salary_setup', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.float('gross').notNullable();
    t.string('city', 80).defaultTo('Delhi');
    t.float('pli').defaultTo(0);
    t.float('meal').defaultTo(0);
    t.float('accommodation').defaultTo(0);
    t.float('accommodation_allowance').defaultTo(0);
    t.float('lwf_employee');
    t.float('lwf_employer');
    t.text('effective_from');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('salary_structure_assignments', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('structure_id').notNullable();
    t.float('base').notNullable();
    t.text('effective_from');
    t.integer('assigned_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.float('tds_amount').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('salary_structure_components', (t) => {
    t.increments('id');
    t.integer('structure_id').notNullable();
    t.integer('component_id').notNullable();
    t.string('calculation_type', 20).notNullable().defaultTo('flat');
    t.float('value').notNullable().defaultTo(0);
    t.integer('sort_order').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('salary_structures', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.text('description');
    t.integer('job_title_id');
    t.string('payment_basis', 10).notNullable().defaultTo('monthly');
    t.float('default_base').notNullable().defaultTo(0);
    t.string('city', 50).notNullable().defaultTo('Haryana');
    t.boolean('is_active').defaultTo(true);
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('employee_id');
  });
  await knex.schema.createTable('session', (t) => {
    t.increments('id');
    t.timestamp('expiresAt', { useTz: true }).notNullable();
    t.text('token').notNullable();
    t.timestamp('createdAt', { useTz: true }).notNullable();
    t.timestamp('updatedAt', { useTz: true }).notNullable();
    t.text('ipAddress');
    t.text('userAgent');
    t.integer('userId').notNullable();
    t.integer('impersonatedBy');
  });
  await knex.schema.createTable('shift_change_requests', (t) => {
    t.increments('id');
    t.integer('shift_type_id').notNullable();
    t.integer('requested_by').notNullable();
    t.string('field_changed', 50).notNullable();
    t.string('old_value', 50).notNullable();
    t.string('new_value', 50).notNullable();
    t.string('status', 20).defaultTo('pending');
    t.integer('approved_by');
    t.text('reason');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('shift_locations', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('shift_rosters', (t) => {
    t.increments('id');
    t.integer('employee_id').notNullable();
    t.integer('shift_type_id');
    t.text('date').notNullable();
    t.integer('property_id').notNullable();
    t.integer('assigned_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('day_type', 16).notNullable().defaultTo('working');
    t.boolean('is_published').notNullable().defaultTo(false);
    t.text('published_at');
    t.integer('published_by');
  });
  await knex.schema.createTable('shift_schedule_days', (t) => {
    t.increments('id');
    t.integer('shift_schedule_id').notNullable();
    t.integer('day_of_week').notNullable();
  });
  await knex.schema.createTable('shift_schedules', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.integer('shift_type_id').notNullable();
    t.integer('frequency_weeks').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('shift_types', (t) => {
    t.increments('id');
    t.string('name', 50).notNullable();
    t.text('start_time').notNullable();
    t.text('end_time').notNullable();
    t.integer('property_id').notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('holiday_region_id');
    t.string('roster_color', 20).notNullable().defaultTo('Blue');
    t.boolean('enable_auto_attendance').defaultTo(false);
    t.string('determine_checkin_checkout', 20).defaultTo('alternating');
    t.string('working_hours_calculation', 20).defaultTo('first_last');
    t.integer('begin_checkin_before_mins').defaultTo(60);
    t.integer('allow_checkout_after_mins').defaultTo(60);
    t.boolean('mark_auto_attendance_on_holidays').defaultTo(false);
    t.float('half_day_threshold').defaultTo(0);
    t.float('absent_threshold').defaultTo(0);
    t.text('process_attendance_after');
    t.text('last_sync_of_checkin');
    t.boolean('auto_update_last_sync').defaultTo(false);
    t.boolean('enable_late_entry_marking').defaultTo(false);
    t.integer('late_entry_grace_period').defaultTo(0);
    t.boolean('enable_early_exit_marking').defaultTo(false);
    t.integer('early_exit_grace_period').defaultTo(0);
    t.boolean('allow_overtime').defaultTo(false);
    t.string('overtime_type', 100);
  });
  await knex.schema.createTable('state_minimum_wages', (t) => {
    t.increments('id');
    t.string('state', 100).notNullable();
    t.string('category', 50).notNullable().defaultTo('general');
    t.float('monthly_wage').notNullable().defaultTo(0);
    t.text('effective_from');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('statutory_settings', (t) => {
    t.increments('id');
    t.string('component', 30).notNullable();
    t.string('state', 100);
    t.integer('enabled').notNullable().defaultTo(0);
    t.text('config').notNullable().defaultTo('{}');
    t.integer('updated_by');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('user_clusters', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable();
    t.integer('cluster_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('email', 255).notNullable();
    t.string('password_hash', 255).notNullable();
    t.integer('role_id').notNullable();
    t.integer('employee_id');
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('initial_password', 255);
    t.text('name');
    t.boolean('email_verified').notNullable().defaultTo(true);
    t.text('image');
    t.text('role');
    t.boolean('banned').defaultTo(false);
    t.text('banReason');
    t.timestamp('banExpires', { useTz: true });
  });
  await knex.schema.createTable('vacancies', (t) => {
    t.increments('id');
    t.integer('job_title_id').notNullable();
    t.integer('department_id').notNullable();
    t.integer('property_id').notNullable();
    t.integer('positions').notNullable().defaultTo(1);
    t.integer('filled').defaultTo(0);
    t.string('status', 20).defaultTo('open');
    t.text('description');
    t.integer('posted_by').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('jd_data');
    t.integer('reporting_manager_id');
    t.string('backfill_job_id', 20);
  });
  await knex.schema.createTable('verification', (t) => {
    t.increments('id');
    t.text('identifier').notNullable();
    t.text('value').notNullable();
    t.timestamp('expiresAt', { useTz: true }).notNullable();
    t.timestamp('createdAt', { useTz: true });
    t.timestamp('updatedAt', { useTz: true });
  });
  await knex.schema.alterTable('account', (t) => {
    t.foreign('userId').references('id').inTable('users').onDelete('CASCADE');
  });
  await knex.schema.alterTable('asset_assignments', (t) => {
    t.foreign('exit_interview_id').references('id').inTable('exit_interviews').onDelete('SET NULL');
    t.foreign('returned_collected_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('asset_type_id').references('id').inTable('asset_types').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.index(['employee_id', 'status']);
  });
  await knex.schema.alterTable('asset_types', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('attendance_records', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.index(['employee_id', 'date']);
    t.unique(['employee_id', 'date']);
  });
  await knex.schema.alterTable('attendance_regularisations', (t) => {
    t.foreign('approved_by').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.foreign('attendance_id').references('id').inTable('attendance_records').onDelete('CASCADE');
    t.index(['employee_id', 'status']);
  });
  await knex.schema.alterTable('attendance_upload_logs', (t) => {
    t.foreign('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.schema.alterTable('audit_logs', (t) => {
    t.foreign('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.index(['created_at']);
    t.index(['user_id']);
    t.index(['action']);
    t.index(['module']);
  });
  await knex.schema.alterTable('biometric_api_keys', (t) => {
    t.unique(['key_hash']);
  });
  await knex.schema.alterTable('biometric_devices', (t) => {
    t.unique(['serial_number']);
  });
  await knex.schema.alterTable('biometric_logs', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('SET NULL');
    t.unique(['employee_code', 'log_datetime', 'device_sn']);
    t.index(['is_processed']);
    t.index(['employee_code', 'log_datetime']);
  });
  await knex.schema.alterTable('candidate_history', (t) => {
    t.foreign('changed_by').references('id').inTable('users').onDelete('RESTRICT');
    t.foreign('candidate_id').references('id').inTable('candidates').onDelete('CASCADE');
  });
  await knex.schema.alterTable('candidates', (t) => {
    t.foreign('offer_generated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('added_by').references('id').inTable('users').onDelete('RESTRICT');
    t.foreign('vacancy_id').references('id').inTable('vacancies').onDelete('CASCADE');
  });
  await knex.schema.alterTable('checklist_instance_items', (t) => {
    t.foreign('completed_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('template_item_id').references('id').inTable('checklist_template_items').onDelete('SET NULL');
    t.foreign('instance_id').references('id').inTable('checklist_instances').onDelete('CASCADE');
    t.unique(['instance_id', 'template_item_id']);
    t.index(['instance_id', 'is_completed']);
  });
  await knex.schema.alterTable('checklist_instances', (t) => {
    t.foreign('initiated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.foreign('candidate_id').references('id').inTable('candidates').onDelete('CASCADE');
    t.foreign('template_id').references('id').inTable('checklist_templates').onDelete('RESTRICT');
    t.unique(['template_id', 'employee_id']);
    t.unique(['template_id', 'candidate_id']);
  });
  await knex.schema.alterTable('checklist_template_items', (t) => {
    t.foreign('template_id').references('id').inTable('checklist_templates').onDelete('CASCADE');
  });
  await knex.schema.alterTable('checklist_templates', (t) => {
    t.unique(['key']);
  });
  await knex.schema.alterTable('clusters', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('departments', (t) => {
    t.foreign('property_id').references('id').inTable('properties').onDelete('SET NULL');
    t.unique(['name']);
  });
  await knex.schema.alterTable('designation_salary_structures', (t) => {
    t.foreign('job_title_id').references('id').inTable('job_titles').onDelete('CASCADE');
    t.unique(['job_title_id']);
  });
  await knex.schema.alterTable('employee_bank_details', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('employee_categories', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('employee_esi_periods', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'period_key']);
  });
  await knex.schema.alterTable('employee_exits', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('employee_module_access', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'module']);
  });
  await knex.schema.alterTable('employee_promotions', (t) => {
    t.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('employee_qualifications', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('employee_shift_assignments', (t) => {
    t.foreign('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('shift_type_id').references('id').inTable('shift_types').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('employee_shift_change_requests', (t) => {
    t.foreign('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('to_shift_type_id').references('id').inTable('shift_types').onDelete('SET NULL');
    t.foreign('from_shift_type_id').references('id').inTable('shift_types').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.index(['status']);
    t.index(['employee_id', 'status']);
  });
  await knex.schema.alterTable('employee_status_history', (t) => {
    t.foreign('changed_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('employee_transfers', (t) => {
    t.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('employee_upload_logs', (t) => {
    t.foreign('uploaded_by').references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.schema.alterTable('employees', (t) => {
    t.foreign('approved_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('created_by_user_id').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('reporting_manager_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('job_title_id').references('id').inTable('job_titles').onDelete('SET NULL');
    t.unique(['job_id']);
    t.unique(['employee_code']);
  });
  await knex.schema.alterTable('employment_statuses', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('exit_interviews', (t) => {
    t.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('interviewer_id').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('holidays', (t) => {
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
  });
  await knex.schema.alterTable('leave_encashments', (t) => {
    t.foreign('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('requested_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('leave_period_id').references('id').inTable('leave_periods').onDelete('RESTRICT');
    t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('leave_entitlements', (t) => {
    t.foreign('leave_period_id').references('id').inTable('leave_periods').onDelete('CASCADE');
    t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('CASCADE');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'leave_type_id', 'leave_period_id']);
  });
  await knex.schema.alterTable('leave_requests', (t) => {
    t.foreign('approved_by').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
  });
  await knex.schema.alterTable('leave_type_conflicts', (t) => {
    t.foreign('conflict_leave_type_id').references('id').inTable('leave_types').onDelete('CASCADE');
    t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('CASCADE');
    t.unique(['leave_type_id', 'conflict_leave_type_id']);
  });
  await knex.schema.alterTable('leave_type_departments', (t) => {
    t.foreign('department_id').references('id').inTable('departments').onDelete('CASCADE');
    t.foreign('leave_type_id').references('id').inTable('leave_types').onDelete('CASCADE');
    t.unique(['leave_type_id', 'department_id']);
  });
  await knex.schema.alterTable('manpower_exceptions', (t) => {
    t.foreign('created_employee_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('requested_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('job_title_id').references('id').inTable('job_titles').onDelete('CASCADE');
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
  });
  await knex.schema.alterTable('manpower_property_budgets', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
    t.unique(['property_id']);
  });
  await knex.schema.alterTable('manpower_sanctions', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('job_title_id').references('id').inTable('job_titles').onDelete('CASCADE');
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
    t.unique(['property_id', 'job_title_id']);
  });
  await knex.schema.alterTable('notifications', (t) => {
    t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.index(['user_id', 'created_at']);
    t.index(['user_id', 'is_read']);
  });
  await knex.schema.alterTable('offboarding_cases', (t) => {
    t.foreign('initiated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('offboarding_items', (t) => {
    t.foreign('verified_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('case_id').references('id').inTable('offboarding_cases').onDelete('CASCADE');
  });
  await knex.schema.alterTable('offer_letters', (t) => {
    t.foreign('issued_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('candidate_id').references('id').inTable('candidates').onDelete('CASCADE');
    t.unique(['candidate_id']);
  });
  await knex.schema.alterTable('pay_schedule_settings', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.schema.alterTable('payroll_adjustments', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'month', 'year']);
  });
  await knex.schema.alterTable('payroll_runs', (t) => {
    t.foreign('locked_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('generated_by').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['month', 'year']);
  });
  await knex.schema.alterTable('payslip_history', (t) => {
    t.foreign('run_id').references('id').inTable('payroll_runs').onDelete('SET NULL');
    t.foreign('generated_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'month', 'year']);
  });
  await knex.schema.alterTable('payslips', (t) => {
    t.foreign('salary_structure_id').references('id').inTable('salary_structures').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id', 'month', 'year']);
  });
  await knex.schema.alterTable('permissions', (t) => {
    t.unique(['module', 'action']);
  });
  await knex.schema.alterTable('property_categories', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('property_department_workers', (t) => {
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
    t.unique(['property_id', 'department']);
  });
  await knex.schema.alterTable('regions', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('role_permissions', (t) => {
    t.foreign('permission_id').references('id').inTable('permissions').onDelete('CASCADE');
    t.foreign('role_id').references('id').inTable('roles').onDelete('CASCADE');
  });
  await knex.schema.alterTable('roles', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('salary_components', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
  });
  await knex.schema.alterTable('salary_setup', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('salary_structure_assignments', (t) => {
    t.foreign('assigned_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('structure_id').references('id').inTable('salary_structures').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.unique(['employee_id']);
  });
  await knex.schema.alterTable('salary_structure_components', (t) => {
    t.foreign('component_id').references('id').inTable('salary_components').onDelete('RESTRICT');
    t.foreign('structure_id').references('id').inTable('salary_structures').onDelete('CASCADE');
    t.unique(['structure_id', 'component_id']);
  });
  await knex.schema.alterTable('salary_structures', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['employee_id']);
    t.unique(['job_title_id']);
    t.unique(['name']);
  });
  await knex.schema.alterTable('session', (t) => {
    t.foreign('userId').references('id').inTable('users').onDelete('CASCADE');
    t.unique(['token']);
  });
  await knex.schema.alterTable('shift_change_requests', (t) => {
    t.foreign('approved_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('requested_by').references('id').inTable('users').onDelete('CASCADE');
    t.foreign('shift_type_id').references('id').inTable('shift_types').onDelete('CASCADE');
  });
  await knex.schema.alterTable('shift_locations', (t) => {
    t.unique(['name']);
  });
  await knex.schema.alterTable('shift_rosters', (t) => {
    t.foreign('published_by').references('id').inTable('users').onDelete('SET NULL');
    t.foreign('assigned_by').references('id').inTable('users').onDelete('RESTRICT');
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
    t.foreign('shift_type_id').references('id').inTable('shift_types').onDelete('RESTRICT');
    t.foreign('employee_id').references('id').inTable('employees').onDelete('CASCADE');
    t.index(['property_id', 'date']);
    t.unique(['employee_id', 'date']);
  });
  await knex.schema.alterTable('shift_schedule_days', (t) => {
    t.foreign('shift_schedule_id').references('id').inTable('shift_schedules').onDelete('CASCADE');
    t.unique(['shift_schedule_id', 'day_of_week']);
  });
  await knex.schema.alterTable('shift_schedules', (t) => {
    t.foreign('shift_type_id').references('id').inTable('shift_types').onDelete('RESTRICT');
    t.unique(['name']);
  });
  await knex.schema.alterTable('shift_types', (t) => {
    t.foreign('property_id').references('id').inTable('properties').onDelete('CASCADE');
    t.unique(['name']);
  });
  await knex.schema.alterTable('state_minimum_wages', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['state', 'category']);
  });
  await knex.schema.alterTable('statutory_settings', (t) => {
    t.foreign('updated_by').references('id').inTable('users').onDelete('SET NULL');
    t.unique(['component', 'state']);
  });
  await knex.schema.alterTable('user_clusters', (t) => {
    t.foreign('cluster_id').references('id').inTable('clusters').onDelete('CASCADE');
    t.foreign('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.unique(['user_id', 'cluster_id']);
  });
  await knex.schema.alterTable('users', (t) => {
    t.foreign('employee_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('role_id').references('id').inTable('roles').onDelete('RESTRICT');
    t.unique(['email']);
  });
  await knex.schema.alterTable('vacancies', (t) => {
    t.foreign('reporting_manager_id').references('id').inTable('employees').onDelete('SET NULL');
    t.foreign('posted_by').references('id').inTable('users').onDelete('RESTRICT');
    t.foreign('property_id').references('id').inTable('properties').onDelete('RESTRICT');
    t.foreign('department_id').references('id').inTable('departments').onDelete('RESTRICT');
    t.foreign('job_title_id').references('id').inTable('job_titles').onDelete('RESTRICT');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('verification');
  await knex.schema.dropTableIfExists('vacancies');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('user_clusters');
  await knex.schema.dropTableIfExists('statutory_settings');
  await knex.schema.dropTableIfExists('state_minimum_wages');
  await knex.schema.dropTableIfExists('shift_types');
  await knex.schema.dropTableIfExists('shift_schedules');
  await knex.schema.dropTableIfExists('shift_schedule_days');
  await knex.schema.dropTableIfExists('shift_rosters');
  await knex.schema.dropTableIfExists('shift_locations');
  await knex.schema.dropTableIfExists('shift_change_requests');
  await knex.schema.dropTableIfExists('session');
  await knex.schema.dropTableIfExists('salary_structures');
  await knex.schema.dropTableIfExists('salary_structure_components');
  await knex.schema.dropTableIfExists('salary_structure_assignments');
  await knex.schema.dropTableIfExists('salary_setup');
  await knex.schema.dropTableIfExists('salary_components');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('regions');
  await knex.schema.dropTableIfExists('property_department_workers');
  await knex.schema.dropTableIfExists('property_categories');
  await knex.schema.dropTableIfExists('properties');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('payslips');
  await knex.schema.dropTableIfExists('payslip_history');
  await knex.schema.dropTableIfExists('payroll_runs');
  await knex.schema.dropTableIfExists('payroll_adjustments');
  await knex.schema.dropTableIfExists('pay_schedule_settings');
  await knex.schema.dropTableIfExists('pay_grades');
  await knex.schema.dropTableIfExists('offer_letters');
  await knex.schema.dropTableIfExists('offboarding_items');
  await knex.schema.dropTableIfExists('offboarding_cases');
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.dropTableIfExists('manpower_sanctions');
  await knex.schema.dropTableIfExists('manpower_property_budgets');
  await knex.schema.dropTableIfExists('manpower_exceptions');
  await knex.schema.dropTableIfExists('leave_types');
  await knex.schema.dropTableIfExists('leave_type_departments');
  await knex.schema.dropTableIfExists('leave_type_conflicts');
  await knex.schema.dropTableIfExists('leave_requests');
  await knex.schema.dropTableIfExists('leave_periods');
  await knex.schema.dropTableIfExists('leave_entitlements');
  await knex.schema.dropTableIfExists('leave_encashments');
  await knex.schema.dropTableIfExists('job_titles');
  await knex.schema.dropTableIfExists('holidays');
  await knex.schema.dropTableIfExists('exit_interviews');
  await knex.schema.dropTableIfExists('employment_statuses');
  await knex.schema.dropTableIfExists('employees');
  await knex.schema.dropTableIfExists('employee_upload_logs');
  await knex.schema.dropTableIfExists('employee_transfers');
  await knex.schema.dropTableIfExists('employee_status_history');
  await knex.schema.dropTableIfExists('employee_shift_change_requests');
  await knex.schema.dropTableIfExists('employee_shift_assignments');
  await knex.schema.dropTableIfExists('employee_qualifications');
  await knex.schema.dropTableIfExists('employee_promotions');
  await knex.schema.dropTableIfExists('employee_module_access');
  await knex.schema.dropTableIfExists('employee_exits');
  await knex.schema.dropTableIfExists('employee_esi_periods');
  await knex.schema.dropTableIfExists('employee_categories');
  await knex.schema.dropTableIfExists('employee_bank_details');
  await knex.schema.dropTableIfExists('designation_salary_structures');
  await knex.schema.dropTableIfExists('departments');
  await knex.schema.dropTableIfExists('clusters');
  await knex.schema.dropTableIfExists('checklist_templates');
  await knex.schema.dropTableIfExists('checklist_template_items');
  await knex.schema.dropTableIfExists('checklist_instances');
  await knex.schema.dropTableIfExists('checklist_instance_items');
  await knex.schema.dropTableIfExists('candidates');
  await knex.schema.dropTableIfExists('candidate_history');
  await knex.schema.dropTableIfExists('biometric_logs');
  await knex.schema.dropTableIfExists('biometric_devices');
  await knex.schema.dropTableIfExists('biometric_api_keys');
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('attendance_upload_logs');
  await knex.schema.dropTableIfExists('attendance_regularisations');
  await knex.schema.dropTableIfExists('attendance_records');
  await knex.schema.dropTableIfExists('asset_types');
  await knex.schema.dropTableIfExists('asset_assignments');
  await knex.schema.dropTableIfExists('account');
}
