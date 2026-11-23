// Compares the built data/index.json.gz with a committed one (HEAD by default):
// sections per source and pages added or removed. Every removed page is fetched at its
// old URL; one that still answers was left out of the new build although it is live.
//
//   npm run diff-index              # against HEAD
//   npm run diff-index -- <ref>     # against another commit of this repo
//
// Exits with status 1 when a removed page is still live.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { LibraryIndex } from '../src/types.ts';

const ref = process.argv[2] ?? 'HEAD';
const git = spawnSync('git', ['show', `${ref}:data/index.json.gz`], { maxBuffer: 1 << 30 });
if (git.status !== 0) throw new Error(`git show ${ref}:data/index.json.gz: ${git.stderr.toString().trim()}`);
const parse = (gz: Buffer) => JSON.parse(gunzipSync(gz).toString('utf8')) as LibraryIndex;
const before = parse(git.stdout);
const after = parse(readFileSync('data/index.json.gz'));

/** Page id (`source:page`) -> URL of the page, for one source. */
function pages(index: LibraryIndex, source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of index.records) if (r.source === source) out.set(r.id.split('#')[0], r.url.split('#')[0]);
  return out;
}

/** HTTP status of a page, or the final URL when it redirects to another page. */
async function liveStatus(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'research-methods-mcp index diff' } });
    return res.redirected && res.url.replace(/#.*$/, '') !== url ? `${res.status} via ${res.url}` : String(res.status);
  } catch (err) {
    return `unreachable (${(err as Error).message})`;
  }
}

const ids = [...new Set([...before.sources, ...after.sources].map((s) => s.id))];
console.log(`Index built ${after.built} compared with ${ref} (built ${before.built})\n`);
console.log(`${'source'.padEnd(22)} ${'sections'.padStart(15)}  ${'pages'.padStart(13)}  added  removed  commit`);
const removed: { source: string; id: string; url: string }[] = [];
const added: { source: string; id: string }[] = [];
for (const id of ids) {
  const a = before.sources.find((s) => s.id === id);
  const b = after.sources.find((s) => s.id === id);
  const pa = pages(before, id);
  const pb = pages(after, id);
  for (const [page, url] of pa) if (!pb.has(page)) removed.push({ source: id, id: page, url });
  for (const page of pb.keys()) if (!pa.has(page)) added.push({ source: id, id: page });
  const delta = (x = 0, y = 0) => `${x} -> ${y}`;
  console.log(
    `${id.padEnd(22)} ${delta(a?.sections, b?.sections).padStart(15)}  ${delta(pa.size, pb.size).padStart(13)}  ` +
    `${String(added.filter((p) => p.source === id).length).padStart(5)}  ${String(removed.filter((p) => p.source === id).length).padStart(7)}  ${b?.commit?.slice(0, 9) ?? ''}`,
  );
}

if (added.length) console.log(`\nPages added:\n  ${added.map((p) => p.id).join('\n  ')}`);
let live = 0;
if (removed.length) {
  console.log('\nPages removed (status of the old URL now):');
  const statuses = await Promise.all(removed.map((p) => liveStatus(p.url)));
  removed.forEach((p, i) => {
    const stillLive = statuses[i] === '200';
    if (stillLive) live++;
    console.log(`  ${stillLive ? 'STILL LIVE ' : ''}${p.id}  ${p.url}  ${statuses[i]}`);
  });
}
if (live) {
  console.log(`\n${live} removed page(s) are still live: the build left out published pages.`);
  process.exit(1);
}
