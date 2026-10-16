// Regenerates the parts of the README that describe the index, so they always match
// what the server serves: the Sources table (between <!-- sources:start --> and
// <!-- sources:end -->) and the section count in the introduction.
//   npm run update-docs   (also run by npm run build:index)

import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { formatWork } from '../src/cite.ts';
import type { LibraryIndex } from '../src/types.ts';

const index = JSON.parse(gunzipSync(await readFile('data/index.json.gz')).toString()) as LibraryIndex;
const works = new Map(index.works.map((w) => [w.key, w]));
const lang = (l: string) => ({ r: 'R', python: 'Python', julia: 'Julia', bash: '' } as Record<string, string>)[l] ?? l;
/** SPDX-style ids as they are usually written: CC-BY-NC-SA-4.0 -> CC BY-NC-SA 4.0. */
const spdx = (id: string) =>
  id === 'All-Rights-Reserved' ? 'All rights reserved'
  : id.startsWith('CC-') ? id.replace(/^CC-(.*)-(\d\.\d)$/, 'CC $1 $2')
  : id;
const license = (l: { text: string; code: string }) => {
  const t = spdx(l.text);
  const c = l.code === 'unspecified' ? '' : spdx(l.code);
  return !c || c === t ? t : `${t} text, ${c} code`;
};

const rows = index.sources.map((s) => {
  const code = s.languages.map(lang).filter(Boolean).join(', ') || '—';
  const served =
    s.format === 'publications' ? 'Abstracts, DOIs, and citations'
    : s.text_access === 'full' ? (s.format === 'r-package' ? 'Full text and function reference' : 'Full text')
    : s.code_blocks ? 'Excerpts and code; full text on the website' : 'Excerpts; full text on the website';
  const terms = s.format === 'publications' ? "Publishers' terms" : license(s.license);
  return `| [${s.title}](${s.site}) | ${code} | ${s.sections.toLocaleString('en-US')} | ${served} | ${terms} |`;
});

const vol = works.get('Nguyen2025Vol4');
const chapter = index.works.find((w) => w.type === 'chapter' && w.title === 'Causal Inference');
const table = [
  '<!-- sources:start -->',
  '| Work | Code | Sections | Served | License |',
  '| --- | --- | ---: | --- | --- |',
  ...rows,
  '',
  `Sections of *A Guide on Data Analysis* that appear in the Springer print volumes are cited as their published chapter, then the volume. For example, a section on causal inference is cited as ${chapter ? formatWork(chapter, 'apa') : ''}${vol ? `, in ${formatWork(vol, 'apa')}` : ''}`,
  '<!-- sources:end -->',
].join('\n');

const sections = index.records.length;
const rounded = `approximately ${(Math.floor(sections / 1000) * 1000).toLocaleString('en-US')}`;
const books = index.sources.filter((s) => s.format !== 'r-package' && s.format !== 'publications').length;
const packages = index.sources.filter((s) => s.format === 'r-package').length;

let readme = await readFile('README.md', 'utf8');
if (!readme.includes('<!-- sources:start -->')) {
  readme = readme.replace(/(## Sources\n\n)[\s\S]*?(\n## )/, `$1${table}\n$2`);
} else {
  readme = readme.replace(/<!-- sources:start -->[\s\S]*?<!-- sources:end -->/, table);
}
readme = readme.replace(
  /Its index contains approximately [\d,]+ sections from [^(]+\(listed under \[Sources\]\(#sources\)\)/,
  `Its index contains ${rounded} sections from ${books} books, ${packages === 1 ? 'an R package' : `${packages} R packages`}, and the author's research articles (listed under [Sources](#sources))`,
);
await writeFile('README.md', readme);
console.log(`README: ${index.sources.length} sources, ${sections} sections`);
