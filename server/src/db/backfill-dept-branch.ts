import db from '../config/database';

const rows: [string, string, string][] = [
  ['3','Centre','Corporate Office'],['11','Centre','Corporate Office'],['20','Service','Corporate Office'],
  ['200','Centre','Corporate Office'],['260','Centre','Corporate Office'],['324','Centre','Corporate Office'],
  ['360','Centre','Corporate Office'],['567','Centre','Corporate Office'],['586','Centre','Corporate Office'],
  ['746','Centre','Corporate Office'],['823','Centre','Corporate Office'],['1048','Centre','Corporate Office'],
  ['1050','Centre','Corporate Office'],['1089','Centre','Corporate Office'],['1306','Centre','Corporate Office'],
  ['1307','Centre','Corporate Office'],['1646','Centre','Corporate Office'],['1696','Centre','Corporate Office'],
  ['1716','Service','Corporate Office'],['1825','Centre','Corporate Office'],['1880','Centre','Corporate Office'],
  ['2037','Centre','Corporate Office'],['2039','Centre','Corporate Office'],['2052','Centre','Corporate Office'],
  ['2083','Centre','Corporate Office'],['2138','Centre','Corporate Office'],['2155','Centre','Corporate Office'],
  ['2163','Centre','Corporate Office'],['2260','Centre','Corporate Office'],['2294','Centre','Corporate Office'],
  ['2349','Centre','Corporate Office'],['2350','Centre','Corporate Office'],['2360','Centre','Corporate Office'],
  ['2375','Centre','Corporate Office'],['2399','Centre','Corporate Office'],['2400','Centre','Corporate Office'],
  ['2434','Centre','Corporate Office'],
];

async function run() {
  for (const [code, dept, branch] of rows) {
    await db('employees').where('employee_code', code).update({ dept_name: dept, branch_name: branch });
  }
  const check = await db('employees').where('employee_code', '2399').select('first_name', 'dept_name', 'branch_name').first();
  console.log('Verify Gurnoor:', JSON.stringify(check));
  const check2 = await db('employees').where('employee_code', '20').select('first_name', 'dept_name', 'branch_name').first();
  console.log('Verify Rajendra:', JSON.stringify(check2));
  console.log(`Backfilled ${rows.length} employees with dept_name and branch_name`);
  await db.destroy();
}

run();
