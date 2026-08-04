import { describe, it, expect } from 'vitest';
import { parsePropertiesCsv } from './organization.controller';

/**
 * The properties CSV parser.
 *
 * This exists because the parser it covers was broken for months in a way no test could see. The
 * service was changed to require a state — deliberately, because guessing it from the city had
 * stamped Haryana on hotels in five other states and paid ~88 people the wrong statutory rates —
 * but the parser was never taught to read the column. Every upload was rejected with "no state
 * given", whatever the file said, and the only route to the code was a multipart request.
 *
 * So the first assertion below is the whole point: the State column reaches the service.
 */
describe('properties CSV parsing', () => {
  const HEADER = 'Name,Hotel ID,City,State,Address,Category';

  it('carries the State column through — the column that was silently dropped', () => {
    const rows = parsePropertiesCsv(
      `${HEADER}\nSaltStayz Noida,HT-201,Noida,Uttar Pradesh,Sector 62 Noida,Business`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('Uttar Pradesh');
    expect(rows[0]).toEqual({
      name: 'SaltStayz Noida',
      hotel_id: 'HT-201',
      city: 'Noida',
      state: 'Uttar Pradesh',
      address: 'Sector 62 Noida',
      category: 'Business',
    });
  });

  it('reads columns by name, in any order, and tolerates spacing and case', () => {
    const rows = parsePropertiesCsv(
      'STATE , property name ,Category\nKarnataka,SaltStayz Indiranagar,Resort',
    );
    expect(rows[0].name).toBe('SaltStayz Indiranagar');
    expect(rows[0].state).toBe('Karnataka');
    expect(rows[0].category).toBe('Resort');
  });

  it('leaves a missing state undefined rather than inventing one', () => {
    // The service refuses these with its own message. The parser must not paper over it — a
    // defaulted state is exactly the bug that put five states' worth of staff on Haryana rates.
    const rows = parsePropertiesCsv('Name,City\nSaltStayz Kochi,Kochi');
    expect(rows[0].state).toBeUndefined();
    expect(rows[0].name).toBe('SaltStayz Kochi');
  });

  it('accepts the Hotel alias and blank optional cells', () => {
    const rows = parsePropertiesCsv(`${HEADER}\nSaltStayz Kochi,,Kochi,Kerala,,`);
    expect(rows[0]).toMatchObject({ name: 'SaltStayz Kochi', state: 'Kerala', hotel_id: '', address: '' });
  });

  it('refuses a file with no Name column, or with no data rows', () => {
    expect(() => parsePropertiesCsv('City,State\nNoida,Uttar Pradesh'))
      .toThrow(/must have a "Name" column/);
    expect(() => parsePropertiesCsv(HEADER)).toThrow(/at least one data row/);
    expect(() => parsePropertiesCsv('')).toThrow(/at least one data row/);
  });

  it('ignores blank lines, including a trailing newline', () => {
    const rows = parsePropertiesCsv(`${HEADER}\nSaltStayz Gurgaon,HT-1,Gurugram,Haryana,DLF Phase 3,Business\n\n`);
    expect(rows).toHaveLength(1);
  });
});
