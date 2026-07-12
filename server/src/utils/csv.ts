// Parse a whole CSV document (RFC-4180 style) into rows of trimmed cells. Double-quoted
// fields may contain commas AND line breaks — a wrapped cell (entered with Alt+Enter) is
// one field, not two rows — and "" is an escaped quote. Handles \n, \r\n and lone-\r line
// endings and strips a leading BOM. Blank / separator lines are dropped.
//
// Shared by every CSV importer so quote handling is consistent (each module used to roll
// its own, some naïvely splitting on "," and "\n" and corrupting quoted fields).
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // escaped ""
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++; // CRLF counts as one break
      row.push(field); field = ''; rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  row.push(field); rows.push(row); // flush the final field/row
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== '')); // drop blank / separator lines
}
