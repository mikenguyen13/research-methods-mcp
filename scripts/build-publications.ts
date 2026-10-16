// Builds data/publications.json from the author's ORCID record, the authoritative list
// of their publications (name-based author matching, as in OpenAlex, mixes in other
// people's papers). Metadata for each DOI comes from DOI content negotiation (CSL JSON),
// which covers Crossref (journals, Springer) and DataCite (Zenodo) DOIs alike, and every
// DOI is checked to resolve at doi.org.
//   npm run build:publications   (network; review the diff before committing)

import { writeFile } from 'node:fs/promises';
import type { Person, Work } from '../src/types.ts';

const ORCID = '0000-0002-3432-8595';
const UA = 'research-methods-mcp/build (https://github.com/mikenguyen13/research-methods-mcp)';

/**
 * Volume numbers of the Springer series derived from A Guide on Data Analysis, by book
 * DOI. Chapter DOIs extend the book DOI (e.g. 10.1007/978-3-032-01839-7_2).
 */
const SPRINGER_VOLUMES: Record<string, number> = {
  '10.1007/978-3-032-01858-8': 1, // Foundations of Data Analysis
  '10.1007/978-3-032-01835-9': 2, // Regression Techniques for Data Analysis
  '10.1007/978-3-032-01719-2': 3, // Advanced Modeling and Data Challenges
  '10.1007/978-3-032-01839-7': 4, // Experimental Design
};

/** ORCID work types indexed as searchable records; chapters become citable works only. */
const RECORD_TYPES = new Set(['journal-article', 'conference-paper', 'book', 'software', 'data-set', 'preprint', 'working-paper', 'report', 'dissertation-thesis']);

export interface PublicationItem {
  key: string;
  orcidType: string;
  title: string;
  abstract?: string;
  doi: string;
  url: string;
  container?: string;
  year: number;
}

async function json(url: string, accept = 'application/json'): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept, 'user-agent': UA } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function doiResolves(doi: string): Promise<boolean> {
  const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': UA } });
  return res.status >= 300 && res.status < 400 && Boolean(res.headers.get('location'));
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
/** Abstracts: drop JATS markup and section titles. */
const stripTags = (s: string) =>
  decode(s.replace(/<jats:title>[^<]*<\/jats:title>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
/** Titles: drop inline markup such as <i>p</i> without leaving stray spaces ("p-Hacking"). */
const cleanTitle = (s: string) => decode(s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/\s+-/g, '-').trim());

/** DataCite (e.g. Zenodo) resource type, which is more specific than the CSL type. */
async function dataciteType(doi: string): Promise<string | undefined> {
  if (!doi.startsWith('10.5281/')) return undefined;
  return (await json(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`)).data?.attributes?.types?.resourceType;
}

function workType(cslType: string, orcidType: string, resourceType?: string): { type: Work['type']; genre?: string } {
  if (resourceType === 'Presentation' || resourceType === 'Poster') return { type: 'misc', genre: resourceType };
  if (orcidType === 'book-chapter' || cslType === 'chapter') return { type: 'chapter' };
  if (orcidType === 'software' || cslType === 'software' || resourceType === 'Software') return { type: 'software' };
  if (orcidType === 'data-set' || cslType === 'dataset' || resourceType === 'Dataset') return { type: 'dataset' };
  if (orcidType === 'book' || cslType === 'book' || cslType === 'monograph') return { type: 'book' };
  return { type: 'article' };
}

function keyFor(authors: Person[], year: number, title: string, used: Set<string>): string {
  const word = title.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).find((w) => w.length > 3 && !/^(the|and|with|from|into|for)$/i.test(w)) ?? 'work';
  const base = `${authors[0]?.family.replace(/[^A-Za-z]/g, '') ?? 'Anon'}${year}${word[0].toUpperCase()}${word.slice(1).replace(/[^A-Za-z0-9]/g, '')}`;
  let key = base;
  for (let i = 2; used.has(key); i++) key = `${base}${i}`;
  used.add(key);
  return key;
}

const record = await json(`https://pub.orcid.org/v3.0/${ORCID}/works`);
const works: Work[] = [];
const items: PublicationItem[] = [];
const used = new Set<string>();
const problems: string[] = [];

for (const group of record.group) {
  const summary = group['work-summary'][0];
  const orcidType: string = summary.type;
  const doi: string | undefined = (summary['external-ids']?.['external-id'] ?? [])
    .find((e: any) => e['external-id-type'] === 'doi')?.['external-id-value']?.toLowerCase();
  const orcidTitle: string = summary.title?.title?.value ?? '';
  if (!doi) {
    problems.push(`no DOI on ORCID: ${orcidTitle}`);
    continue;
  }
  if (!(await doiResolves(doi))) {
    problems.push(`DOI does not resolve: ${doi} (${orcidTitle})`);
    continue;
  }
  const csl = await json(`https://doi.org/${encodeURIComponent(doi)}`, 'application/vnd.citationstyles.csl+json');
  const authors: Person[] = (csl.author ?? [])
    .filter((a: any) => a.family)
    .map((a: any) => ({ family: a.family, given: a.given ?? '', ...(a.ORCID ? { orcid: String(a.ORCID).replace(/^https?:\/\/orcid.org\//, '') } : {}) }));
  const year: number = csl.issued?.['date-parts']?.[0]?.[0] ?? Number(summary['publication-date']?.year?.value);
  const title = cleanTitle((Array.isArray(csl.title) ? csl.title[0] : csl.title) ?? orcidTitle);
  const abstract: string | undefined = csl.abstract ? stripTags(csl.abstract) : undefined;
  const { type, genre } = workType(csl.type, orcidType, await dataciteType(doi));
  // Zenodo reports itself as the "container"; presentations name their event in the description.
  let container: string | undefined = (Array.isArray(csl['container-title']) ? csl['container-title'][0] : csl['container-title']) || undefined;
  if (container === csl.publisher) container = undefined;
  if (type === 'misc' && abstract) container = /held|presented/i.test(abstract) ? abstract.replace(/\s+(was|were)\s+(held|presented)[\s\S]*$/i, '').replace(/^The\s+/, '') : container;
  const key = keyFor(authors, year, title.replace(/^p-/i, 'p'), used);
  const seriesVolume = SPRINGER_VOLUMES[doi.replace(/_\d+$/, '')];
  // Springer's imprint is cited as "Springer, Cham" throughout, matching sources.yml.
  const springer = /^springer/i.test(csl.publisher ?? '');
  const volume = seriesVolume ?? csl.volume;
  const work: Work = {
    key,
    type,
    ...(genre ? { genre } : {}),
    title,
    authors,
    year,
    ...(volume ? { volume: type === 'book' || type === 'chapter' ? Number(volume) : String(volume) } : {}),
    ...(csl.issue ? { issue: String(csl.issue) } : {}),
    ...(csl.page ? { pages: String(csl.page) } : {}),
    ...(container ? { container } : {}),
    ...(springer ? { publisher: 'Springer', place: 'Cham' } : csl.publisher ? { publisher: csl.publisher } : {}),
    ...(!springer && csl['publisher-place'] ? { place: csl['publisher-place'] } : {}),
    ...(csl.version ? { version: String(csl.version) } : {}),
    doi,
    url: `https://doi.org/${doi}`,
  };
  works.push(work);
  if (RECORD_TYPES.has(orcidType)) {
    items.push({
      key,
      orcidType,
      title,
      ...(abstract ? { abstract } : {}),
      doi,
      url: work.url,
      ...(container ? { container } : {}),
      year,
    });
  }
}

works.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
items.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
await writeFile('data/publications.json', JSON.stringify({ orcid: ORCID, fetched: new Date().toISOString(), works, items }, null, 2) + '\n');
console.log(`data/publications.json: ${works.length} citable works, ${items.length} searchable records`);
for (const p of problems) console.log(`  skipped: ${p}`);
