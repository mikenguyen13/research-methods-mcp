// The in-memory library: index loading, search, code lookup, method matching,
// and citations. Runtime-agnostic (Node, Deno, Workers): no fs, no node: imports.

import MiniSearch from 'minisearch';
import { formatWork, type Style } from './cite.ts';
import type { LibraryIndex, MethodEntry, SectionRecord, SourceMeta, Work } from './types.ts';

export const LANGUAGES = ['r', 'python', 'julia'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Longest text a single `fetch` returns; longer sections continue at `<id>@2`, `<id>@3`, ... */
const PART_CHARS = 40_000;

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i if in into is it its me my of on or our should so that the their them then there these this to use using vs was we what when where which while who why will with you your'.split(' '),
);

const processTerm = (term: string) => {
  const t = term.toLowerCase();
  return t.length < 2 || STOP.has(t) ? null : t;
};

const tokenize = (text: string) => text.split(/[\s\-–—/,.;:!?()[\]{}"'`*_#=<>|+~^$\\]+/u).filter(Boolean);

/** Light suffix stripping so "randomized", "randomization", and "randomize" agree. */
function stem(t: string): string {
  for (const suffix of ['ations', 'ation', 'ings', 'ing', 'edly', 'ed', 'es', 's', 'e']) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 4) return t.slice(0, -suffix.length);
  }
  return t;
}

const stems = (text: string) => tokenize(text).map(processTerm).filter((t): t is string => Boolean(t)).map(stem);

export function proseOf(md: string): string {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
}

export function codeBlocks(md: string): { lang: string; code: string }[] {
  return [...md.matchAll(/```(\w+)\n([\s\S]*?)\n```/g)].map((m) => ({ lang: m[1], code: m[2] }));
}

export interface SearchOptions {
  source?: string;
  language?: Language;
  limit?: number;
  /** Only sections that contain code (in `language`, if given). */
  withCode?: boolean;
}

export interface SearchHit {
  id: string;
  title: string;
  url: string;
  source: string;
  path: string;
  snippet: string;
  languages: string[];
  cite_as: string;
}

/** Options for the section search index. Building and loading a serialized index must use the same options. */
const SECTION_SEARCH_OPTIONS: ConstructorParameters<typeof MiniSearch<SectionRecord>>[0] = {
  fields: ['title', 'crumbs', 'pkgs', 'prose'],
  extractField: (doc, field) => {
    if (field === 'id') return doc.id;
    if (field === 'crumbs') return doc.crumbs.join(' ');
    if (field === 'pkgs') return doc.pkgs.join(' ').replace(/::/g, ' ');
    if (field === 'prose') return proseOf(doc.md).slice(0, 6000);
    return (doc as unknown as Record<string, string>)[field];
  },
  tokenize,
  processTerm,
  searchOptions: {
    boost: { title: 5, crumbs: 1.5, pkgs: 2.5, prose: 1 },
    prefix: (term) => term.length > 4,
    fuzzy: (term) => (term.length > 6 ? 0.15 : false),
    combineWith: 'OR',
  },
};

/** Builds the section search index from scratch (about 2 s of CPU for the full library). */
export function buildSectionSearch(records: SectionRecord[]): MiniSearch<SectionRecord> {
  const search = new MiniSearch<SectionRecord>(SECTION_SEARCH_OPTIONS);
  search.addAll(records);
  return search;
}

/**
 * The contents of data/search.json.gz: a JSON header line naming the index build it belongs to,
 * then the serialized search index.
 */
export function serializeSectionSearch(index: LibraryIndex): string {
  const header = JSON.stringify({ built: index.built, records: index.records.length });
  return `${header}\n${JSON.stringify(buildSectionSearch(index.records))}`;
}

async function gunzipText(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class Library {
  readonly index: LibraryIndex;
  readonly byId: Map<string, SectionRecord>;
  readonly works: Map<string, Work>;
  readonly sources: Map<string, SourceMeta>;
  private sectionSearch?: MiniSearch<SectionRecord>;
  private methodSearch: MiniSearch<MethodEntry>;

  /**
   * @param searchJson Serialized section search index (data/search.json.gz, unzipped). When given, it is
   * loaded instead of rebuilt; either way the index is created on first search, not at startup, so
   * connections that only list tools cost almost no CPU.
   */
  constructor(index: LibraryIndex, private searchJson?: string) {
    this.index = index;
    this.byId = new Map(index.records.map((r) => [r.id, r]));
    this.works = new Map(index.works.map((w) => [w.key, w]));
    this.sources = new Map(index.sources.map((s) => [s.id, s]));

    this.methodSearch = new MiniSearch<MethodEntry>({
      fields: ['name', 'keywords', 'use_when', 'family'],
      extractField: (doc, field) => {
        const v = (doc as unknown as Record<string, unknown>)[field];
        return Array.isArray(v) ? v.join(' ') : String(v ?? '');
      },
      tokenize,
      processTerm,
      searchOptions: {
        boost: { name: 3, keywords: 3, use_when: 1.2, family: 0.5 },
        prefix: (term) => term.length > 4,
        fuzzy: (term) => (term.length > 6 ? 0.15 : false),
      },
    });
    this.methodSearch.addAll(index.methods);
    this.methodPhrases = index.methods.map((m) => ({ id: m.id, phrases: [m.name, ...m.keywords].map(stems) }));
  }

  private methodPhrases: { id: string; phrases: string[][] }[];

  /** The section search index, loaded or built on first use. */
  private get search_(): MiniSearch<SectionRecord> {
    if (!this.sectionSearch) {
      const json = this.searchJson;
      this.searchJson = undefined;
      this.sectionSearch = json
        ? MiniSearch.loadJSON<SectionRecord>(json, SECTION_SEARCH_OPTIONS)
        : buildSectionSearch(this.index.records);
    }
    return this.sectionSearch;
  }

  /**
   * Builds a library from the gzipped index bytes, and optionally the gzipped search index file
   * (see `serializeSectionSearch`), in any runtime with DecompressionStream. A search index built
   * from a different index is ignored, and the search index is then rebuilt on first use.
   */
  static async fromGzip(bytes: Uint8Array, searchBytes?: Uint8Array): Promise<Library> {
    const index = JSON.parse(await gunzipText(bytes)) as LibraryIndex;
    let searchJson: string | undefined;
    if (searchBytes) {
      const text = await gunzipText(searchBytes);
      const newline = text.indexOf('\n');
      const header = JSON.parse(text.slice(0, newline)) as { built?: string };
      if (header.built === index.built) searchJson = text.slice(newline + 1);
      else console.error(`search index is for ${header.built}, not ${index.built}; rebuilding on first search`);
    }
    return new Library(index, searchJson);
  }

  // -------------------------------------------------------------------------
  // Citations

  /** Works to cite for a record, most specific first (e.g. a Springer volume, then the online book). */
  worksFor(record: SectionRecord): Work[] {
    return record.cite.map((k) => this.works.get(k)).filter((w): w is Work => Boolean(w));
  }

  citeAs(record: SectionRecord, style: Style = 'apa'): string {
    const [primary] = this.worksFor(record);
    return primary ? formatWork(primary, style) : '';
  }

  sourceCitation(source: SourceMeta, style: Style = 'apa'): string {
    const w = this.works.get(source.citation);
    return w ? formatWork(w, style) : '';
  }

  pathOf(record: SectionRecord): string {
    const src = this.sources.get(record.source);
    return [src?.title ?? record.source, ...record.crumbs, record.title].join(' > ');
  }

  // -------------------------------------------------------------------------
  // Search

  search(query: string, opts: SearchOptions = {}): SearchHit[] {
    const limit = Math.min(Math.max(opts.limit ?? 8, 1), 25);
    const raw = this.search_.search(query, {
      filter: (r) => {
        const rec = this.byId.get(r.id)!;
        if (opts.source && rec.source !== opts.source) return false;
        if (opts.withCode && rec.langs.length === 0) return false;
        if (opts.language && opts.withCode && !rec.langs.includes(opts.language)) return false;
        return true;
      },
    });
    // Prefer sections in the requested language without excluding prose-only sections,
    // and keep one page from crowding out the rest.
    const scored = raw.map((r) => {
      const rec = this.byId.get(r.id)!;
      let score = r.score;
      if (opts.language && rec.langs.includes(opts.language)) score *= 1.4;
      if (rec.level === 1 && proseOf(rec.md).length < 400) score *= 0.6;
      return { rec, score, terms: r.terms };
    });
    scored.sort((a, b) => b.score - a.score);
    const perPage = new Map<string, number>();
    const hits: SearchHit[] = [];
    for (const { rec, terms } of scored) {
      const page = rec.id.split('#')[0];
      const n = perPage.get(page) ?? 0;
      if (n >= 3) continue;
      perPage.set(page, n + 1);
      hits.push({
        id: rec.id,
        title: rec.title,
        url: rec.url,
        source: rec.source,
        path: this.pathOf(rec),
        snippet: snippet(proseOf(rec.md), terms),
        languages: rec.langs,
        cite_as: this.citeAs(rec),
      });
      if (hits.length >= limit) break;
    }
    return hits;
  }

  // -------------------------------------------------------------------------
  // Fetch

  /** A section by id; `<id>@2` returns the second part of a long section. */
  fetch(idWithPart: string) {
    const m = /^(.*?)(?:@(\d+))?$/.exec(idWithPart.trim())!;
    const rec = this.byId.get(m[1]);
    if (!rec) return null;
    const parts = splitParts(rec.md, PART_CHARS);
    const part = Math.min(Math.max(Number(m[2] ?? 1), 1), parts.length);
    const src = this.sources.get(rec.source)!;
    const works = this.worksFor(rec);
    const citeAs = works[0] ? formatWork(works[0], 'apa') : '';
    const body = parts[part - 1];
    const more = part < parts.length ? `\n\n[Section continues: fetch id \`${rec.id}@${part + 1}\` for part ${part + 1} of ${parts.length}.]` : '';
    const teaserNote = src.text_access === 'teaser'
      ? `\n\n[The full text of this section is on the book's website: ${rec.url}]`
      : '';
    const text =
      `# ${rec.title}\n\n_${this.pathOf(rec)}_\n\n${body}${more}${teaserNote}\n\n---\n` +
      `Source: ${citeAs}\nSection: "${rec.title}", ${rec.url}`;
    return {
      id: part > 1 ? `${rec.id}@${part}` : rec.id,
      title: rec.title,
      text,
      url: rec.url,
      metadata: {
        source: rec.source,
        work: src.title,
        path: this.pathOf(rec),
        languages: rec.langs,
        packages: rec.pkgs,
        text_access: src.text_access,
        license: src.license,
        part,
        parts: parts.length,
        cite_as: citeAs,
        cite_keys: rec.cite,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Code

  code(topic: string, opts: { language?: Language; source?: string; limit?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 4, 1), 10);
    let hits = this.search(topic, { ...opts, withCode: true, limit: limit * 3 });
    let note = '';
    if (opts.language && !hits.length) {
      hits = this.search(topic, { source: opts.source, withCode: true, limit: limit * 3 });
      if (hits.length) {
        const langs = [...new Set(hits.flatMap((h) => h.languages))].join(', ');
        note = `No ${opts.language} code for this topic in the library; showing ${langs} code instead.`;
        const method = this.methods(topic, 1)[0];
        const pkgs = method?.packages[opts.language as 'r' | 'python'];
        if (pkgs?.length) note += ` ${opts.language} packages for ${method.name}: ${pkgs.join(', ')}.`;
      }
    }
    const results = [];
    let budget = 16_000;
    for (const h of hits) {
      const rec = this.byId.get(h.id)!;
      const blocks = codeBlocks(rec.md)
        .filter((b) => ['r', 'python', 'julia', 'stan', 'sql', 'bash', 'cpp'].includes(b.lang))
        .filter((b) => !opts.language || note || b.lang === opts.language)
        .slice(0, 4);
      const kept = [];
      for (const b of blocks) {
        if (b.code.length > budget) break;
        budget -= b.code.length;
        kept.push(b);
      }
      if (!kept.length) continue;
      results.push({
        id: rec.id,
        title: rec.title,
        url: rec.url,
        path: h.path,
        packages: rec.pkgs.filter((p) => !p.includes('::')).slice(0, 12),
        blocks: kept.map((b) => ({ language: b.lang, code: b.code })),
        cite_as: h.cite_as,
      });
      if (results.length >= limit || budget < 500) break;
    }
    return { note, results };
  }

  // -------------------------------------------------------------------------
  // Methods

  /**
   * Ranks catalog methods for a question. Two signals: the question's match
   * against each method's name, keywords, and use case, and the sections of
   * the books that match the question, each voting for the methods that cite
   * that section (or another section on the same page). The second signal
   * catches paraphrases the keywords miss, e.g. "only California passed the
   * law" finds the synthetic control chapter's Proposition 99 example.
   */
  methods(question: string, limit = 4): MethodEntry[] {
    const total = new Map<string, number>();
    const add = (id: string, v: number) => total.set(id, (total.get(id) ?? 0) + v);

    // Keyword phrases count only when every word of the phrase is in the question,
    // and longer phrases count more, so "missing data" does not fire on "data".
    const q = new Set(stems(question));
    const phrase = this.methodPhrases.map(({ id, phrases }) => ({
      id,
      score: phrases.reduce((s, p) => (p.length && p.every((t) => q.has(t)) ? s + p.length ** 1.5 : s), 0),
    }));
    const p0 = Math.max(...phrase.map((p) => p.score)) || 1;
    for (const p of phrase) if (p.score) add(p.id, p.score / p0);

    const direct = this.methodSearch.search(question, { fields: ['use_when', 'name'] });
    const d0 = direct[0]?.score || 1;
    for (const r of direct) add(String(r.id), (0.3 * r.score) / d0);

    const hits = this.search_.search(question).slice(0, 25);
    const h0 = hits[0]?.score || 1;
    const evidence = new Map<string, number>();
    hits.forEach((h, rank) => {
      const page = String(h.id).split('#')[0];
      const w = h.score / h0 / (1 + rank * 0.15);
      for (const m of this.index.methods) {
        const v = m.sections.includes(String(h.id)) ? 0.5 * w : m.sections.some((s) => s.split('#')[0] === page) ? 0.2 * w : 0;
        if (v) evidence.set(m.id, (evidence.get(m.id) ?? 0) + v);
      }
    });
    for (const [id, v] of evidence) add(id, Math.min(v, 1.5));

    return [...total.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => this.index.methods.find((m) => m.id === id)!);
  }

  describeMethod(m: MethodEntry, language?: Language) {
    const sections = m.sections
      .map((id) => this.byId.get(id))
      .filter((r): r is SectionRecord => Boolean(r))
      .map((r) => ({ id: r.id, title: r.title, url: r.url, source: r.source, languages: r.langs, cite_as: this.citeAs(r) }));
    const packages = language
      ? { [language]: m.packages[language as 'r' | 'python'] ?? [] }
      : m.packages;
    return {
      id: m.id,
      name: m.name,
      family: m.family,
      use_when: m.use_when,
      assumptions: m.assumptions,
      ...(m.avoid_when ? { avoid_when: m.avoid_when } : {}),
      packages,
      sections,
    };
  }
}

function snippet(prose: string, terms: string[], width = 260): string {
  const lower = prose.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 80);
  const cut = prose.slice(start, start + width).trim();
  return (start > 0 ? '…' : '') + cut + (start + width < prose.length ? '…' : '');
}

function splitParts(md: string, max: number): string[] {
  if (md.length <= max) return [md];
  const parts: string[] = [];
  let rest = md;
  while (rest.length > max) {
    // Cut at a paragraph break outside a code fence.
    let cut = -1;
    for (const m of rest.slice(0, max).matchAll(/\n\n/g)) {
      const before = rest.slice(0, m.index);
      if ((before.match(/```/g) ?? []).length % 2 === 0) cut = m.index!;
    }
    if (cut < max / 4) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut);
  }
  parts.push(rest.trim());
  return parts;
}
