import type { Knex } from 'knex';

/**
 * Seeds plausible dummy financial (bank) details for active employees that don't
 * have any yet. Values are derived deterministically from the employee id so the
 * data is stable across runs. Idempotent: existing rows are left untouched.
 */
const BANKS = [
  { code: 'HDFC', branch: 'HDFC Bank, Connaught Place' },
  { code: 'ICIC', branch: 'ICICI Bank, Gurugram Sec 29' },
  { code: 'SBIN', branch: 'State Bank of India, Hauz Khas' },
  { code: 'UTIB', branch: 'Axis Bank, Nehru Place' },
  { code: 'KKBK', branch: 'Kotak Mahindra, Saket' },
  { code: 'PUNB', branch: 'Punjab National Bank, Karol Bagh' },
];
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const letter = (n: number) => A[Math.abs(n) % 26];

function pan(id: number) {
  return (
    letter(id * 2) + letter(id * 3) + letter(id * 5) + letter(id * 7) + letter(id * 11) +
    String(1000 + (id * 37) % 9000) +
    letter(id * 13)
  );
}

export async function seed(knex: Knex): Promise<void> {
  const existing = await knex('employee_bank_details').pluck('employee_id');
  const employees = await knex('employees')
    .where('is_active', true)
    .whereNotIn('id', existing.length ? existing : [0])
    .select('id', 'first_name', 'last_name');

  const rows = employees.map((e: any) => {
    const bank = BANKS[e.id % BANKS.length];
    const name = `${e.first_name} ${e.last_name}`.trim();
    return {
      employee_id: e.id,
      account_name: name,
      name_as_per_uid: name,
      bank_account_number: String(50000000000 + e.id * 7919).slice(0, 14),
      pan_card: pan(e.id),
      ifsc_code: `${bank.code}0${String(100000 + (e.id * 131) % 900000)}`,
      branch_name: bank.branch,
      payment_mode: 'Bank Transfer',
    };
  });

  if (rows.length) await knex('employee_bank_details').insert(rows);
}
