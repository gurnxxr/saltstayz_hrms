import db from '../config/database';
import { linkUserProfiles } from './linkUserProfiles';

const CSV_DATA = [
  { code: '3', name: 'Anvesha Gupta', father: 'Rajeev Gupta', dob: '30-03-1999', designation: 'Assistant Manager', aadhaar: '343880923276', doj: '28-11-2022' },
  { code: '11', name: 'Chirag Dhingra', father: 'Kawal Kishore', dob: '19-04-1985', designation: 'Operation Head', aadhaar: '491034084684', doj: '20-11-2023' },
  { code: '20', name: 'Rajendra Kumar', father: 'Joga Ram', dob: '21-07-1992', designation: 'Captain', aadhaar: '230313264198', doj: '07-09-2022' },
  { code: '200', name: 'Lalit Singh Chilwal', father: 'Harish Singh Chilwal', dob: '12-07-2003', designation: 'Data Analyst', aadhaar: '212366963615', doj: '25-01-2024' },
  { code: '260', name: 'Shruti Singhal', father: 'Anuj Kumar', dob: '15-12-1997', designation: 'Assistant Manager', aadhaar: '859164704217', doj: '08-04-2024' },
  { code: '324', name: 'Priyaranjan', father: 'Rajiv Ranjan Pandey', dob: '14-08-2000', designation: 'Deputy Manager', aadhaar: '284734663172', doj: '08-05-2024' },
  { code: '360', name: 'Suraj Singhal', father: 'Anuj Kumar Singhal', dob: '01-08-1996', designation: 'Senior Manager', aadhaar: '482053726276', doj: '22-05-2024' },
  { code: '567', name: 'Saumya Singh', father: 'Ranjeet Singh', dob: '19-01-2005', designation: 'Senior Executive', aadhaar: '878287089788', doj: '16-09-2024' },
  { code: '586', name: 'Shruti Chabbra', father: 'Yash pal chabbra', dob: '26-02-1996', designation: 'Assistant Manager', aadhaar: '473825138903', doj: '23-09-2024' },
  { code: '746', name: 'Isha rawat', father: 'Birender singh rawat', dob: '06-03-2006', designation: 'Senior Executive', aadhaar: '519191503858', doj: '02-12-2024' },
  { code: '823', name: 'Govind kumar', father: 'Rakesh kumar singh', dob: '12-10-1992', designation: 'Senior Executive', aadhaar: '755122128635', doj: '06-01-2025' },
  { code: '1048', name: 'Subodh Giri', father: 'Birendra Giri', dob: '03-07-2000', designation: 'Senior Interior Designer', aadhaar: '894382876127', doj: '01-04-2025' },
  { code: '1050', name: 'Suraj Mishra', father: 'Shankar Mishra', dob: '28-07-1998', designation: 'Manager', aadhaar: '440628472577', doj: '01-04-2025' },
  { code: '1089', name: 'Dushant Sharma', father: 'Chetram', dob: '15-05-2003', designation: 'Senior Executive', aadhaar: '777022660339', doj: '14-04-2025' },
  { code: '1306', name: 'Farhan Ahmad', father: 'Aslam Rayeen', dob: '14-07-2000', designation: 'Executive', aadhaar: '277715939388', doj: '03-06-2025' },
  { code: '1307', name: 'Dheeraj kumar', father: 'Har narayan', dob: '28-11-1990', designation: 'Manager', aadhaar: '535272499993', doj: '02-06-2025' },
  { code: '1646', name: 'Vikash Kumar Jha', father: 'Satish Chandra Jha', dob: '14-05-1998', designation: 'Executive', aadhaar: '674638571708', doj: '01-10-2025' },
  { code: '1696', name: 'Drigesh Kumar', father: 'Vinod Jha', dob: '08-10-1999', designation: 'Executive', aadhaar: '210648292826', doj: '29-10-2025' },
  { code: '1716', name: 'Lungchin Sampar', father: 'Chekneijam Sampar', dob: '13-12-2006', designation: 'Steward', aadhaar: '609474674673', doj: '03-11-2025' },
  { code: '1825', name: 'Anurag Kushwaha', father: 'Ramesh Chandra Kushwaha', dob: '03-03-2000', designation: 'Executive', aadhaar: '734197198960', doj: '12-12-2025' },
  { code: '1880', name: 'Anjali Poddar', father: 'Anil Kumar Poddar', dob: '20-10-2003', designation: 'Junior Designer', aadhaar: '979633167419', doj: '27-12-2025' },
  { code: '2037', name: 'Aysha Sultan', father: 'Laiq Sultan', dob: '11-11-2000', designation: 'Manager', aadhaar: '475275184581', doj: '02-02-2026' },
  { code: '2039', name: 'Azad Singh', father: 'Balbir Singh', dob: '15-08-1995', designation: '3D Senior Visualizer', aadhaar: '424329264438', doj: '05-02-2026' },
  { code: '2052', name: 'Yash Chauhan', father: 'Sunil Chauhan', dob: '12-03-2002', designation: 'Motion Designer', aadhaar: '210986075636', doj: '10-02-2026' },
  { code: '2083', name: 'Vatsa Ishaan', father: 'Vinay kumar singh', dob: '29-10-2001', designation: 'Copywriter', aadhaar: '907030509243', doj: '18-02-2026' },
  { code: '2138', name: 'Rahul Panchal', father: 'Mahipal Panchal', dob: '15-09-2002', designation: 'Manager', aadhaar: '391112143874', doj: '11-03-2026' },
  { code: '2155', name: 'Dinesh Kumar', father: 'Pramod Kumar', dob: '01-01-1999', designation: 'Intern', aadhaar: '743967360517', doj: '23-03-2026' },
  { code: '2163', name: 'Himani', father: 'Sukhbir Singh Dahiya', dob: '09-03-1999', designation: 'Executive', aadhaar: '485547276089', doj: '17-03-2026' },
  { code: '2260', name: 'Rohan Joshi', father: 'Umesh Chandra Joshi', dob: '01-02-2003', designation: 'Intern', aadhaar: '704814053629', doj: '13-04-2026' },
  { code: '2294', name: 'Deya Dhawan', father: 'Sanjay Dhawan', dob: '11-06-2004', designation: 'HR Intern', aadhaar: '493853207540', doj: '22-04-2026' },
  { code: '2349', name: 'Sakshi', father: 'Rakesh Kumar', dob: '25-05-2005', designation: 'Executive', aadhaar: '293931544593', doj: '04-05-2026' },
  { code: '2350', name: 'Priti Dey', father: 'Biswajit Dey', dob: '15-08-2001', designation: 'Senior Executive', aadhaar: '519009101975', doj: '04-05-2026' },
  { code: '2360', name: 'Akash Yadav', father: 'Suraj Kumar Yadav', dob: '03-09-2001', designation: 'Manager', aadhaar: '932802645720', doj: '11-05-2026' },
  { code: '2375', name: 'Aditya Pandey', father: 'Panch Dev Pandey', dob: '10-03-2000', designation: 'Executive', aadhaar: '898111741800', doj: '14-05-2026' },
  { code: '2399', name: 'Gurnoor Singh', father: 'Mandeep Singh', dob: '10-09-2005', designation: 'Intern', aadhaar: '648791914604', doj: '18-05-2026' },
  { code: '2400', name: 'Kartikey Pandey', father: 'Sudeep Pandey', dob: '03-05-2006', designation: 'Intern', aadhaar: '445448072465', doj: '18-05-2026' },
  { code: '2434', name: 'Neha', father: 'Mahesh Kumar', dob: '06-10-1998', designation: 'Manager', aadhaar: '446887601515', doj: '25-05-2026' },
];

function parseDate(d: string): string {
  // DD-MM-YYYY or DD/MM/YYYY → YYYY-MM-DD
  const parts = d.split(/[-\/]/);
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  const first_name = parts[0];
  const last_name = parts.slice(1).join(' ');
  return { first_name, last_name };
}

async function run() {
  try {
    // Collect unique designations from CSV
    const designations = [...new Set(CSV_DATA.map(r => r.designation))];

    // Ensure all designations exist in job_titles
    const existing = await db('job_titles').select('id', 'title');
    const existingMap: Record<string, number> = {};
    existing.forEach((j: any) => { existingMap[j.title] = j.id; });

    for (const title of designations) {
      if (!existingMap[title]) {
        const [id] = await db('job_titles').insert({ title });
        existingMap[title] = id;
        console.log(`  Created job title: "${title}" (id=${id})`);
      }
    }

    // Clear old seed employees that don't match CSV codes
    // (keep users table intact — just update/insert employee records)
    let inserted = 0;
    let updated = 0;

    for (const row of CSV_DATA) {
      const { first_name, last_name } = splitName(row.name);
      const record = {
        employee_code: row.code,
        first_name,
        last_name,
        father_name: row.father,
        date_of_birth: parseDate(row.dob),
        date_of_joining: parseDate(row.doj),
        aadhaar_number: row.aadhaar,
        job_title_id: existingMap[row.designation],
        is_active: true,
      };

      const existingEmp = await db('employees').where('employee_code', row.code).first();
      if (existingEmp) {
        await db('employees').where('id', existingEmp.id).update({ ...record, updated_at: db.fn.now() });
        updated++;
      } else {
        await db('employees').insert(record);
        inserted++;
      }
    }

    console.log(`\nImport complete: ${inserted} inserted, ${updated} updated (${CSV_DATA.length} total rows)`);

    // Re-import can orphan the users.employee_id links (CSV rows carry no email);
    // restore them so the demo logins keep their profiles.
    const relinked = await linkUserProfiles(db);
    if (relinked) console.log(`Re-linked ${relinked} login account(s) to their employee profile.`);
  } catch (err) {
    console.error('Import failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

run();
