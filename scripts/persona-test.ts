// End-user scenario test: realistic questions from different kinds of users, asked
// through a real MCP client against a running endpoint. For each scenario it checks
// that the expected tool answers with relevant content, that every link in the
// answer resolves at its own URL (no redirect to another host or path), and that
// citations are well formed.
//
//   npx tsx scripts/persona-test.ts https://research-methods-mcp.vercel.app/mcp
//   npx tsx scripts/persona-test.ts http://127.0.0.1:8787/mcp

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL(process.argv[2] ?? 'https://research-methods-mcp.vercel.app/mcp');

interface Scenario {
  persona: string;
  tool: string;
  args: Record<string, unknown>;
  /** Text the answer must contain (case-insensitive), any of. */
  expect: RegExp;
}

const S: Scenario[] = [
  // Study design
  { persona: 'policy economist', tool: 'choose_method', args: { question: 'States raised the minimum wage in different years. How should I estimate the effect on teen employment?' }, expect: /staggered/i },
  { persona: 'health researcher', tool: 'choose_method', args: { question: 'Only one country introduced a sugar tax; I have 20 years of national obesity data for many countries' }, expect: /synthetic control/i },
  { persona: 'education researcher', tool: 'choose_method', args: { question: 'Students scoring above 70 on an entrance test get a scholarship. What is the effect on graduation?' }, expect: /regression discontinuity/i },
  { persona: 'product analyst', tool: 'choose_method', args: { question: 'How do I analyze an A/B test of a new checkout page on conversion rate?' }, expect: /randomi[sz]ed|experiment|A\/B/i },
  { persona: 'grad student', tool: 'choose_method', args: { question: 'Which statistical test should I use to compare the means of three groups?' }, expect: /ANOVA|analysis of variance/i },
  { persona: 'grad student', tool: 'choose_method', args: { question: 'How many participants do I need to detect a small effect with 80% power?' }, expect: /power|sample size/i },
  { persona: 'labor economist', tool: 'choose_method', args: { question: 'Effect of education on wages when ability is unobserved; I have distance to college as an instrument' }, expect: /instrumental/i },
  { persona: 'marketing analyst', tool: 'choose_method', args: { question: 'How should I split my advertising budget across TV, search, and social media?' }, expect: /marketing mix|media mix/i },
  { persona: 'credit risk modeler', tool: 'choose_method', args: { question: 'Build a probability of default model that regulators can audit' }, expect: /scorecard|credit/i },
  { persona: 'epidemiologist', tool: 'choose_method', args: { question: 'Observational study of a drug; worried about unmeasured confounding. How robust is my estimate?' }, expect: /sensitivity/i },
  { persona: 'data scientist', tool: 'choose_method', args: { question: 'Which customers should receive a discount coupon to maximize incremental purchases?' }, expect: /uplift/i },
  { persona: 'sociologist', tool: 'choose_method', args: { question: 'Does the effect of a training program on income work through job search effort?' }, expect: /mediation/i },
  { persona: 'IS researcher', tool: 'search', args: { query: 'p-hacking publication bias design-based causal studies' }, expect: /p-Hacking|publication bias/i },
  // Code
  { persona: 'R user', tool: 'get_code', args: { topic: 'difference-in-differences with fixest event study', language: 'r' }, expect: /```r/i },
  { persona: 'Python user', tool: 'get_code', args: { topic: 'logistic regression credit scorecard with weight of evidence', language: 'python' }, expect: /```python/i },
  { persona: 'R user', tool: 'get_code', args: { topic: 'multiple imputation of missing data', language: 'r' }, expect: /```r/i },
  { persona: 'Python user', tool: 'get_code', args: { topic: 'retrieval augmented generation with embeddings', language: 'python' }, expect: /```python/i },
  // Reading and search
  { persona: 'grad student', tool: 'search', args: { query: 'weak instruments test' }, expect: /instrument/i },
  { persona: 'analyst', tool: 'search', args: { query: 'heteroskedasticity robust standard errors' }, expect: /robust|heteroskedastic/i },
  { persona: 'reviewer', tool: 'search', args: { query: 'parallel trends assumption pre-trends test' }, expect: /parallel trends|pre-trend/i },
  // Citations
  { persona: 'author writing a paper', tool: 'cite', args: { style: 'apa' }, expect: /Nguyen, M\./ },
  { persona: 'author writing a paper', tool: 'cite', args: { style: 'bibtex' }, expect: /@(book|manual|article)\{/ },
  { persona: 'librarian', tool: 'list_sources', args: {}, expect: /A Guide on Data Analysis/ },
];

const UA = { 'user-agent': 'research-methods-mcp persona test' };
const linkCache = new Map<string, Promise<string | null>>();
const samePage = (a: string, b: string) => {
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/index\.html$/, '').replace(/\/+$/, '');
  return norm(a) === norm(b);
};

/** null when fine, else a description of the problem. */
function checkLink(url: string): Promise<string | null> {
  const page = url.split('#')[0];
  if (!linkCache.has(page)) {
    linkCache.set(page, (async () => {
      try {
        if (page.startsWith('https://doi.org/')) {
          const r = await fetch(page, { method: 'HEAD', redirect: 'manual', headers: UA });
          return r.status >= 300 && r.status < 400 ? null : `DOI ${r.status}`;
        }
        const r = await fetch(page, { redirect: 'follow', headers: UA });
        if (r.redirected && !samePage(r.url, page)) return `moved to ${r.url}`;
        return r.ok ? null : `HTTP ${r.status}`;
      } catch (e) {
        return `error ${(e as Error).message}`;
      }
    })());
  }
  return linkCache.get(page)!;
}

const client = new Client({ name: 'persona-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(endpoint));

let failures = 0;
let linksChecked = 0;
for (const s of S) {
  const t0 = Date.now();
  const res = (await client.callTool({ name: s.tool, arguments: s.args })) as { content: { text?: string }[]; isError?: boolean };
  const ms = Date.now() - t0;
  const text = res.content.map((c) => c.text ?? '').join('\n');
  const problems: string[] = [];
  if (res.isError) problems.push('tool returned an error');
  if (!s.expect.test(text)) problems.push(`answer lacks ${s.expect}`);
  const urls = [...new Set([...text.matchAll(/https:\/\/[^\s)"'`\]>{}]+/g)].map((m) => m[0].replace(/[.,;]+$/, '')))];
  const linkProblems = (await Promise.all(urls.map(async (u) => [u, await checkLink(u)] as const))).filter(([, p]) => p);
  linksChecked += urls.length;
  for (const [u, p] of linkProblems) problems.push(`link ${u}: ${p}`);
  if (/bookdown\.org/.test(text)) problems.push('answer still links to bookdown.org');
  failures += problems.length ? 1 : 0;
  console.log(`${problems.length ? 'FAIL' : 'PASS'} [${s.persona}] ${s.tool} ${JSON.stringify(s.args).slice(0, 90)}  (${ms} ms, ${urls.length} links)`);
  for (const p of problems.slice(0, 6)) console.log(`       ${p}`);
}
await client.close();
console.log(`\n${S.length - failures}/${S.length} scenarios passed; ${linkCache.size} distinct pages checked across ${linksChecked} links`);
process.exit(failures ? 1 : 0);
