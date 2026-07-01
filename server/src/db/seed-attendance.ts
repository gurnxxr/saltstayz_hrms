import db from '../config/database';

async function seedAttendance() {
  // Get all active employees
  const employees = await db('employees').where('is_active', true).select('id');

  // Generate attendance for current month (June 2026) and May 2026
  const months = ['2026-05', '2026-06'];
  const statuses = ['present', 'present', 'present', 'present', 'present', 'half_day', 'absent'];

  const records: any[] = [];

  for (const emp of employees) {
    for (const month of months) {
      const year = parseInt(month.split('-')[0]);
      const mon = parseInt(month.split('-')[1]);
      const daysInMonth = new Date(year, mon, 0).getDate();
      const today = new Date();

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, mon - 1, d);
        // Skip future dates
        if (date > today) continue;
        // Skip weekends (Sat=6, Sun=0)
        const dow = date.getDay();
        if (dow === 0 || dow === 6) continue;

        const dateStr = `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        let checkIn: string | null = null;
        let checkOut: string | null = null;
        let workingHours: number | null = null;

        if (status === 'present') {
          const inH = 8 + Math.floor(Math.random() * 2);
          const inM = Math.floor(Math.random() * 60);
          const outH = inH + 8 + Math.floor(Math.random() * 2);
          const outM = Math.floor(Math.random() * 60);
          checkIn = `${dateStr} ${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00`;
          checkOut = `${dateStr} ${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}:00`;
          workingHours = parseFloat((outH + outM / 60 - inH - inM / 60).toFixed(2));
        } else if (status === 'half_day') {
          const inH = 9;
          const inM = Math.floor(Math.random() * 30);
          checkIn = `${dateStr} ${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00`;
          checkOut = `${dateStr} 13:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:00`;
          workingHours = 4;
        }

        records.push({
          employee_id: emp.id,
          date: dateStr,
          status,
          check_in: checkIn,
          check_out: checkOut,
          working_hours: workingHours,
        });
      }
    }
  }

  // Clear existing and insert
  await db('attendance_records').del();
  // Insert in batches of 500
  for (let i = 0; i < records.length; i += 500) {
    await db('attendance_records').insert(records.slice(i, i + 500));
  }

  console.log(`Seeded ${records.length} attendance records for ${employees.length} employees`);
  process.exit(0);
}

seedAttendance().catch(err => {
  console.error(err);
  process.exit(1);
});
