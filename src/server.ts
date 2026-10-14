// MCP surface: tools, prompts, and resources over the Library.

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { formatWork, STYLES } from './cite.ts';
import { LANGUAGES, type Library } from './library.ts';
import type { Work } from './types.ts';

export const SERVER_NAME = 'research-methods-mcp';
export const SERVER_TITLE = 'Research Methods Library';
export const VERSION: string = pkg.version;
export const HOMEPAGE = 'https://github.com/mikenguyen13/research-methods-mcp';

const INSTRUCTIONS = `Research Methods Library: searchable sections, runnable R and Python code, and ready-made citations from Mike Nguyen's open books and R package on data analysis, causal inference, econometrics, experiments, marketing research, credit scoring, machine learning, and AI.

For a study-design question, start with choose_method. To read the material, use search and then fetch. For runnable code, use get_code. For a reference list, use cite with the ids of the sections you used. Every result includes the section URL and the citation of the work it comes from.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  structuredContent: value as Record<string, unknown>,
});

const markdown = (text: string, value: unknown) => ({
  content: [{ type: 'text' as const, text }],
  structuredContent: value as Record<string, unknown>,
});

const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

export function createServer(lib: Library): McpServer {
  const sourceIds = [...lib.sources.keys()] as [string, ...string[]];
  const sourceList = lib.index.sources.map((s) => `${s.id} (${s.title})`).join('; ');

  const server = new McpServer(
    { name: SERVER_NAME, title: SERVER_TITLE, version: VERSION, websiteUrl: HOMEPAGE },
    { instructions: INSTRUCTIONS },
  );

  const Language = z.enum(LANGUAGES).describe('Programming language of the code: r, python, or julia.');
  const Source = z.enum(sourceIds).describe(`Limit to one work: ${sourceList}.`);

  // --- search (OpenAI deep-research compatible) ------------------------------
  server.registerTool(
    'search',
    {
      title: 'Search the research methods library',
      description:
        'Search sections of open books and an R package on research methods: causal inference (difference-in-differences, synthetic control, regression discontinuity, instrumental variables, matching, double machine learning), econometrics, experiments, regression, marketing research, credit scoring, machine learning, and AI. Returns matching sections with a link, a snippet, the code languages they contain, and a citation. Read a result in full with fetch.',
      inputSchema: z.object({
        query: z.string().min(1).describe('What to look for, in plain words, e.g. "staggered difference-in-differences with never-treated controls".'),
        source: Source.optional(),
        language: Language.optional().describe('Prefer sections with code in this language.'),
        limit: z.number().int().min(1).max(25).optional().describe('Number of results (default 8).'),
      }),
      annotations: { title: 'Search the research methods library', ...READ_ONLY },
    },
    async ({ query, source, language, limit }) => json({ results: lib.search(query, { source, language, limit }) }),
  );

  // --- fetch (OpenAI deep-research compatible) -------------------------------
  server.registerTool(
    'fetch',
    {
      title: 'Read a library section',
      description:
        'Read one section of the library by its id (from search, get_code, or choose_method). Returns the section in Markdown with its code, the section URL, and the citation of the work it comes from. Long sections come in parts; the text names the id of the next part.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Section id, e.g. "data_analysis:sec-regression-discontinuity".'),
      }),
      annotations: { title: 'Read a library section', ...READ_ONLY },
    },
    async ({ id }) => {
      const doc = lib.fetch(id);
      return doc ? json(doc) : fail(`No section with id "${id}". Use search to find section ids.`);
    },
  );

  // --- choose_method --------------------------------------------------------
  server.registerTool(
    'choose_method',
    {
      title: 'Recommend analysis methods',
      description:
        'Recommend statistical, econometric, causal inference, or machine learning methods for a research question. Describe the question, the data (cross-section, panel, time series, experiment), how the treatment or exposure was assigned, and the outcome. Returns candidate methods with when to use each, key assumptions, R and Python packages, and the library sections that teach them.',
      inputSchema: z.object({
        question: z.string().min(3).describe('The research question and setting, e.g. "effect of a minimum wage increase that some states adopted in different years on teen employment".'),
        language: Language.optional().describe('Only list packages for this language.'),
        limit: z.number().int().min(1).max(6).optional().describe('Number of methods (default 3).'),
      }),
      annotations: { title: 'Recommend analysis methods', ...READ_ONLY },
    },
    async ({ question, language, limit }) => {
      const methods = lib.methods(question, limit ?? 3).map((m) => lib.describeMethod(m, language));
      const related = lib.search(question, { limit: 5, language });
      if (!methods.length && !related.length) return fail('No matching methods. Try describing the data and how treatment was assigned.');
      const lines: string[] = [];
      for (const [i, m] of methods.entries()) {
        lines.push(`## ${i + 1}. ${m.name}`, `**Use when:** ${m.use_when}`, `**Key assumptions:** ${m.assumptions.join('; ')}.`);
        if (m.avoid_when) lines.push(`**Watch out:** ${m.avoid_when}`);
        const pk = Object.entries(m.packages).filter(([, v]) => v?.length).map(([k, v]) => `${k === 'r' ? 'R' : k[0].toUpperCase() + k.slice(1)}: ${v!.join(', ')}`);
        if (pk.length) lines.push(`**Packages:** ${pk.join(' | ')}`);
        lines.push('**Read:**', ...m.sections.map((s) => `- [${s.title}](${s.url}) (id: \`${s.id}\`)`), '');
      }
      if (related.length) {
        lines.push('## Other relevant sections', ...related.map((h) => `- [${h.title}](${h.url}) (id: \`${h.id}\`)`), '');
      }
      const works = uniqueWorks(lib, [...methods.flatMap((m) => m.sections.map((s) => s.id)), ...related.map((h) => h.id)]);
      lines.push('## Sources', ...works.map((w) => `- ${formatWork(w, 'apa')}`));
      return markdown(lines.join('\n'), { methods, related, sources: works.map((w) => formatWork(w, 'apa')) });
    },
  );

  // --- get_code -------------------------------------------------------------
  server.registerTool(
    'get_code',
    {
      title: 'Get runnable R or Python code',
      description:
        'Get runnable code from the library for a statistical, econometric, causal inference, or machine learning task, in R, Python, or Julia. Returns code blocks with the section they come from, the packages they use, a link, and a citation.',
      inputSchema: z.object({
        topic: z.string().min(2).describe('The task, e.g. "Callaway and Sant\'Anna group-time ATT", "rdrobust bandwidth", "WoE binning scorecard".'),
        language: Language.optional(),
        source: Source.optional(),
        limit: z.number().int().min(1).max(10).optional().describe('Number of sections to return code from (default 4).'),
      }),
      annotations: { title: 'Get runnable R or Python code', ...READ_ONLY },
    },
    async ({ topic, language, source, limit }) => {
      const { note, results } = lib.code(topic, { language, source, limit });
      if (!results.length) return fail(`No code found for "${topic}". Try a broader topic or another language.`);
      const lines: string[] = note ? [`> ${note}`, ''] : [];
      for (const r of results) {
        lines.push(`## ${r.title}`, `_${r.path}_ · [open section](${r.url}) · id: \`${r.id}\``);
        if (r.packages.length) lines.push(`Packages: ${r.packages.join(', ')}`);
        for (const b of r.blocks) lines.push('```' + b.language, b.code, '```');
        lines.push(`Source: ${r.cite_as}`, '');
      }
      return markdown(lines.join('\n'), { note, results });
    },
  );

  // --- cite -----------------------------------------------------------------
  server.registerTool(
    'cite',
    {
      title: 'Format references',
      description:
        'Format references for works in the library in APA, Chicago, MLA, Harvard, BibTeX, or RIS. Pass the ids of the sections you used to get a deduplicated reference list plus the section links, or pass source ids to cite whole works. With no ids, returns a reference for every work in the library.',
      inputSchema: z.object({
        ids: z.array(z.string()).optional().describe(`Section ids from other tools, or source ids: ${sourceIds.join(', ')}.`),
        style: z.enum(STYLES).optional().describe('Citation style (default apa).'),
      }),
      annotations: { title: 'Format references', ...READ_ONLY },
    },
    async ({ ids, style = 'apa' }) => {
      const wanted = ids?.length ? ids : sourceIds;
      const unknown: string[] = [];
      const sections: { id: string; title: string; url: string; cite_key: string }[] = [];
      const keys: string[] = [];
      for (const raw of wanted) {
        const id = raw.replace(/@\d+$/, '');
        const rec = lib.byId.get(id);
        const src = lib.sources.get(id);
        if (rec) {
          sections.push({ id: rec.id, title: rec.title, url: rec.url, cite_key: rec.cite[0] });
          keys.push(...rec.cite.slice(0, 1));
        } else if (src) {
          keys.push(src.citation);
        } else unknown.push(raw);
      }
      const works = [...new Set(keys)].map((k) => lib.works.get(k)).filter((w): w is Work => Boolean(w));
      if (!works.length) return fail(`No library section or source matches: ${unknown.join(', ')}.`);
      const references = works.map((w) => ({ key: w.key, text: formatWork(w, style) }));
      const block = style === 'bibtex' || style === 'ris';
      const lines = [
        block ? '```' + (style === 'bibtex' ? 'bibtex' : '') : '',
        ...references.map((r) => (block ? r.text + '\n' : `- ${r.text}`)),
        block ? '```' : '',
      ].filter((l) => l !== '');
      if (sections.length) lines.push('', 'Sections used:', ...sections.map((s) => `- [${s.title}](${s.url}) [${s.cite_key}]`));
      if (unknown.length) lines.push('', `Not found in the library: ${unknown.join(', ')}`);
      return markdown(lines.join('\n'), { style, references, sections, unknown });
    },
  );

  // --- list_sources ---------------------------------------------------------
  server.registerTool(
    'list_sources',
    {
      title: 'List the books and packages',
      description: 'List the books and packages in the library with their topics, code languages, licenses, links, and how to cite each one.',
      inputSchema: z.object({}),
      annotations: { title: 'List the books and packages', ...READ_ONLY },
    },
    async () => {
      const sources = lib.index.sources.map((s) => ({
        id: s.id,
        title: s.title,
        summary: s.summary,
        url: s.site,
        github: s.github,
        languages: s.languages,
        sections: s.sections,
        code_blocks: s.code_blocks,
        text_access: s.text_access,
        license: s.license,
        cite_as: lib.sourceCitation(s),
      }));
      const lines = sources.map((s) =>
        `## ${s.title}\n${s.summary}\n- Code: ${s.languages.join(', ') || 'none'} · ${s.sections} sections · ${s.code_blocks} code blocks\n- Read: ${s.url}\n- ${s.text_access === 'full' ? 'Full text available through fetch' : 'Excerpts and code through fetch; full text on the website'}\n- Cite: ${s.cite_as}`,
      );
      return markdown(lines.join('\n\n'), { sources });
    },
  );

  // --- prompts --------------------------------------------------------------
  server.registerPrompt(
    'plan_analysis',
    {
      title: 'Plan an analysis',
      description: 'Turn a research question into a design, assumptions to check, runnable code, and a reference list.',
      argsSchema: z.object({
        question: z.string().describe('Your research question.'),
        data: z.string().optional().describe('What data you have: units, time span, how treatment was assigned, outcome.'),
        language: z.string().optional().describe('R or Python.'),
      }),
    },
    ({ question, data, language }) => userPrompt(
      `I need to plan an empirical analysis.\n\nResearch question: ${question}\nData: ${data || 'not described yet'}\nLanguage: ${language || 'R or Python'}\n\n` +
      `Use the research methods library: call choose_method with my question and data, fetch the most relevant sections to check identifying assumptions and diagnostics, and call get_code for ${language || 'R or Python'} code.\n\n` +
      'Then give me: the recommended design and why it fits, the key assumptions and how to test them, step-by-step code, robustness checks, and a reference list from the cite tool for the sections you relied on.',
    ),
  );

  server.registerPrompt(
    'write_methods_section',
    {
      title: 'Draft a methods section',
      description: 'Draft the methods section of a paper, grounded in the library and with references.',
      argsSchema: z.object({
        analysis: z.string().describe('What you did: design, estimator, data, and robustness checks.'),
        style: z.string().optional().describe('Citation style: apa, chicago, mla, harvard, or bibtex.'),
      }),
    },
    ({ analysis, style }) => userPrompt(
      `Draft the methods section of a paper for this analysis:\n\n${analysis}\n\n` +
      `Use the research methods library (search, fetch) to describe each method accurately and state its assumptions. Build the reference list with the cite tool in ${style || 'apa'} style from the sections you used, and flag any claim you could not check against the library.`,
    ),
  );

  server.registerPrompt(
    'explain_method',
    {
      title: 'Explain a method',
      description: 'Explain a method with its assumptions, diagnostics, pitfalls, and a worked example.',
      argsSchema: z.object({
        method: z.string().describe('The method, e.g. "synthetic control" or "double machine learning".'),
        language: z.string().optional().describe('R or Python for the example.'),
      }),
    },
    ({ method, language }) => userPrompt(
      `Explain ${method} for an applied researcher: the estimand, the identifying assumptions, how to diagnose violations, common mistakes, and a minimal worked example in ${language || 'R or Python'}.\n\n` +
      'Ground the explanation in the research methods library (search, fetch, get_code) and end with a reference list from the cite tool.',
    ),
  );

  // --- resources ------------------------------------------------------------
  server.registerResource(
    'sources',
    'rml://sources',
    { title: 'Library catalog', description: 'Every book and package in the library, with links and citations.', mimeType: 'application/json' },
    (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(lib.index.sources.map((s) => ({ ...s, cite_as: lib.sourceCitation(s) })), null, 2),
      }],
    }),
  );
  for (const s of lib.index.sources) {
    server.registerResource(
      `toc-${s.id}`,
      `rml://sources/${s.id}`,
      { title: `${s.title}: contents`, description: `Chapter and section outline of ${s.title}, with section ids.`, mimeType: 'text/markdown' },
      (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: tableOfContents(lib, s.id) }] }),
    );
  }

  return server;
}

function userPrompt(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

function uniqueWorks(lib: Library, ids: string[]): Work[] {
  const keys = new Set<string>();
  for (const id of ids) {
    const rec = lib.byId.get(id);
    if (rec) keys.add(rec.cite[0]);
  }
  return [...keys].map((k) => lib.works.get(k)).filter((w): w is Work => Boolean(w));
}

function tableOfContents(lib: Library, source: string): string {
  const s = lib.sources.get(source)!;
  const lines = [`# ${s.title}`, '', s.summary, '', `Cite as: ${lib.sourceCitation(s)}`, ''];
  for (const r of lib.index.records) {
    if (r.source !== source || r.level > 2) continue;
    lines.push(`${r.level === 1 ? '- ' : '  - '}${r.title} (\`${r.id}\`)`);
  }
  return lines.join('\n');
}
