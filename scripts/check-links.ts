// Checks every link the server can return, against the live web:
//   - each section page exists, is served at its own URL (no redirect to another
//     host or path), and contains each section anchor;
//   - each source site and each cited work's URL answers without moving;
//   - each DOI is registered (doi.org redirects to the publisher).
// A redirect counts as a failure: it means a site has moved and the index must
// point at the new host (as when bookdown.org/mike/data_analysis moved to Posit
// Connect Cloud).
//
//   npm run check-links                  # everything
//   npm run check-links -- data_analysis # one source's sections

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { LibraryIndex } from '../src/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(gunzipSync(await readFile(path.join(root, 'data', 'index.json.gz'))).toString()) as LibraryIndex;
const only = process.argv.slice(2);
const UA = { 'user-agent': 'research-methods-mcp link check (https://github.com/mikenguyen13/research-methods-mcp)' };

const samePage = (a: string, b: string) => {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/index\.html$/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
};

async function get(url: string): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, { redirect: 'follow', headers: UA });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw last;
}

async function pool<T>(items: T[], fn: (item: T) => Promise<void>, n = 8) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
  }));
}

// --- section pages and anchors -------------------------------------------------
const pages = new Map<string, { source: string; anchors: Set<string> }>();
for (const r of index.records) {
  if (only.length && !only.includes(r.source)) continue;
  if (r.url.startsWith('https://doi.org/')) continue; // publications: checked as DOIs below
  const [page, anchor] = r.url.split('#');
  if (!pages.has(page)) pages.set(page, { source: r.source, anchors: new Set() });
  if (anchor) pages.get(page)!.anchors.add(anchor);
}

type Stat = { pages: number; bad: string[]; anchors: number; badAnchors: string[] };
const stats = new Map<string, Stat>();
const stat = (s: string) => stats.get(s) ?? stats.set(s, { pages: 0, bad: [], anchors: 0, badAnchors: [] }).get(s)!;

await pool([...pages.entries()], async ([url, { source, anchors }]) => {
  const s = stat(source);
  s.pages++;
  s.anchors += anchors.size;
  try {
    const res = await get(url);
    if (res.redirected && !samePage(res.url, url)) {
      s.bad.push(`MOVED ${url} -> ${res.url}`);
      return;
    }
    if (!res.ok) {
      s.bad.push(`${res.status} ${url}`);
      return;
    }
    const ids = new Set([...(await res.text()).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const a of anchors) if (!ids.has(a)) s.badAnchors.push(`${url}#${a}`);
  } catch (e) {
    s.bad.push(`ERR ${url} ${(e as Error).message}`);
  }
});

// --- source sites, citation URLs, and DOIs ------------------------------------
const meta = stat('sites and citations');
const urls = new Set<string>();
const dois = new Set<string>();
if (!only.length) {
  for (const s of index.sources) if (s.site) urls.add(s.site);
  for (const w of index.works) {
    if (w.doi) dois.add(w.doi);
    else if (w.url) urls.add(w.url);
  }
  for (const r of index.records) if (r.url.startsWith('https://doi.org/')) dois.add(r.url.slice('https://doi.org/'.length));
}
await pool([...urls], async (url) => {
  meta.pages++;
  try {
    const res = await get(url);
    if (res.redirected && new URL(res.url).host !== new URL(url).host) meta.bad.push(`MOVED ${url} -> ${res.url}`);
    else if (!res.ok) meta.bad.push(`${res.status} ${url}`);
  } catch (e) {
    meta.bad.push(`ERR ${url} ${(e as Error).message}`);
  }
});
await pool([...dois], async (doi) => {
  meta.pages++;
  try {
    const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, { method: 'HEAD', redirect: 'manual', headers: UA });
    if (!(res.status >= 300 && res.status < 400 && res.headers.get('location'))) meta.bad.push(`DOI not registered (${res.status}): ${doi}`);
  } catch (e) {
    meta.bad.push(`ERR doi ${doi} ${(e as Error).message}`);
  }
});

let failed = false;
for (const [source, s] of stats) {
  if (!s.pages) continue;
  const ok = s.bad.length === 0 && s.badAnchors.length === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${source.padEnd(22)} links ${s.pages - s.bad.length}/${s.pages}` +
      (s.anchors ? `  anchors ${s.anchors - s.badAnchors.length}/${s.anchors}` : ''),
  );
  for (const p of s.bad.slice(0, 10)) console.log(`     ${p}`);
  for (const a of s.badAnchors.slice(0, 10)) console.log(`     anchor ${a}`);
}
process.exit(failed ? 1 : 0);
