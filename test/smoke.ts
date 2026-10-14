// End-to-end test through real MCP clients:
//   - the v2 client (2026-07-28 protocol) over Streamable HTTP
//   - the v1 SDK client (2025 protocol, what most hosts still speak) over HTTP
//   - the bundled stdio binary, if dist/stdio.js exists
// Run: npm test            (SAMPLES=1 also prints sample answers)

import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as V1HttpTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../src/http.ts';
import { loadLibrary } from '../src/load.ts';

const failures: string[] = [];
let passed = 0;
function check(cond: unknown, msg: string) {
  if (cond) passed++;
  else failures.push(msg);
}

type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: any; isError?: boolean };
type Caller = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

const t0 = Date.now();
const lib = await loadLibrary();
const loadMs = Date.now() - t0;
const http = createHttpServer(toNodeHandler({ fetch: createApp(lib) }));
await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

// --- v2 client, full surface ---------------------------------------------------
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
const call: Caller = (name, args) => client.callTool({ name, arguments: args }) as Promise<ToolResult>;

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
check(JSON.stringify(names) === JSON.stringify(['choose_method', 'cite', 'fetch', 'get_code', 'list_sources', 'search']), `tool names: ${names}`);
for (const t of tools) {
  check(t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false && t.annotations?.openWorldHint === false, `${t.name}: annotations`);
  check(t.title && t.description && t.description.length > 60, `${t.name}: title and description`);
}

// search: OpenAI shape, JSON text mirrors structuredContent
const s = await call('search', { query: 'staggered difference-in-differences' });
const hits = s.structuredContent?.results ?? [];
check(hits.length >= 5, 'search returns results');
check(JSON.stringify(JSON.parse(s.content[0].text!)) === JSON.stringify(s.structuredContent), 'search text is JSON of structuredContent');
check(hits.every((h: any) => h.id && h.title && /^https:\/\//.test(h.url) && h.cite_as), 'search hits have id, title, https url, citation');
check(hits.slice(0, 3).some((h: any) => /stagger/i.test(h.title + h.path)), `search top hits on topic: ${hits.slice(0, 3).map((h: any) => h.title)}`);

const py = await call('search', { query: 'regression discontinuity', language: 'python' });
check((py.structuredContent?.results ?? []).length > 0, 'search with language filter');

// fetch: OpenAI shape, citation footer, long sections split
const f = await call('fetch', { id: hits[0].id });
const doc = f.structuredContent;
check(doc?.id === hits[0].id && doc.text.includes('Source:') && doc.url === hits[0].url && doc.metadata?.cite_as, 'fetch returns text, url, citation');
const longest = lib.index.records.reduce((a, b) => (b.md.length > a.md.length ? b : a));
const p1 = (await call('fetch', { id: longest.id })).structuredContent;
const p2 = (await call('fetch', { id: `${longest.id}@2` })).structuredContent;
check(p1?.metadata.parts >= 2 && p1.text.includes(`${longest.id}@2`) && p2?.metadata.part === 2, 'long sections are split into parts');
check((await call('fetch', { id: 'nope:missing' })).isError === true, 'unknown id is an error');
const teaserRec = lib.index.records.find((r) => r.source === 'marketing_research' && r.langs.length)!;
const teaser = (await call('fetch', { id: teaserRec.id })).structuredContent;
check(teaser?.metadata.text_access === 'teaser' && teaser.text.includes('full text of this section'), 'teaser sources point to the website');

// choose_method: realistic questions map to the right design
const expect: [string, string][] = [
  ['States raised the minimum wage in different years; effect on teen employment', 'did_staggered'],
  ['A test score cutoff decides who gets a scholarship; effect on college enrollment', 'rd'],
  ['Defendants are randomly assigned to judges who differ in harshness', 'examiner_iv'],
  ['Which customers should get a discount to maximize incremental purchases', 'uplift'],
  ['Probability of default model for loan applicants that regulators can audit', 'credit_scorecard'],
  ['Only California passed the law; I have 30 years of state data', 'synthetic_control'],
  ['Effect of an endogenous price on demand with a cost shifter instrument', 'iv'],
  ['How much of the training effect on wages runs through job search effort', 'mediation'],
  ['Panel of firms over ten years; control for unobserved firm characteristics', 'panel'],
  ['Does the text of online reviews predict sales?', 'text_as_data'],
  ['How long until a customer churns, with some customers still active', 'survival'],
  ['Allocate the advertising budget across TV, search, and social', 'mmm'],
  ['How much do consumers value battery life versus price in a phone?', 'preference'],
  ['Treatment was assigned by a coin flip for each participant', 'rct'],
  ['Treatment was assigned at the school level; how should I compute standard errors?', 'clustered_se'],
  ['Is my observational estimate robust to an unobserved confounder?', 'sensitivity'],
  ['How many participants do I need to detect a 2 percentage point lift?', 'power'],
  ['Wages are only observed for people who work', 'selection'],
  ['Effect of a new store opening on nearby stores sales; the treatment spills over', 'interference'],
];
for (const [q, id] of expect) {
  const r = await call('choose_method', { question: q });
  const ids = (r.structuredContent?.methods ?? []).map((m: any) => m.id);
  check(ids.includes(id), `choose_method "${q}" -> expected ${id}, got ${ids.join(', ')}`);
}

// get_code: language-specific code, with a fallback note when a language is missing
const rCode = await call('get_code', { topic: 'group-time average treatment effects', language: 'r' });
const rBlocks = (rCode.structuredContent?.results ?? []).flatMap((x: any) => x.blocks);
check(rBlocks.length > 0 && rBlocks.every((b: any) => b.language === 'r'), 'get_code returns R code');
const pyCode = await call('get_code', { topic: 'gradient boosting probability of default', language: 'python' });
const pyBlocks = (pyCode.structuredContent?.results ?? []).flatMap((x: any) => x.blocks);
check(pyBlocks.length > 0 && pyBlocks.every((b: any) => b.language === 'python'), 'get_code returns Python code');

// cite
const bib = await call('cite', { ids: [hits[0].id, 'causalverse'], style: 'bibtex' });
check(/@book\{/.test(bib.content[0].text!) && /@manual\{Nguyen2026causalverse/.test(bib.content[0].text!), 'cite bibtex for a section and a source');
const vol = lib.index.records.find((r) => r.cite[0] === 'Nguyen2025Vol1')!;
const apa = await call('cite', { ids: [vol.id] });
check(apa.content[0].text!.includes('Nguyen, M. (2025). *Foundations of data analysis* (Vol. 1). Springer Cham. https://doi.org/10.1007/978-3-032-01858-8'), 'volume chapters cite the Springer volume in APA');
const all = await call('cite', {});
check((all.structuredContent?.references ?? []).length === lib.index.sources.length, 'cite with no ids lists every work');

const ls = await call('list_sources', {});
check((ls.structuredContent?.sources ?? []).length === lib.index.sources.length, 'list_sources');

// prompts and resources
const { prompts } = await client.listPrompts();
check(prompts.length === 3, 'three prompts');
const pr = await client.getPrompt({ name: 'plan_analysis', arguments: { question: 'Does remote work raise productivity?' } });
check(JSON.stringify(pr.messages).includes('choose_method'), 'plan_analysis prompt');
const { resources } = await client.listResources();
check(resources.length === lib.index.sources.length + 1, 'resources');
const toc = await client.readResource({ uri: 'rml://sources/causalverse' });
check(JSON.stringify(toc.contents).includes('causalverse:articles/c_did'), 'table of contents resource');
await client.close();

// --- v1 client (2025 protocol) --------------------------------------------------
const v1 = new V1Client({ name: 'smoke-v1', version: '1.0.0' });
await v1.connect(new V1HttpTransport(new URL(`${base}/mcp`)));
const v1Tools = await v1.listTools();
check(v1Tools.tools.length === 6, '2025-protocol client lists tools');
const v1Res = (await v1.callTool({ name: 'search', arguments: { query: 'weak instruments' } })) as ToolResult;
check((v1Res.structuredContent?.results ?? []).length > 0, '2025-protocol client calls search');
await v1.close();

// --- web pages -------------------------------------------------------------------
for (const p of ['/', '/privacy', '/terms', '/health']) {
  const res = await fetch(base + p);
  check(res.ok, `GET ${p}`);
  if (p === '/') check((await res.text()).includes(`${base}/mcp`), 'landing page shows the endpoint');
}

// --- stdio binary ----------------------------------------------------------------
if (existsSync('dist/stdio.js')) {
  const stdio = new Client({ name: 'smoke-stdio', version: '1.0.0' });
  await stdio.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/stdio.js'] }));
  const r = (await stdio.callTool({ name: 'choose_method', arguments: { question: 'regression discontinuity at an age cutoff' } })) as ToolResult;
  check(r.content[0].text!.includes('Regression discontinuity'), 'stdio binary answers');
  await stdio.close();
} else {
  console.log('(dist/stdio.js not built; skipped the stdio check)');
}

// --- samples -----------------------------------------------------------------------
if (process.env.SAMPLES) {
  const c2 = new Client({ name: 'samples', version: '1.0.0' });
  await c2.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  for (const [name, args] of [
    ['choose_method', { question: 'staggered rollout of a policy across states', limit: 2 }],
    ['get_code', { topic: 'rdrobust bandwidth selection', language: 'r', limit: 1 }],
    ['search', { query: 'weak instruments', limit: 3 }],
  ] as const) {
    const r = (await c2.callTool({ name, arguments: args })) as ToolResult;
    console.log(`\n==================== ${name} ${JSON.stringify(args)}\n${r.content[0].text!.slice(0, 2500)}`);
  }
  await c2.close();
}

http.close();
console.log(`\nindex load ${loadMs} ms · ${passed} checks passed · ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
