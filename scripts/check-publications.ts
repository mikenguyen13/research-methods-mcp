// Fails when the ORCID record lists a DOI that data/publications.json does not, so a
// newly published paper is noticed and added (npm run build:publications, then
// npm run build:index).
//   npm run check-publications

import { readFile } from 'node:fs/promises';

const pub = JSON.parse(await readFile('data/publications.json', 'utf8')) as { orcid: string; works: { doi?: string }[] };
const res = await fetch(`https://pub.orcid.org/v3.0/${pub.orcid}/works`, { headers: { accept: 'application/json' } });
if (!res.ok) throw new Error(`ORCID ${res.status}`);
const record = (await res.json()) as { group: any[] };
const known = new Set(pub.works.map((w) => w.doi?.toLowerCase()).filter(Boolean));
const missing: string[] = [];
for (const g of record.group) {
  const s = g['work-summary'][0];
  const doi = (s['external-ids']?.['external-id'] ?? []).find((e: any) => e['external-id-type'] === 'doi')?.['external-id-value']?.toLowerCase();
  if (doi && !known.has(doi)) missing.push(`${doi}  ${s.title?.title?.value ?? ''}`);
}
if (missing.length) {
  console.error(`ORCID lists ${missing.length} work(s) not in data/publications.json; run npm run build:publications and npm run build:index:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`publications up to date with ORCID ${pub.orcid} (${known.size} DOIs)`);
