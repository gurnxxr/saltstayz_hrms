import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('employee_bank_details', (table) => {
    table.increments('id').primary();
    table.integer('employee_id').unsigned().notNullable().unique()
      .references('id').inTable('employees').onDelete('CASCADE');
    table.string('account_name', 150).notNullable();
    table.string('name_as_per_uid', 150).notNullable();
    table.string('bank_account_number', 30).notNullable();
    table.string('pan_card', 10).notNullable();
    table.string('ifsc_code', 11).notNullable();
    table.string('branch_name', 150).notNullable();
    table.string('payment_mode', 30).notNullable().defaultTo('Bank Transfer');
    table.timestamps(true, true);
  });

  // Add 'finance' module permissions if they don't exist yet
  const existing = await knex('permissions').where({ module: 'finance', action: 'read' }).first();
  if (!existing) {
    const actions = ['create', 'read', 'update', 'delete'];
    for (const action of actions) {
      await knex('permissions').insert({ module: 'finance', action });
    }

    const perms = await knex('permissions').where('module', 'finance');
    const permMap: Record<string, number> = {};
    perms.forEach((p: any) => { permMap[p.action] = p.id; });

    const adminRole = await knex('roles').where('name', 'admin').first();
    const chroRole = await knex('roles').where('name', 'chro').first();
    const hrRole = await knex('roles').where('name', 'hr').first();
    const financeRole = await knex('roles').where('name', 'finance').first();

    const rpRows: { role_id: number; permission_id: number }[] = [];

    for (const action of actions) {
      if (adminRole) rpRows.push({ role_id: adminRole.id, permission_id: permMap[action] });
      if (chroRole) rpRows.push({ role_id: chroRole.id, permission_id: permMap[action] });
      if (hrRole) rpRows.push({ role_id: hrRole.id, permission_id: permMap[action] });
      if (financeRole) rpRows.push({ role_id: financeRole.id, permission_id: permMap[action] });
    }

    if (rpRows.length) await knex('role_permissions').insert(rpRows);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('employee_bank_details');
  const perms = await knex('permissions').where('module', 'finance');
  const permIds = perms.map((p: any) => p.id);
  if (permIds.length) {
    await knex('role_permissions').whereIn('permission_id', permIds).del();
    await knex('permissions').whereIn('id', permIds).del();
  }
}
