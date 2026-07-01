import type { Knex } from 'knex';

// Regions + regional/national holidays. Idempotent: safe to run against a populated
// DB (used both by db:seed and by the one-off region backfill).

const REGIONS = [
  { name: 'North', description: 'Delhi NCR, Punjab, Haryana, UP, Uttarakhand, HP, J&K' },
  { name: 'South', description: 'Tamil Nadu, Karnataka, Kerala, Andhra Pradesh, Telangana' },
  { name: 'West', description: 'Maharashtra, Gujarat, Goa, Rajasthan' },
  { name: 'East', description: 'West Bengal, Odisha, Bihar, Jharkhand' },
  { name: 'Central', description: 'Madhya Pradesh, Chhattisgarh' },
  { name: 'North East', description: 'Assam, Meghalaya, and the seven sisters' },
];

// Map a property to a region by its state (best-effort; unmatched stay unassigned).
const STATE_TO_REGION: Record<string, string> = {
  delhi: 'North', haryana: 'North', punjab: 'North', 'uttar pradesh': 'North',
  uttarakhand: 'North', 'himachal pradesh': 'North', rajasthan: 'West',
  maharashtra: 'West', gujarat: 'West', goa: 'West',
  'tamil nadu': 'South', karnataka: 'South', kerala: 'South', telangana: 'South', 'andhra pradesh': 'South',
  'west bengal': 'East', odisha: 'East', bihar: 'East', jharkhand: 'East',
  'madhya pradesh': 'Central', chhattisgarh: 'Central',
  assam: 'North East', meghalaya: 'North East',
};

const NATIONAL_HOLIDAYS = [
  { name: 'Republic Day', date: '2026-01-26' },
  { name: 'Independence Day', date: '2026-08-15' },
  { name: 'Gandhi Jayanti', date: '2026-10-02' },
  { name: 'Diwali', date: '2026-11-08' },
];

// Region-specific examples (only inserted for regions that exist).
const REGIONAL_HOLIDAYS: Record<string, { name: string; date: string }[]> = {
  North: [{ name: 'Lohri', date: '2026-01-13' }, { name: 'Baisakhi', date: '2026-04-14' }],
  South: [{ name: 'Pongal', date: '2026-01-15' }, { name: 'Onam', date: '2026-08-26' }],
  West: [{ name: 'Gudi Padwa', date: '2026-03-19' }, { name: 'Ganesh Chaturthi', date: '2026-09-14' }],
  East: [{ name: 'Durga Puja', date: '2026-10-19' }, { name: 'Poila Boishakh', date: '2026-04-15' }],
};

export async function seed(knex: Knex): Promise<void> {
  // 1) Regions (insert missing by name)
  for (const r of REGIONS) {
    const existing = await knex('regions').whereRaw('LOWER(name) = ?', [r.name.toLowerCase()]).first();
    if (!existing) await knex('regions').insert(r);
  }
  const regionRows = await knex('regions').select('id', 'name');
  const regionId = (name: string) => regionRows.find((x: any) => x.name.toLowerCase() === name.toLowerCase())?.id ?? null;

  // 2) Assign properties to a region by state (skip already-assigned)
  const props = await knex('properties').select('id', 'state', 'region_id');
  for (const p of props) {
    if (p.region_id) continue;
    const target = STATE_TO_REGION[String(p.state || '').trim().toLowerCase()];
    if (target) {
      const rid = regionId(target);
      if (rid) await knex('properties').where('id', p.id).update({ region_id: rid });
    }
  }

  // 3) National holidays (insert missing by name+date)
  for (const h of NATIONAL_HOLIDAYS) {
    const exists = await knex('holidays').where({ name: h.name, date: h.date }).first();
    if (!exists) await knex('holidays').insert({ ...h, is_national: true, region_id: null, is_recurring: false });
  }

  // 4) Regional holidays for regions that exist (insert missing by name+date+region)
  for (const [regionName, list] of Object.entries(REGIONAL_HOLIDAYS)) {
    const rid = regionId(regionName);
    if (!rid) continue;
    for (const h of list) {
      const exists = await knex('holidays').where({ name: h.name, date: h.date, region_id: rid }).first();
      if (!exists) await knex('holidays').insert({ ...h, is_national: false, region_id: rid, is_recurring: false });
    }
  }
}
