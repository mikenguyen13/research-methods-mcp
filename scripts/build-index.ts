// Builds data/index.json.gz from the book repositories listed in sources.yml.
//
//   npm run build:index                 # sources are sibling folders of this repo
//   SOURCES_ROOT=/path npm run build:index
//
// No knitting or rendering happens here: the .Rmd/.qmd/.Rd sources are parsed
// directly, so a rebuild takes seconds and needs neither R nor Python.

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import YAML from 'yaml';
import type { LibraryIndex, MethodEntry, SectionRecord, SourceMeta, TextAccess, Work } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const sourcesRoot = path.resolve(process.env.SOURCES_ROOT ?? path.join(repoRoot, '..'));

interface SourceConfig {
  id: string;
  title: string;
  summary: string;
  repo: string;
  format: SourceMeta['format'];
  site: string;
  github: string;
  text_access: TextAccess;
  license: { text: string; code: string };
  exclude?: string[];
  citation: Omit<Work, 'url'> & { url: string };
  /**
   * Chapter files that appear in a print volume, cited as that volume. `chapters` maps a
   * file to the DOI of its published chapter (from data/publications.json), which is
   * cited first.
   */
  volume_citations?: { files: string[]; citation: Work; chapters?: Record<string, string> }[];
}

/** Chapter works from data/publications.json, by DOI (lowercase); filled in main(). */
const chapterByDoi = new Map<string, Work>();

/** Old and new prefixes of sites that moved (sources.yml `moved`); filled in main(). */
let movedSites: { from: string; to: string }[] = [];
const unmove = (text: string) => movedSites.reduce((t, m) => t.split(m.from).join(m.to).split(m.from.replace(/\/$/, ')')).join(m.to.replace(/\/$/, ')')), text);

const CODE_LANGS = new Set(['r', 'python', 'julia', 'stan', 'sql', 'bash', 'cpp']);
const LANG_ALIASES: Record<string, string> = {
  py: 'python', python3: 'python', rscript: 'r', rcpp: 'cpp', 'c++': 'cpp',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', powershell: 'bash',
};
const TEASER_WORDS = 45;

const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

// ---------------------------------------------------------------------------
// Pandoc-compatible identifiers

/** Pandoc's `auto_identifiers` algorithm, which bookdown and Quarto both use. */
/**
 * Pandoc's `auto_identifiers` algorithm, which bookdown and Quarto both use.
 * Smart typography runs first, so `--`, `---` and `...` become dashes and an
 * ellipsis and are dropped; runs of whitespace collapse to a single hyphen.
 * pkgdown additionally rewrites `.` to `-`.
 */
export function pandocId(title: string, style: IdStyle = 'pandoc'): string {
  let s = title
    .replace(/\^\[[^\]]*\]/g, '')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/-{2,3}|\.\.\./g, '—')
    .toLowerCase();
  s = [...s].filter((c) => /[\p{L}\p{N}_.\-\s]/u.test(c)).join('');
  s = s.split(/\s+/).filter(Boolean).join('-');
  if (style === 'pkgdown') s = s.replace(/\./g, '-');
  s = s.replace(/^[^\p{L}]+/u, '');
  return s || 'section';
}

type IdStyle = 'pandoc' | 'pkgdown' | 'sphinx';

/** Docutils `make_id`, which Sphinx and Jupyter Book use for section anchors. */
export function sphinxId(title: string): string {
  const s = title
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[-0-9]+|-+$/g, '');
  return s || 'section';
}

class IdRegistry {
  private used = new Set<string>();
  constructor(private style: IdStyle = 'pandoc') {}
  claim(explicit: string | undefined, title: string): string {
    if (explicit) {
      this.used.add(explicit);
      return explicit;
    }
    const base = this.style === 'sphinx' ? sphinxId(title) : pandocId(title, this.style);
    let id = base;
    for (let i = 1; this.used.has(id); i++) id = `${base}-${i}`;
    this.used.add(id);
    return id;
  }
}

// ---------------------------------------------------------------------------
// Markdown (Rmd/qmd) tokenizer

interface Header { kind: 'header'; level: number; title: string; id?: string; classes: string[]; file: string }
interface Line { kind: 'line'; text: string }
interface Code { kind: 'code'; lang: string; src: string }
type Token = Header | Line | Code;

function splitFrontMatter(text: string): { yaml: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n/.exec(text);
  if (!m) return { yaml: {}, body: text };
  let yaml: Record<string, unknown> = {};
  try {
    yaml = (YAML.parse(m[1]) as Record<string, unknown>) ?? {};
  } catch {
    const t = /^title:\s*["']?(.*?)["']?\s*$/m.exec(m[1]);
    if (t) yaml = { title: t[1] };
  }
  return { yaml, body: text.slice(m[0].length) };
}

function parseAttrs(raw: string): { id?: string; classes: string[] } {
  const classes: string[] = [];
  let id: string | undefined;
  for (const part of raw.trim().split(/\s+/)) {
    if (part.startsWith('#')) id = part.slice(1);
    else if (part.startsWith('.')) classes.push(part.slice(1));
    else if (part === '-') classes.push('unnumbered');
  }
  return { id, classes };
}

function parseChunkInfo(info: string): { lang: string | null; hidden: boolean } {
  const s = info.trim();
  if (!s) return { lang: 'text', hidden: false };
  const inner = s.startsWith('{') ? s.replace(/^\{/, '').replace(/\}\s*$/, '') : s;
  if (inner.startsWith('=')) return { lang: null, hidden: true }; // raw {=html} / {=latex}
  const m = /^\.?([A-Za-z][\w+-]*)/.exec(inner.trim());
  let lang = (m?.[1] ?? 'text').toLowerCase();
  lang = LANG_ALIASES[lang] ?? lang;
  const hidden = /\b(echo|include)\s*=\s*(F|FALSE)\b/.test(inner);
  return { lang, hidden };
}

const HTML_LINE = /^\s*<\/?(div|span|br|hr|center|p|figure|figcaption|details|summary|iframe|img|style|script|table|tr|td|th|ul|li|a)\b[^>]*>\s*$/i;

function tokenize(text: string, file: string): { yaml: Record<string, unknown>; tokens: Token[] } {
  const normalized = text.replace(/\r\n?/g, '\n');
  const { yaml, body } = splitFrontMatter(normalized);
  const cleaned = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  const lines = cleaned.split('\n');
  const tokens: Token[] = [];
  // Fenced divs. A heading inside a callout, tabset, or theorem box becomes a
  // title or tab label, not a section anchor, so it stays body text. Only
  // conditional-content divs are transparent.
  const divs: boolean[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const div = /^\s*:{3,}\s*(.*?)\s*$/.exec(line);
    if (div) {
      if (div[1] === '') divs.pop();
      else divs.push(/content-(visible|hidden)/.test(div[1]));
      continue;
    }
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const [, , marks, info] = fence;
      const close = new RegExp(`^\\s*${marks[0] === '`' ? '`' : '~'}{${marks.length},}\\s*$`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j])) body.push(lines[j++]);
      i = j;
      const { lang, hidden } = parseChunkInfo(info);
      if (!lang || hidden) continue;
      if (body.some((l) => /^#\|\s*(echo|include):\s*false/.test(l))) continue;
      const src = body.filter((l) => !/^#\|/.test(l)).join('\n').replace(/^\n+|\s+$/g, '');
      if (!src) continue;
      if (/^\s*knitr::include_graphics\(/.test(src) && src.split('\n').length <= 2) continue;
      tokens.push({ kind: 'code', lang, src });
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      let title = h[2];
      let attrs: { id?: string; classes: string[] } = { classes: [] };
      const a = /\s*\{([^{}]*)\}\s*$/.exec(title);
      if (a) {
        attrs = parseAttrs(a[1]);
        title = title.slice(0, a.index).trim();
      }
      title = title.replace(/\s+#+\s*$/, '').trim();
      if (divs.every(Boolean)) {
        tokens.push({ kind: 'header', level: h[1].length, title, id: attrs.id, classes: attrs.classes, file });
      } else {
        tokens.push({ kind: 'line', text: `**${title}**` });
      }
      continue;
    }
    if (HTML_LINE.test(line) || /^\s*\\(newpage|clearpage|pagebreak)\b/.test(line)) continue;
    tokens.push({ kind: 'line', text: line.replace(/!\[[^\]]*\]\([^)]*\)(\{[^}]*\})?/g, '') });
  }
  return { yaml, tokens };
}

// ---------------------------------------------------------------------------
// Sections

interface Draft {
  source: string;
  title: string;
  level: number;
  crumbs: string[];
  page: string; // page path without .html, e.g. "sec-endogeneity" or "chapters/01-intro"
  anchor?: string;
  file: string;
  body: Token[];
}

function renderBody(tokens: Token[]): string {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'line') out.push(t.text);
    else if (t.kind === 'code') out.push('```' + t.lang, t.src, '```');
    else out.push(`${'#'.repeat(Math.max(t.level, 4))} ${t.title}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function codeOf(tokens: Token[]): Code[] {
  return tokens.filter((t): t is Code => t.kind === 'code' && CODE_LANGS.has(t.lang));
}

function packagesOf(code: Code[]): string[] {
  const found = new Set<string>();
  for (const c of code) {
    if (c.lang === 'r') {
      for (const m of c.src.matchAll(/\b(?:library|require|requireNamespace)\(\s*["']?([A-Za-z][\w.]*)/g)) found.add(m[1]);
      for (const m of c.src.matchAll(/\b([A-Za-z][\w.]*)::([A-Za-z_.][\w.]*)/g)) {
        found.add(m[1]);
        found.add(`${m[1]}::${m[2]}`);
      }
    } else if (c.lang === 'python') {
      for (const m of c.src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
        found.add((m[1] ?? m[2]).split('.')[0]);
      }
    }
  }
  return [...found].map((p) => p.toLowerCase()).slice(0, 40);
}

function teaser(tokens: Token[], words: number): string {
  const prose = tokens
    .filter((t): t is Line => t.kind === 'line')
    .map((t) => t.text)
    .filter((l) => l.trim() && !/^\s*(\$\$|\\\[|\||>)/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  if (!prose[0]) return '';
  return prose.length > words ? prose.slice(0, words).join(' ') + ' …' : prose.join(' ');
}

// ---------------------------------------------------------------------------
// Per-format readers

async function bookdownDrafts(src: SourceConfig, dir: string): Promise<Draft[]> {
  const files = (await readdir(dir))
    .filter((f) => /\.Rmd$/i.test(f) && !f.startsWith('_') && !(src.exclude ?? []).includes(f))
    .sort((a, b) => (a === 'index.Rmd' ? -1 : b === 'index.Rmd' ? 1 : a.localeCompare(b, 'en')));
  const ids = new IdRegistry();
  const drafts: Draft[] = [];
  let page: string | null = null;
  let chapter = '';
  let stack: string[] = [];
  let current: Draft | null = null;
  let firstChapter = true;
  for (const file of files) {
    const { tokens } = tokenize(await readFile(path.join(dir, file), 'utf8'), file);
    for (const t of tokens) {
      if (t.kind === 'header' && t.level <= 3) {
        if (/^\((PART|APPENDIX)\\?\*?\)/.test(t.title)) {
          ids.claim(t.id, t.title);
          current = null;
          continue;
        }
        const anchor = ids.claim(t.id, t.title);
        if (t.level === 1) {
          page = firstChapter ? 'index' : anchor;
          firstChapter = false;
          chapter = t.title;
          stack = [];
          current = { source: src.id, title: t.title, level: 1, crumbs: [], page, file, body: [] };
        } else {
          if (!page) continue;
          stack = stack.slice(0, t.level - 2);
          current = {
            source: src.id, title: t.title, level: t.level, crumbs: [chapter, ...stack.filter(Boolean)],
            page, anchor, file, body: [],
          };
          stack[t.level - 2] = t.title;
        }
        drafts.push(current);
      } else if (current) {
        if (t.kind === 'header') ids.claim(t.id, t.title);
        current.body.push(t);
      }
    }
  }
  return drafts;
}

function quartoChapterFiles(config: any): string[] {
  const out: string[] = [];
  const walk = (items: unknown[]) => {
    for (const item of items ?? []) {
      if (typeof item === 'string') out.push(item);
      else if (item && typeof item === 'object') {
        const o = item as { part?: string; chapters?: unknown[]; href?: string };
        if (o.href) out.push(o.href);
        if (o.part && /\.(q?md|Rmd)$/i.test(o.part)) out.push(o.part);
        if (o.chapters) walk(o.chapters);
      }
    }
  };
  walk(config?.book?.chapters ?? []);
  walk(config?.book?.appendices ?? []);
  return out;
}

/** One page per file: Quarto chapters and pkgdown articles. */
function pageDrafts(
  src: SourceConfig, file: string, page: string, text: string, crumbs: string[], fallbackTitle: string,
): Draft[] {
  const { yaml, tokens } = tokenize(text, file);
  const ids = new IdRegistry(src.format === 'r-package' ? 'pkgdown' : src.format === 'jupyter-book' ? 'sphinx' : 'pandoc');
  let title = typeof yaml.title === 'string' ? yaml.title : '';
  let rest = tokens;
  if (!title) {
    const first = tokens.findIndex((t) => t.kind === 'header');
    const h = tokens[first] as Header | undefined;
    if (h && h.level === 1) {
      title = h.title;
      ids.claim(h.id, h.title);
      rest = [...tokens.slice(0, first), ...tokens.slice(first + 1)];
    }
  }
  title ||= fallbackTitle;
  const headers = rest.filter((t): t is Header => t.kind === 'header');
  const top = headers.length ? Math.min(...headers.map((h) => h.level)) : 2;
  const pageDraft: Draft = { source: src.id, title, level: 1, crumbs, page, file, body: [] };
  const drafts: Draft[] = [pageDraft];
  let current = pageDraft;
  let stack: string[] = [];
  for (const t of rest) {
    if (t.kind === 'header') {
      const anchor = ids.claim(t.id, t.title);
      if (t.level <= top + 1) {
        const level = t.level - top + 2;
        stack = stack.slice(0, level - 2);
        current = { source: src.id, title: t.title, level, crumbs: [...crumbs, title, ...stack.filter(Boolean)], page, anchor, file, body: [] };
        stack[level - 2] = t.title;
        drafts.push(current);
        continue;
      }
    }
    current.body.push(t);
  }
  return drafts;
}

async function quartoDrafts(src: SourceConfig, dir: string): Promise<Draft[]> {
  const config = YAML.parse(await readFile(path.join(dir, '_quarto.yml'), 'utf8'));
  const drafts: Draft[] = [];
  for (const rel of quartoChapterFiles(config)) {
    if ((src.exclude ?? []).includes(rel)) continue;
    const full = path.join(dir, rel);
    if (!/\.(qmd|md|Rmd)$/i.test(rel)) {
      warn(`${src.id}: skipped non-markdown chapter ${rel}`);
      continue;
    }
    if (!existsSync(full)) {
      warn(`${src.id}: chapter listed in _quarto.yml not found: ${rel}`);
      continue;
    }
    const page = rel.replace(/\\/g, '/').replace(/\.(qmd|md|Rmd)$/i, '');
    drafts.push(...pageDrafts(src, rel, page, await readFile(full, 'utf8'), [], path.basename(page)));
  }
  return drafts;
}

// --- Jupyter Book: _toc.yml pages, MyST markdown and notebooks --------------

/** Page files in _toc.yml order (root first); entries may omit the extension. */
function jupyterBookFiles(toc: any): string[] {
  const out: string[] = [];
  const walk = (items: unknown[]) => {
    for (const item of items ?? []) {
      const o = item as { file?: string; chapters?: unknown[]; sections?: unknown[]; parts?: unknown[] };
      if (o?.file) out.push(o.file);
      if (o?.chapters) walk(o.chapters);
      if (o?.sections) walk(o.sections);
      if (o?.parts) walk(o.parts);
    }
  };
  if (toc?.root) out.push(toc.root);
  walk(toc?.parts ?? []);
  walk(toc?.chapters ?? []);
  return out;
}

/** A notebook as markdown: markdown cells as written, code cells as fenced code. */
function notebookToMarkdown(nb: any): string {
  const lang = String(nb?.metadata?.kernelspec?.language ?? nb?.metadata?.language_info?.name ?? 'python').toLowerCase();
  const text = (src: unknown) => (Array.isArray(src) ? src.join('') : String(src ?? ''));
  return (nb?.cells ?? [])
    .map((c: any) => (c.cell_type === 'markdown' ? text(c.source) : c.cell_type === 'code' && text(c.source).trim() ? '```' + lang + '\n' + text(c.source).replace(/\n+$/, '') + '\n```' : ''))
    .filter(Boolean)
    .join('\n\n');
}

/** MyST code cells (```{code-cell} python) as ordinary fenced code. */
const mystToMarkdown = (md: string) => md.replace(/^```\{code-cell\}\s*(\w+)?.*$/gm, (_m, lang) => '```' + (lang ?? 'python'));

async function jupyterBookDrafts(src: SourceConfig, dir: string): Promise<Draft[]> {
  const toc = YAML.parse(await readFile(path.join(dir, '_toc.yml'), 'utf8'));
  const drafts: Draft[] = [];
  for (const entry of jupyterBookFiles(toc)) {
    const rel = [entry, `${entry}.md`, `${entry}.ipynb`].find((f) => /\.(md|ipynb)$/i.test(f) && existsSync(path.join(dir, f)));
    if (!rel) {
      warn(`${src.id}: page listed in _toc.yml not found: ${entry}`);
      continue;
    }
    if ((src.exclude ?? []).includes(rel)) continue;
    const raw = await readFile(path.join(dir, rel), 'utf8');
    const text = rel.endsWith('.ipynb') ? notebookToMarkdown(JSON.parse(raw)) : mystToMarkdown(raw);
    const page = rel.replace(/\\/g, '/').replace(/\.(md|ipynb)$/i, '');
    drafts.push(...pageDrafts(src, rel, page, text, [], path.basename(page)));
  }
  return drafts;
}

// --- R packages: pkgdown articles, README, and the Rd function reference ---

function rdBlock(text: string, macro: string, from = 0): { body: string; end: number } | null {
  const start = text.indexOf(`\\${macro}{`, from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + macro.length + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { body: text.slice(start + macro.length + 2, i), end: i + 1 };
  }
  return null;
}

function rdToMarkdown(s: string, code = false): string {
  let out = s;
  for (const m of ['dontrun', 'donttest', 'dontshow']) {
    let b;
    while ((b = rdBlock(out, m))) {
      const start = out.indexOf(`\\${m}{`);
      out = out.slice(0, start) + b.body + out.slice(b.end);
    }
  }
  if (code) return out.replace(/\\%/g, '%').replace(/\\([{}\\])/g, '$1').trim();
  for (let i = 0; i < 20; i++) {
    const before = out;
    out = out
      .replace(/\\(?:item)\{([^{}]*)\}\{([^{}]*)\}/g, '\n- `$1`: $2')
      .replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '[$2]($1)')
      .replace(/\\(?:code|verb|samp|pkg|var|env|option|command|file)\{([^{}]*)\}/g, '`$1`')
      .replace(/\\(?:emph|dfn|sQuote|dQuote|cite)\{([^{}]*)\}/g, '*$1*')
      .replace(/\\(?:strong|bold)\{([^{}]*)\}/g, '**$1**')
      .replace(/\\(?:link|linkS4class|url|acronym|abbr|preformatted|enc)(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
      .replace(/\\eqn\{([^{}]*)\}(?:\{[^{}]*\})?/g, '$$$1$$')
      .replace(/\\deqn\{([^{}]*)\}(?:\{[^{}]*\})?/g, '\n$$$$$1$$$$\n')
      .replace(/\\(?:itemize|enumerate|describe|value|tabular)\{([^{}]*)\}/g, '$1')
      .replace(/\\item\s+/g, '\n- ');
    if (out === before) break;
  }
  return out
    .replace(/\\%/g, '%')
    .replace(/\\([{}\\])/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rdDraft(src: SourceConfig, file: string, text: string): Draft | null {
  const rd = text.replace(/\r\n?/g, '\n').replace(/^%.*$/gm, '');
  if (/\\keyword\{internal\}/.test(rd)) return null;
  const name = rdBlock(rd, 'name')?.body.trim();
  if (!name) return null;
  const title = rdToMarkdown(rdBlock(rd, 'title')?.body ?? name).replace(/\s+/g, ' ');
  const parts: string[] = [];
  const add = (heading: string, macro: string, code = false) => {
    const b = rdBlock(rd, macro);
    if (!b) return;
    const body = rdToMarkdown(b.body, code);
    if (body) parts.push(code ? `#### ${heading}\n\n\`\`\`r\n${body}\n\`\`\`` : `#### ${heading}\n\n${body}`);
  };
  const desc = rdBlock(rd, 'description');
  if (desc) parts.push(rdToMarkdown(desc.body));
  add('Usage', 'usage', true);
  add('Arguments', 'arguments');
  add('Value', 'value');
  add('Details', 'details');
  add('Examples', 'examples', true);
  const md = parts.join('\n\n');
  return {
    source: src.id,
    title: `${name}(): ${title}`,
    level: 1,
    crumbs: ['Function reference'],
    page: `reference/${path.basename(file, '.Rd')}`,
    file: `man/${file}`,
    body: tokenize(md, `man/${file}`).tokens,
  };
}

async function rPackageDrafts(src: SourceConfig, dir: string): Promise<Draft[]> {
  const drafts: Draft[] = [];
  const readme = path.join(dir, 'README.md');
  if (existsSync(readme)) {
    drafts.push(...pageDrafts(src, 'README.md', 'index', await readFile(readme, 'utf8'), [], `${src.title}: overview`));
  }
  const vdir = path.join(dir, 'vignettes');
  for (const f of (await readdir(vdir)).filter((f) => /\.Rmd$/i.test(f)).sort()) {
    const name = path.basename(f, path.extname(f));
    drafts.push(...pageDrafts(src, `vignettes/${f}`, `articles/${name}`, await readFile(path.join(vdir, f), 'utf8'), ['Articles'], name));
  }
  const mdir = path.join(dir, 'man');
  for (const f of (await readdir(mdir)).filter((f) => f.endsWith('.Rd')).sort()) {
    const d = rdDraft(src, f, await readFile(path.join(mdir, f), 'utf8'));
    if (d) drafts.push(d);
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Assembly

function resolveCrossRefs(md: string, byAnchor: Map<string, { title: string; url: string }>, site: string): string {
  const link = (id: string, fallback: string) => {
    const hit = byAnchor.get(id);
    return hit ? `[${hit.title}](${hit.url})` : fallback;
  };
  return md
    .replace(/\\@ref\(([^)]+)\)/g, (_, id: string) =>
      id.startsWith('fig:') ? 'the figure' : id.startsWith('tab:') ? 'the table' : id.startsWith('eq:') ? 'the equation' : link(id, id))
    .replace(/(^|[^\w@\\])@((sec|fig|tbl|eq|lst|thm|lem|def|exm|exr|cor|prp|cnj|rem|alg)-[\w-]*\w)/g, (_, pre: string, id: string, kind: string) =>
      pre + (kind === 'sec' ? link(id, id) : kind === 'fig' ? 'the figure' : kind === 'tbl' ? 'the table' : kind === 'eq' ? 'the equation' : `the ${kind}`))
    .replace(/\]\(#([^)\s]+)\)/g, (m, id: string) => {
      const hit = byAnchor.get(id);
      return hit ? `](${hit.url})` : m;
    })
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+?)\.(?:qmd|Rmd|md)(#[^)\s]*)?\)/g, (_, p: string, h = '') => `](${site}${p}.html${h})`);
}

/** Titles without citation keys, inline HTML, or emphasis markers. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*\[@[^\]]*\]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetches each page once: its element ids, `null` if it 404s, `undefined` if unreachable. */
/** Same page, ignoring a trailing slash and a default index.html. */
const samePage = (a: string, b: string) => {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/index\.html$/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
};

/** Pages that redirected while building: the site has moved and `site` in sources.yml must change. */
const redirected: string[] = [];

async function livePages(urls: string[]): Promise<Map<string, Set<string> | null | undefined>> {
  const out = new Map<string, Set<string> | null | undefined>();
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      let result: Set<string> | null | undefined;
      for (let attempt = 0; attempt < 2 && result === undefined; attempt++) {
        try {
          const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'research-methods-mcp index builder' } });
          if (res.redirected && !samePage(res.url, url)) redirected.push(`${url} -> ${res.url}`);
          if (res.status === 404 || res.status === 410) result = null;
          else if (res.ok) result = new Set([...(await res.text()).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
        } catch {
          // retried once below; an unreachable page keeps its unverified link
        }
      }
      if (result === undefined) warn(`could not reach ${url}; its links are unverified`);
      out.set(url, result);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

async function buildSource(src: SourceConfig, verify: boolean): Promise<{ meta: SourceMeta; works: Work[]; records: SectionRecord[] }> {
  const dir = path.join(sourcesRoot, src.repo);
  if (!existsSync(dir)) throw new Error(`${src.id}: source folder not found at ${dir}`);
  const site = src.site.endsWith('/') ? src.site : src.site + '/';
  const drafts =
    src.format === 'bookdown' ? await bookdownDrafts(src, dir)
    : src.format === 'quarto' ? await quartoDrafts(src, dir)
    : src.format === 'jupyter-book' ? await jupyterBookDrafts(src, dir)
    : await rPackageDrafts(src, dir);

  const works: Work[] = [src.citation as Work];
  const volumeOf = new Map<string, string>();
  const chapterOf = new Map<string, string>();
  for (const v of src.volume_citations ?? []) {
    works.push(v.citation);
    for (const f of v.files) {
      if (!existsSync(path.join(dir, f))) warn(`${src.id}: volume file not found: ${f}`);
      volumeOf.set(f, v.citation.key);
    }
    for (const [file, doi] of Object.entries(v.chapters ?? {})) {
      const chapter = chapterByDoi.get(doi.toLowerCase());
      if (!chapter) throw new Error(`${src.id}: chapter DOI ${doi} for ${file} is not in data/publications.json; run npm run build:publications`);
      if (!v.files.includes(file)) throw new Error(`${src.id}: chapter file ${file} is not listed in its volume's files`);
      if (!works.some((w) => w.key === chapter.key)) works.push(chapter);
      chapterOf.set(file, chapter.key);
    }
  }

  // Links must work: a section whose anchor is not on the live page links to
  // the page instead, and a page that is not published yet is left out.
  const pageUrl = (d: Draft) => `${site}${d.page}.html`;
  const finalUrl = new Map<Draft, string | null>();
  const live = verify ? await livePages([...new Set(drafts.map(pageUrl))]) : null;
  const unpublished = new Set<string>();
  let fallbacks = 0;
  for (const d of drafts) {
    const page = pageUrl(d);
    const ids = live?.get(page);
    if (ids === null) {
      unpublished.add(page);
      finalUrl.set(d, null);
    } else if (d.anchor && ids && !ids.has(d.anchor)) {
      fallbacks++;
      finalUrl.set(d, page);
    } else {
      finalUrl.set(d, d.anchor ? `${page}#${d.anchor}` : page);
    }
  }
  if (live) {
    console.log(`${src.id.padEnd(20)} live check: ${live.size - unpublished.size}/${live.size} pages published, ${fallbacks} anchors fall back to their page`);
    for (const p of unpublished) warn(`${src.id}: not on the live site yet, left out: ${p}`);
  }

  const urlOf = (d: Draft) => finalUrl.get(d)!;
  const idOf = (d: Draft) => `${src.id}:${d.page}${d.anchor ? '#' + d.anchor : ''}`;
  const byAnchor = new Map<string, { title: string; url: string }>();
  for (const d of drafts) if (d.anchor && urlOf(d)) byAnchor.set(d.anchor, { title: d.title, url: urlOf(d) });
  for (const d of drafts) if (d.level === 1 && !d.anchor && urlOf(d)) byAnchor.set(d.page, { title: d.title, url: urlOf(d) });

  const records: SectionRecord[] = [];
  const seen = new Set<string>();
  let codeBlocks = 0;
  const langs = new Set<string>();
  for (const d of drafts) {
    if (!urlOf(d)) continue;
    const code = codeOf(d.body);
    codeBlocks += code.length;
    let md: string;
    if (src.text_access === 'full') {
      md = resolveCrossRefs(renderBody(d.body), byAnchor, site);
    } else {
      const intro = teaser(d.body, TEASER_WORDS);
      const blocks = code.map((c) => '```' + c.lang + '\n' + c.src + '\n```');
      md = [intro, blocks.length ? `Code from this section (${src.license.code === 'MIT' ? 'MIT licensed' : 'see the book for terms'}):` : '', ...blocks]
        .filter(Boolean)
        .join('\n\n');
    }
    md = unmove(md);
    const id = idOf(d);
    if (seen.has(id)) {
      warn(`${src.id}: duplicate id ${id}`);
      continue;
    }
    seen.add(id);
    const recLangs = [...new Set(code.map((c) => c.lang))];
    recLangs.forEach((l) => langs.add(l));
    const volume = volumeOf.get(path.basename(d.file));
    const chapter = chapterOf.get(path.basename(d.file));
    const fnPkgs = src.format === 'r-package' && d.page.startsWith('reference/')
      ? [src.id, `${src.id}::${d.title.split('(')[0]}`.toLowerCase()]
      : [];
    records.push({
      id,
      source: src.id,
      title: cleanTitle(d.title),
      crumbs: d.crumbs.map(cleanTitle),
      level: d.level,
      url: urlOf(d),
      file: d.file,
      cite: [chapter, volume, src.citation.key].filter((k): k is string => Boolean(k)),
      md,
      pkgs: [...new Set([...fnPkgs, ...packagesOf(code)])],
      langs: recLangs,
    });
  }

  // Give each chapter page a table of contents so `fetch` can navigate from it.
  const byPage = new Map<string, SectionRecord[]>();
  for (const r of records) {
    const page = r.id.split('#')[0];
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(r);
  }
  for (const [page, rs] of byPage) {
    const head = rs.find((r) => r.id === page);
    const children = rs.filter((r) => r.id !== page);
    if (head && children.length) {
      const toc = children.map((c) => `${'  '.repeat(Math.max(0, c.level - 2))}- ${c.title} (id: \`${c.id}\`)`).join('\n');
      head.md = `${head.md}\n\n#### Sections in this chapter\n\n${toc}`.trim();
    }
  }

  const kept = records.filter((r) => r.md.trim() || r.level === 1);
  const meta: SourceMeta = {
    id: src.id,
    title: src.title,
    summary: src.summary.replace(/\s+/g, ' ').trim(),
    format: src.format,
    site,
    github: src.github,
    text_access: src.text_access,
    license: src.license,
    citation: src.citation.key,
    languages: [...langs].sort(),
    sections: kept.length,
    code_blocks: codeBlocks,
  };
  return { meta, works, records: kept };
}

async function main() {
  const cfg = YAML.parse(await readFile(path.join(repoRoot, 'sources.yml'), 'utf8')) as { sources: SourceConfig[]; moved?: { from: string; to: string }[] };
  movedSites = cfg.moved ?? [];
  const args = process.argv.slice(2);
  const verify = !args.includes("--no-verify");
  const only = args.filter((a) => !a.startsWith("--"));
  const sources: SourceMeta[] = [];
  const works: Work[] = [];
  const records: SectionRecord[] = [];

  // The author's publications (scripts/build-publications.ts): chapter works for
  // chapter-level citations, and searchable records for articles, books, and data.
  const pubFile = path.join(repoRoot, 'data', 'publications.json');
  const publications = existsSync(pubFile)
    ? (JSON.parse(await readFile(pubFile, 'utf8')) as { orcid: string; works: Work[]; items: { key: string; title: string; abstract?: string; doi: string; url: string; container?: string; year: number }[] })
    : null;
  for (const w of publications?.works ?? []) if (w.type === 'chapter' && w.doi) chapterByDoi.set(w.doi.toLowerCase(), w);

  for (const src of cfg.sources) {
    if (only.length && !only.includes(src.id)) continue;
    const t0 = Date.now();
    const built = await buildSource(src, verify);
    sources.push(built.meta);
    works.push(...built.works);
    records.push(...built.records);
    const chars = built.records.reduce((n, r) => n + r.md.length, 0);
    console.log(
      `${src.id.padEnd(20)} ${String(built.records.length).padStart(5)} sections  ` +
      `${String(built.meta.code_blocks).padStart(5)} code blocks  [${built.meta.languages.join(', ')}]  ` +
      `${(chars / 1e6).toFixed(1)} MB text  ${Date.now() - t0} ms`,
    );
  }

  if (verify && redirected.length) {
    throw new Error(
      `these pages redirect, so the site has moved; update \`site\` (and citation URLs) in sources.yml to the final host:\n  ${redirected.slice(0, 20).join('\n  ')}`,
    );
  }

  if (publications && !only.length) {
    // A publication already cited by a book source (e.g. a Springer volume) keeps that
    // source's key, so each work appears once.
    const keyByDoi = new Map(works.filter((w) => w.doi).map((w) => [w.doi!.toLowerCase(), w.key]));
    for (const w of publications.works) {
      if (!w.doi || keyByDoi.has(w.doi.toLowerCase())) continue;
      works.push(w);
      keyByDoi.set(w.doi.toLowerCase(), w.key);
    }
    const byKey = new Map(works.map((w) => [w.key, w]));
    const pubRecords: SectionRecord[] = publications.items.map((item) => {
      const key = keyByDoi.get(item.doi.toLowerCase())!;
      const w = byKey.get(key)!;
      const authors = w.authors.map((a) => `${a.given} ${a.family}`).join(', ');
      const venue = [w.container, w.volume ? `Vol. ${w.volume}` : '', w.publisher].filter(Boolean).join(', ');
      return {
        id: `publications:${item.doi.toLowerCase()}`,
        source: 'publications',
        title: w.title,
        crumbs: ['Publications'],
        level: 1,
        url: `https://doi.org/${item.doi}`,
        file: '',
        cite: [key],
        md: [`**${w.title}** (${w.year})`, `${authors}. ${venue}.`, item.abstract ?? '', `DOI: [${item.doi}](https://doi.org/${item.doi})`].filter(Boolean).join('\n\n'),
        pkgs: [],
        langs: [],
      };
    });
    records.push(...pubRecords);
    const newest = [...pubRecords].sort((a, b) => (byKey.get(b.cite[0])!.year - byKey.get(a.cite[0])!.year))[0];
    sources.push({
      id: 'publications',
      title: 'Research Articles and Publications',
      summary:
        'Peer-reviewed articles, Springer books, replication packages, and presentations by the author, from the ORCID record, with abstracts and DOIs.',
      format: 'publications',
      site: `https://orcid.org/${publications.orcid}`,
      github: '',
      text_access: 'full',
      license: { text: 'Abstracts as published; full texts at the DOI links', code: 'See each replication package' },
      citation: newest?.cite[0] ?? '',
      languages: [],
      sections: pubRecords.length,
      code_blocks: 0,
    });
    console.log(`publications         ${String(pubRecords.length).padStart(5)} records from ORCID ${publications.orcid}`);
  }

  // Links in the text that point at one of the indexed sites must lead to a page that
  // exists. A link to a missing page is redirected to the page or section with that
  // name (books rename pages, e.g. "linear-mixed-models" became "sec-linear-mixed-models"),
  // and a link with no match is removed, keeping its text. Each repair is reported so the
  // book itself can be fixed.
  {
    const sites = sources.filter((s) => s.format !== 'publications').map((s) => (s.site.endsWith('/') ? s.site : s.site + '/'));
    const pageUrls = new Set(records.map((r) => r.url.split('#')[0]));
    const recordUrls = new Set(records.map((r) => r.url));
    const byName = new Map<string, string>(); // page or anchor name -> URL, per site
    for (const r of records) {
      const site = sites.find((s) => r.url.startsWith(s));
      if (!site) continue;
      const [page, anchor] = r.url.slice(site.length).split('#');
      const pageName = page.replace(/\.html$/, '').split('/').pop()!;
      for (const name of [pageName, pageName.replace(/^sec-/, ''), anchor, anchor?.replace(/^sec-/, '')]) {
        if (name && !byName.has(`${site}|${name}`)) byName.set(`${site}|${name}`, r.url);
      }
    }
    const repairs = new Map<string, string>();
    const pageOf = (url: string) => url.split('#')[0].split('?')[0];
    const indexed = (page: string) => pageUrls.has(page) || pageUrls.has(page.replace(/\/$/, '/index.html'));
    // Pages on an indexed site that are not sections themselves (e.g. a pkgdown
    // article index) are kept when they answer live at their own URL.
    const candidates = new Set<string>();
    for (const r of records) {
      for (const m of r.md.matchAll(/https?:\/\/[^\s)>\]"'`]+/g)) {
        const page = pageOf(m[0].replace(/[.,;:]+$/, ''));
        if (sites.some((s) => page.startsWith(s) && page !== s) && !indexed(page)) candidates.add(page);
      }
    }
    const liveOk = new Set<string>();
    if (verify) {
      await Promise.all([...candidates].map(async (page) => {
        try {
          const res = await fetch(page, { redirect: 'follow', headers: { 'user-agent': 'research-methods-mcp index builder' } });
          if (res.ok && !(res.redirected && !samePage(res.url, page))) liveOk.add(page);
        } catch {
          // unreachable: treated as missing
        }
      }));
    }
    const resolve = (url: string): string | null => {
      const page = pageOf(url);
      if (indexed(page) || liveOk.has(page)) return url;
      const site = sites.find((s) => page.startsWith(s));
      if (!site || page === site) return url;
      const name = page.slice(site.length).replace(/\.html$/, '').split('/').pop()!;
      const target = byName.get(`${site}|${name}`) ?? byName.get(`${site}|${name.replace(/^sec-/, '')}`) ?? null;
      // Keep the original section anchor when the moved page has it.
      const anchor = url.split('#')[1];
      const withAnchor = target && anchor ? `${pageOf(target)}#${anchor}` : null;
      return withAnchor && recordUrls.has(withAnchor) ? withAnchor : target;
    };
    for (const r of records) {
      r.md = r.md
        .replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (all, label: string, url: string) => {
          const fixed = resolve(url);
          if (fixed === url) return all;
          repairs.set(url, fixed ?? '(link removed: page not published)');
          return fixed ? `[${label}](${fixed})` : label;
        })
        .replace(/(^|[\s(<])(https?:\/\/[^\s)>\]"'`]+)/g, (all, pre: string, url: string) => {
          const clean = url.replace(/[.,;:]+$/, '');
          const fixed = resolve(clean);
          if (fixed === clean || !fixed) return all;
          repairs.set(clean, fixed);
          return pre + url.replace(clean, fixed);
        });
    }
    for (const [from, to] of repairs) warn(`fixed a link in the text: ${from} -> ${to} (fix it in the book too)`);
  }

  let methods: MethodEntry[] = [];
  const methodsFile = path.join(repoRoot, 'methods.yml');
  if (existsSync(methodsFile)) {
    methods = (YAML.parse(await readFile(methodsFile, 'utf8')) as { methods: MethodEntry[] }).methods;
    const ids = new Set(records.map((r) => r.id));
    for (const m of methods) {
      const missing = m.sections.filter((s) => !ids.has(s));
      if (missing.length && !only.length) throw new Error(`methods.yml: ${m.id} points at unknown sections: ${missing.join(', ')}`);
    }
  }

  const index: LibraryIndex = { schema: 1, built: new Date().toISOString(), sources, works, records, methods };
  const json = JSON.stringify(index);
  await mkdir(path.join(repoRoot, 'data'), { recursive: true });
  const gz = gzipSync(json, { level: 9 });
  await writeFile(path.join(repoRoot, 'data', 'index.json.gz'), gz);
  if (process.env.WRITE_JSON) await writeFile(path.join(repoRoot, 'data', 'index.json'), json);

  const sizes = records.map((r) => r.md.length).sort((a, b) => b - a);
  console.log(
    `\n${records.length} sections, ${methods.length} methods, ${(json.length / 1e6).toFixed(1)} MB JSON, ` +
    `${(gz.length / 1e6).toFixed(1)} MB gzipped. Largest sections (chars): ${sizes.slice(0, 5).join(', ')}`,
  );
  if (warnings.length) console.log(`\n${warnings.length} warnings:\n  ${warnings.slice(0, 40).join('\n  ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
