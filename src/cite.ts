// Reference formatting for the works in the index.

import type { Work } from './types.ts';

export const STYLES = ['apa', 'chicago', 'mla', 'harvard', 'bibtex', 'ris'] as const;
export type Style = (typeof STYLES)[number];

/** APA sentence case: lower-case Capitalized words, keep acronyms and names like causalverse. */
function sentenceCase(title: string): string {
  let first = true;
  return title.replace(/[A-Za-z][\w']*(?:-[A-Za-z][\w']*)*|[:.?!]/g, (word) => {
    if (/^[:.?!]$/.test(word)) {
      first = true;
      return word;
    }
    const out = first
      ? word
      : word.split('-').map((p) => (/^[A-Z][a-z']+$/.test(p) ? p.toLowerCase() : p)).join('-');
    first = false;
    return out;
  });
}

const doiUrl = (w: Work) => (w.doi ? `https://doi.org/${w.doi}` : w.url);
const publisherName = (w: Work) => [w.publisher, w.place].filter(Boolean).join(' ');

function fullTitle(w: Work): string {
  return w.subtitle && !w.title.includes(':') ? `${w.title}: ${w.subtitle}` : w.title;
}

function authorsApa(w: Work): string {
  const names = w.authors.map((a) => `${a.family}, ${a.given.split(/\s+/).map((g) => g[0] + '.').join(' ')}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}` : names[0];
}

function authorsFull(w: Work): string {
  const [first, ...rest] = w.authors;
  const head = `${first.family}, ${first.given}`;
  return rest.length ? `${head}, and ${rest.map((a) => `${a.given} ${a.family}`).join(', ')}` : head;
}

export function formatWork(w: Work, style: Style): string {
  const title = fullTitle(w);
  switch (style) {
    case 'apa': {
      const vol = w.volume ? ` (Vol. ${w.volume})` : '';
      const ver = w.version ? ` (Version ${w.version})` : '';
      const kind = w.type === 'software' ? ' [Computer software]' : '';
      const pub = publisherName(w) ? ` ${publisherName(w)}.` : '';
      return `${authorsApa(w)} (${w.year}). *${sentenceCase(title)}*${vol}${ver}${kind}.${pub} ${doiUrl(w)}`;
    }
    case 'chicago': {
      const vol = w.volume ? ` Vol. ${w.volume}.` : '';
      const ver = w.version ? ` Version ${w.version}.` : '';
      const pub = w.publisher ? ` ${w.place ? `${w.place}: ` : ''}${w.publisher}.` : '';
      return `${authorsFull(w)}. ${w.year}. *${title}*.${vol}${ver}${pub} ${doiUrl(w)}.`;
    }
    case 'mla': {
      const vol = w.volume ? ` Vol. ${w.volume},` : '';
      const ver = w.version ? ` Version ${w.version},` : '';
      const pub = publisherName(w) ? ` ${publisherName(w)},` : '';
      const link = w.doi ? `DOI: ${w.doi}` : w.url;
      return `${authorsFull(w)}. *${title}*.${vol}${ver}${pub} ${w.year}. ${link}.`;
    }
    case 'harvard': {
      const vol = w.volume ? ` Vol. ${w.volume}.` : '';
      const ver = w.version ? ` Version ${w.version}.` : '';
      const pub = publisherName(w) ? ` ${publisherName(w)}.` : '';
      return `${authorsApa(w)} (${w.year}) *${title}*.${vol}${ver}${pub} Available at: ${doiUrl(w)}`;
    }
    case 'bibtex': {
      const type = w.type === 'software' ? 'manual' : w.publisher ? 'book' : 'misc';
      const fields: [string, string | number | undefined][] = [
        ['author', w.authors.map((a) => `${a.family}, ${a.given}`).join(' and ')],
        ['title', `{${title}}`],
        ['year', w.year],
        ['volume', w.volume],
        ['edition', w.edition],
        ['note', w.version ? `Version ${w.version}` : undefined],
        ['publisher', publisherName(w) || undefined],
        ['isbn', w.isbn],
        ['doi', w.doi],
        ['url', w.url],
      ];
      const body = fields
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `  ${k.padEnd(9)} = {${v}}`)
        .join(',\n');
      return `@${type}{${w.key},\n${body}\n}`;
    }
    case 'ris': {
      const lines = [
        `TY  - ${w.type === 'software' ? 'COMP' : 'BOOK'}`,
        ...w.authors.map((a) => `AU  - ${a.family}, ${a.given}`),
        `TI  - ${title}`,
        `PY  - ${w.year}`,
        w.volume ? `VL  - ${w.volume}` : '',
        w.version ? `ET  - ${w.version}` : '',
        publisherName(w) ? `PB  - ${publisherName(w)}` : '',
        w.isbn ? `SN  - ${w.isbn}` : '',
        w.doi ? `DO  - ${w.doi}` : '',
        `UR  - ${w.url}`,
        'ER  - ',
      ];
      return lines.filter(Boolean).join('\n');
    }
  }
}
