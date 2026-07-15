import { describe, it, expect } from 'vitest';
import { parseCsv } from './csv';

// parseCsv is the shared RFC-4180 parser behind every CSV importer (employees,
// attendance, properties, holidays). A regression here silently corrupts bulk uploads,
// so the quoting / newline / trimming rules are pinned down here.
describe('parseCsv', () => {
  it('parses a plain grid and trims each cell', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv(' a , b \n c , d ')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('keeps commas inside a double-quoted field', () => {
    expect(parseCsv('x,"a,b",y')).toEqual([['x', 'a,b', 'y']]);
  });

  it('treats "" inside quotes as one escaped quote', () => {
    expect(parseCsv('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });

  it('keeps a line break inside a quoted field (a wrapped cell is one field)', () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
    // A quoted field is still edge-trimmed, so surrounding newlines/spaces drop.
    expect(parseCsv('"  padded  ",b')).toEqual([['padded', 'b']]);
  });

  it('handles LF, CRLF and lone-CR line endings identically', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsv('﻿Employee Code,First Name\nSS-1,Asha'))
      .toEqual([['Employee Code', 'First Name'], ['SS-1', 'Asha']]);
  });

  it('drops blank and whitespace-only lines (including a trailing newline)', () => {
    expect(parseCsv('a\n\n\nb')).toEqual([['a'], ['b']]);
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
    expect(parseCsv('a,b\n  ,  \nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('preserves empty interior cells (so column positions stay aligned)', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    expect(parseCsv('SS-1,Asha,,fo@x.com')).toEqual([['SS-1', 'Asha', '', 'fo@x.com']]);
  });

  it('returns [] for empty / all-blank input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
    expect(parseCsv('   ,   ')).toEqual([]);
  });

  it('parses a realistic multi-row upload with a quoted comma and a wrapped note', () => {
    const csv = [
      'Employee Code,First Name,Branch,Notes',
      'SS-1,Asha,"SaltStayz, New Delhi",ok',
      '"SS-2",Bhaskar,Gurgaon,"line one\nline two"',
    ].join('\n');
    expect(parseCsv(csv)).toEqual([
      ['Employee Code', 'First Name', 'Branch', 'Notes'],
      ['SS-1', 'Asha', 'SaltStayz, New Delhi', 'ok'],
      ['SS-2', 'Bhaskar', 'Gurgaon', 'line one\nline two'],
    ]);
  });
});
