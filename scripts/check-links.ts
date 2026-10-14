// Fetches every page in the index from the live sites and confirms that each
// page exists and each section anchor is present in its HTML.
//
//   npm run check-links                  # all sources
//   npm run check-links -- data_analysis # one source

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { LibraryIndex } from '../src/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(gunzipSync(await readFile(path.join(root, 'data', 'index.json.gz'))).toString()) as LibraryIndex;
const only = process.argv.slice(2);

const pages = new Map<string, { source: string; anchors: Set<string> }>();
for (const r of index.records) {
  if (only.length && !only.includes(r.source)) continue;
  const [page, anchor] = r.url.split('#');
  if (!pages.has(page)) pages.set(page, { source: r.source, anchors: new Set() });
  if (anchor) pages.get(page)!.anchors.add(anchor);
}

const stats = new Map<string, { pages: number; badPages: string[]; anchors: number; badAnchors: string[] }>();
const queue = [...pages.entries()];
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const [url, { source, anchors }] = item;
    if (!stats.has(source)) stats.set(source, { pages: 0, badPages: [], anchors: 0, badAnchors: [] });
    const s = stats.get(source)!;
    s.pages++;
    s.anchors += anchors.size;
    let html = '';
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'research-methods-mcp link check' } });
      if (!res.ok) {
        s.badPages.push(`${res.status} ${url}`);
        continue;
      }
      html = await res.text();
    } catch (e) {
      s.badPages.push(`ERR ${url} ${(e as Error).message}`);
      continue;
    }
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const a of anchors) if (!ids.has(a)) s.badAnchors.push(`${url}#${a}`);
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

let failed = false;
for (const [source, s] of stats) {
  const ok = s.badPages.length === 0 && s.badAnchors.length === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${source.padEnd(20)} pages ${s.pages - s.badPages.length}/${s.pages}  ` +
    `anchors ${s.anchors - s.badAnchors.length}/${s.anchors}`,
  );
  for (const p of s.badPages.slice(0, 8)) console.log(`     page   ${p}`);
  for (const a of s.badAnchors.slice(0, 8)) console.log(`     anchor ${a}`);
}
process.exit(failed ? 1 : 0);
