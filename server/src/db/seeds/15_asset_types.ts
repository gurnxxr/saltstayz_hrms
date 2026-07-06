import type { Knex } from 'knex';

// A starter catalog of company assets so the register is usable out of the box.
// Idempotent by name — admin can add/edit/deactivate items from the UI.
const CATALOG: Array<{ name: string; category: string }> = [
  { name: 'Laptop', category: 'IT Equipment' },
  { name: 'Desktop Computer', category: 'IT Equipment' },
  { name: 'Monitor', category: 'IT Equipment' },
  { name: 'Keyboard & Mouse', category: 'IT Equipment' },
  { name: 'Mobile Phone', category: 'IT Equipment' },
  { name: 'SIM Card', category: 'IT Equipment' },
  { name: 'Headset', category: 'IT Equipment' },
  { name: 'ID Card', category: 'Access & Keys' },
  { name: 'Access Card', category: 'Access & Keys' },
  { name: 'Locker Key', category: 'Access & Keys' },
  { name: 'Uniform', category: 'Uniform' },
  { name: 'Safety Shoes', category: 'Uniform' },
  { name: 'Company Vehicle', category: 'Vehicle' },
  { name: 'Company Credit Card', category: 'Finance' },
];

export async function seed(knex: Knex): Promise<void> {
  for (const item of CATALOG) {
    const exists = await knex('asset_types').whereRaw('lower(name) = ?', [item.name.toLowerCase()]).first();
    if (!exists) await knex('asset_types').insert(item);
  }
}
