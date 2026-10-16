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
const pagesEn = (p?: string) => p?.replace(/-/g, '–');

function fullTitle(w: Work): string {
  return w.subtitle && !w.title.includes(':') ? `${w.title}: ${w.subtitle}` : w.title;
}

function authorsApa(w: Work): string {
  const names = w.authors.map((a) => `${a.family}, ${a.given.split(/[\s-]+/).filter(Boolean).map((g) => g[0] + '.').join(' ')}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')}, & ${names.at(-1)}` : names[0];
}

function authorsFull(w: Work): string {
  const [first, ...rest] = w.authors;
  const head = `${first.family}, ${first.given}`;
  if (!rest.length) return head;
  const tail = rest.map((a) => `${a.given} ${a.family}`);
  return rest.length === 1 ? `${head}, and ${tail[0]}` : `${head}, ${tail.slice(0, -1).join(', ')}, and ${tail.at(-1)}`;
}

function authorsMla(w: Work): string {
  const [first, ...rest] = w.authors;
  const head = `${first.family}, ${first.given}`;
  if (!rest.length) return head;
  if (rest.length === 1) return `${head}, and ${rest[0].given} ${rest[0].family}`;
  return `${head}, et al`;
}

/** Journal articles, book chapters, and datasets; books and software use the original branches. */
function formatPart(w: Work, style: Style): string | null {
  const title = fullTitle(w);
  const container = w.container ?? '';
  const pages = pagesEn(w.pages);
  if (w.type === 'article') {
    const volIssue = [w.volume, w.issue ? `(${w.issue})` : ''].join('');
    switch (style) {
      case 'apa':
        return `${authorsApa(w)} (${w.year}). ${sentenceCase(title)}. *${container}*${w.volume ? `, *${w.volume}*` : ''}${w.issue ? `(${w.issue})` : ''}${pages ? `, ${pages}` : ''}. ${doiUrl(w)}`;
      case 'chicago':
        return `${authorsFull(w)}. ${w.year}. "${title}." *${container}*${w.volume ? ` ${w.volume}` : ''}${w.issue ? ` (${w.issue})` : ''}${pages ? `: ${pages}` : ''}. ${doiUrl(w)}.`;
      case 'mla':
        return `${authorsMla(w)}. "${title}." *${container}*${w.volume ? `, vol. ${w.volume}` : ''}${w.issue ? `, no. ${w.issue}` : ''}, ${w.year}${pages ? `, pp. ${pages}` : ''}. ${w.doi ? `DOI: ${w.doi}` : w.url}.`;
      case 'harvard':
        return `${authorsApa(w)} (${w.year}) '${title}', *${container}*${volIssue ? `, ${volIssue}` : ''}${pages ? `, pp. ${pages}` : ''}. Available at: ${doiUrl(w)}`;
      default:
        return null;
    }
  }
  if (w.type === 'chapter') {
    const vol = w.volume ? `Vol. ${w.volume}` : '';
    const loc = [vol, pages ? `pp. ${pages}` : ''].filter(Boolean).join(', ');
    switch (style) {
      case 'apa':
        return `${authorsApa(w)} (${w.year}). ${sentenceCase(title)}. In *${sentenceCase(container)}*${loc ? ` (${loc})` : ''}. ${publisherName(w)}. ${doiUrl(w)}`;
      case 'chicago':
        return `${authorsFull(w)}. ${w.year}. "${title}." In *${container}*${w.volume ? `, vol. ${w.volume}` : ''}${pages ? `, ${pages}` : ''}. ${w.place ? `${w.place}: ` : ''}${w.publisher ?? ''}. ${doiUrl(w)}.`;
      case 'mla':
        return `${authorsMla(w)}. "${title}." *${container}*${w.volume ? `, vol. ${w.volume}` : ''}, ${w.publisher ?? ''}, ${w.year}${pages ? `, pp. ${pages}` : ''}. ${w.doi ? `DOI: ${w.doi}` : w.url}.`;
      case 'harvard':
        return `${authorsApa(w)} (${w.year}) '${title}', in *${container}*${w.volume ? `, Vol. ${w.volume}` : ''}. ${publisherName(w)}${pages ? `, pp. ${pages}` : ''}. Available at: ${doiUrl(w)}`;
      default:
        return null;
    }
  }
  if (w.type === 'dataset' || w.type === 'misc') {
    const ver = w.version ? ` (Version ${w.version})` : '';
    const genre = w.type === 'dataset' ? 'Data set' : (w.genre ?? 'Document');
    const venue = w.container ? ` ${w.container}.` : '';
    switch (style) {
      case 'apa':
        return `${authorsApa(w)} (${w.year}). *${sentenceCase(title)}*${ver} [${genre}].${venue} ${publisherName(w)}. ${doiUrl(w)}`;
      case 'chicago':
        return `${authorsFull(w)}. ${w.year}. "${title}." ${genre}.${venue} ${w.publisher ?? ''}. ${doiUrl(w)}.`;
      case 'mla':
        return `${authorsMla(w)}. *${title}*.${venue} ${w.publisher ?? ''}, ${w.year}. ${w.doi ? `DOI: ${w.doi}` : w.url}.`;
      case 'harvard':
        return `${authorsApa(w)} (${w.year}) *${title}* [${genre}].${venue} ${publisherName(w)}. Available at: ${doiUrl(w)}`;
      default:
        return null;
    }
  }
  return null;
}

export function formatWork(w: Work, style: Style): string {
  const part = formatPart(w, style);
  if (part) return part;
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
      const type =
        w.type === 'article' ? 'article'
        : w.type === 'chapter' ? 'incollection'
        : w.type === 'dataset' || w.type === 'misc' ? 'misc'
        : w.type === 'software' ? 'manual'
        : w.publisher ? 'book' : 'misc';
      const fields: [string, string | number | undefined][] = [
        ['author', w.authors.map((a) => `${a.family}, ${a.given}`).join(' and ')],
        ['title', `{${title}}`],
        ['journal', w.type === 'article' ? w.container : undefined],
        ['booktitle', w.type === 'chapter' ? w.container : undefined],
        ['year', w.year],
        ['volume', w.volume],
        ['number', w.issue],
        ['pages', w.pages?.replace(/-+/g, '--')],
        ['edition', w.edition],
        ['howpublished', w.type === 'misc' && w.container ? w.container : undefined],
        ['note', w.version ? `Version ${w.version}` : w.type === 'dataset' ? 'Data set' : w.type === 'misc' ? w.genre : undefined],
        ['publisher', w.type === 'article' ? undefined : publisherName(w) || undefined],
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
      const ty = { article: 'JOUR', chapter: 'CHAP', dataset: 'DATA', software: 'COMP', book: 'BOOK', misc: w.genre === 'Presentation' ? 'SLIDE' : 'GEN' }[w.type];
      const [sp, ep] = (w.pages ?? '').split(/-+/);
      const lines = [
        `TY  - ${ty}`,
        ...w.authors.map((a) => `AU  - ${a.family}, ${a.given}`),
        `TI  - ${title}`,
        w.type === 'article' && w.container ? `JO  - ${w.container}` : '',
        w.type === 'chapter' && w.container ? `T2  - ${w.container}` : '',
        `PY  - ${w.year}`,
        w.volume ? `VL  - ${w.volume}` : '',
        w.issue ? `IS  - ${w.issue}` : '',
        sp ? `SP  - ${sp}` : '',
        ep ? `EP  - ${ep}` : '',
        w.version ? `ET  - ${w.version}` : '',
        w.type !== 'article' && publisherName(w) ? `PB  - ${publisherName(w)}` : '',
        w.isbn ? `SN  - ${w.isbn}` : '',
        w.doi ? `DO  - ${w.doi}` : '',
        `UR  - ${w.url}`,
        'ER  - ',
      ];
      return lines.filter(Boolean).join('\n');
    }
  }
}
