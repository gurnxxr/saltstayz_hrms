import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * No two screens may cache different answers under the same name.
 *
 * React Query stores a reply against its `queryKey` and nothing else — not the URL it came from,
 * not the shape it arrived in. Two components using the same key are two components sharing one
 * slot, and whichever mounts first decides what is in it.
 *
 * That is not hypothetical. `/shifts/me` and `/shifts/me/shift` both answer "what shift am I on",
 * one bare and one wrapped in `current`, and both were cached as `['my-shift']`. An employee who
 * opened the dashboard and then My Shift was handed the dashboard's reply, found no `current` in
 * it, and was told "No shift assigned yet" — while the database held two assignments and the
 * server resolved them correctly. The endpoint was fine, the query was fine, the cache name was
 * not.
 *
 * Read as text because the client is a separate workspace with no test runner of its own — the
 * same approach `attendanceCodes.test.ts` takes.
 */

const CLIENT = join(__dirname, '../../../client/src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/**
 * The endpoint, stripped of anything that varies per call — `/employees?${params}` and
 * `/employees?page=2` are the same endpoint, and a key is allowed to serve both.
 */
const normalise = (url: string) => url.split('?')[0].split('${')[0].replace(/\/+$/, '') || '/';

/** First element of the key array — the name; the rest are parameters that scope it. */
function keyName(literal: string): string | null {
  const m = literal.match(/^\s*['"`]([^'"`]+)['"`]/);
  return m ? m[1] : null;
}

interface Use { key: string; endpoint: string; file: string }

/**
 * Every `useQuery` that names a key and fetches a URL. Deliberately narrow: a queryFn that does
 * something other than call `api.<verb>('/path')` is skipped rather than guessed at.
 */
function collectQueryUses(): Use[] {
  const uses: Use[] = [];
  for (const file of walk(CLIENT)) {
    const src = readFileSync(file, 'utf-8');
    // Anchored on `useQuery(` and read only within that call. Scanning for a bare `queryKey:`
    // instead would also catch `invalidateQueries({ queryKey: [...] })` and pair it with the
    // NEXT component's queryFn — which reported a collision in manpower/page.tsx that does not
    // exist. A guard that cries wolf gets switched off.
    for (const m of src.matchAll(/useQuery\s*\(/g)) {
      const call = src.slice(m.index!, m.index! + 900);
      const k = call.match(/queryKey:\s*\[([^\]]*)\]/);
      const f = call.match(/queryFn:[\s\S]{0,300}?api\.\w+\(\s*[`'"]([^`'"]+)/);
      if (!k || !f) continue;
      const key = keyName(k[1]);
      if (key) uses.push({ key, endpoint: normalise(f[1]), file: file.slice(CLIENT.length + 1) });
    }
  }
  return uses;
}

describe('client query keys — one name, one answer', () => {
  const uses = collectQueryUses();

  it('finds the queries at all', () => {
    // Guards the parsing: if the client is restructured so the regex matches nothing, the
    // collision check below would pass vacuously on an empty list.
    expect(uses.length).toBeGreaterThan(20);
  });

  it('never caches two different endpoints under one key', () => {
    const byKey = new Map<string, Map<string, string[]>>();
    for (const u of uses) {
      if (!byKey.has(u.key)) byKey.set(u.key, new Map());
      const endpoints = byKey.get(u.key)!;
      if (!endpoints.has(u.endpoint)) endpoints.set(u.endpoint, []);
      endpoints.get(u.endpoint)!.push(u.file);
    }

    const collisions = [...byKey.entries()]
      .filter(([, endpoints]) => endpoints.size > 1)
      .map(([key, endpoints]) => `'${key}' is used for ${[...endpoints.entries()]
        .map(([url, files]) => `${url} (${files.join(', ')})`).join(' AND ')}`);

    expect(collisions).toEqual([]);
  });

  it('keeps the two "my shift" screens apart', () => {
    // The specific regression, named so a future edit that re-merges them fails with a reason
    // rather than just a diff. The dashboard card and the My Shift page ask different endpoints
    // for different amounts of detail; they must not share a slot.
    const shiftKeys = uses.filter((u) => u.endpoint.startsWith('/shifts/me'));
    expect(shiftKeys.length).toBeGreaterThanOrEqual(2);
    const names = new Set(shiftKeys.map((u) => u.key));
    expect(names.size).toBe(shiftKeys.length);
  });
});
