// HTML pages served next to the MCP endpoint: install instructions, privacy, terms.
// Directory listings (Anthropic, OpenAI) require public privacy and terms URLs.

import pkg from '../package.json' with { type: 'json' };
import type { Library } from './library.ts';
import { HOMEPAGE, SERVER_NAME, SERVER_TITLE } from './server.ts';

/** Local (npx) installation is offered only once the package is on npm; see package.json config. */
export const NPM_PUBLISHED: boolean = pkg.config.npmPublished;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#5f5d57;--card:#fff;--line:#e4e1d9;--accent:#2f5d8a;--code:#f3f1ec}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#a9a69d;--card:#1f1f1d;--line:#34332f;--accent:#8db4dc;--code:#262624}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 16px 64px}h1{font-size:2rem;line-height:1.2;margin:0 0 8px}
h2{font-size:1.25rem;margin:40px 0 12px}p.lede{color:var(--muted);font-size:1.1rem;margin:0 0 24px}
a{color:var(--accent)}code,pre{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
pre{background:var(--code);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;margin:8px 0 0}
code{background:var(--code);padding:1px 5px;border-radius:4px}pre code{background:none;padding:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.card h3{margin:0 0 4px;font-size:1rem}.card p{margin:0;color:var(--muted);font-size:.93rem}
.endpoint{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.endpoint pre{flex:1;margin:0;min-width:0}
button{font:inherit;font-size:.9rem;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:6px 12px;cursor:pointer}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.badges a{display:inline-block;border:1px solid var(--line);background:var(--card);border-radius:6px;padding:6px 12px;text-decoration:none;font-size:.93rem}
dl{margin:0}dt{font-weight:600;margin-top:14px}dd{margin:4px 0 0}footer{margin-top:48px;color:var(--muted);font-size:.9rem}
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="icon" type="image/png" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png"><meta name="description" content="Research methods for AI assistants: R and Python code with citations.">
<style>${STYLE}</style></head><body><main>${body}
<footer><a href="/">Home</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="${HOMEPAGE}">Source on GitHub</a> · <a href="${HOMEPAGE}/issues">Support</a></footer>
</main></body></html>`;
}

/** One-click install links. The https redirect forms also work inside GitHub READMEs. */
export function installLinks(endpoint: string) {
  const name = 'research-methods';
  const cursorConfig = btoa(JSON.stringify({ url: endpoint }));
  return {
    cursor: `https://cursor.com/en/install-mcp?name=${name}&config=${encodeURIComponent(cursorConfig)}`,
    vscode: `https://insiders.vscode.dev/redirect/mcp/install?name=${name}&config=${encodeURIComponent(JSON.stringify({ type: 'http', url: endpoint }))}`,
    claudeCode: `claude mcp add --transport http ${name} ${endpoint}`,
    json: JSON.stringify({ mcpServers: { [name]: { url: endpoint } } }, null, 2),
    stdio: JSON.stringify({ mcpServers: { [name]: { command: 'npx', args: ['-y', SERVER_NAME] } } }, null, 2),
  };
}

export function landingPage(lib: Library, origin: string): string {
  const endpoint = `${origin}/mcp`;
  const links = installLinks(endpoint);
  const sources = lib.index.sources
    .map((s) => `<div class="card"><h3><a href="${esc(s.site)}">${esc(s.title)}</a></h3><p>${esc(s.summary)}</p><p>${s.languages.map((l) => (l === 'r' ? 'R' : l[0].toUpperCase() + l.slice(1))).join(', ')} · ${s.sections.toLocaleString('en-US')} sections</p></div>`)
    .join('');
  const total = lib.index.records.length.toLocaleString('en-US');
  return page(SERVER_TITLE, `
<h1>${SERVER_TITLE}</h1>
<p class="lede">A Model Context Protocol server that grounds AI assistants in ${total} sections of methodological texts on causal inference, econometrics, experimental design, marketing research, credit scoring, and artificial intelligence. Responses include study design recommendations, the assumptions to verify, runnable R and Python code, and a citation for every source. Access is free and requires no account or API key.</p>
<div class="endpoint"><pre><code id="ep">${esc(endpoint)}</code></pre><button onclick="navigator.clipboard.writeText(document.getElementById('ep').textContent)">Copy URL</button></div>
<div class="badges"><a href="${esc(links.cursor)}">Add to Cursor</a><a href="${esc(links.vscode)}">Install in VS Code</a></div>

<h2>Installation</h2>
<dl>
<dt>Claude (web, desktop, and mobile)</dt><dd>Settings → Connectors → Add custom connector; enter the endpoint URL above.</dd>
<dt>Claude Code</dt><dd><pre><code>${esc(links.claudeCode)}</code></pre></dd>
<dt>ChatGPT</dt><dd>Enable developer mode in Settings, add a custom connector of type MCP server with the endpoint URL above, and select no authentication.</dd>
<dt>Cursor, Visual Studio Code, Windsurf, Cline, Zed, and other MCP clients</dt><dd>Use the buttons above, or add the following to the client's MCP configuration:<pre><code>${esc(links.json)}</code></pre></dd>
${NPM_PUBLISHED ? `<dt>Local installation (requires Node.js 20 or later)</dt><dd><pre><code>${esc(links.stdio)}</code></pre></dd>` : ''}
</dl>

<h2>Example queries</h2>
<div class="grid">
<div class="card"><h3>Study design</h3><p>"States raised the minimum wage in different years. How do I estimate the effect on teen employment?"</p></div>
<div class="card"><h3>Implementation</h3><p>"Give me Python code for a regression discontinuity with a data-driven bandwidth."</p></div>
<div class="card"><h3>Identifying assumptions</h3><p>"What could break my synthetic control estimate, and how do I test for it?"</p></div>
<div class="card"><h3>Citation</h3><p>"Write my methods section and give me BibTeX for the sources."</p></div>
</div>

<h2>Tools</h2>
<dl>
<dt><code>choose_method</code></dt><dd>Matches a research question to methods, with assumptions, R and Python packages, and readings.</dd>
<dt><code>search</code> and <code>fetch</code></dt><dd>Find and read sections, with code and links. Compatible with ChatGPT deep research.</dd>
<dt><code>get_code</code></dt><dd>Runnable R, Python, or Julia code for a task.</dd>
<dt><code>cite</code></dt><dd>References in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections consulted.</dd>
<dt><code>list_sources</code></dt><dd>The books and packages in the library.</dd>
</dl>

<h2>Sources</h2>
<div class="grid">${sources}</div>
`);
}

export function privacyPage(): string {
  return page(`Privacy · ${SERVER_TITLE}`, `
<h1>Privacy policy</h1>
<p class="lede">In brief: the service has no user accounts, performs no tracking, and stores no information about its users.</p>
<h2>What the service receives</h2>
<p>When an AI assistant calls a tool, the service receives the tool's arguments: a search query, a section identifier, a topic, or a citation style. These are used to look up an answer in a read-only index of published works, and the result is returned.</p>
<h2>What the service stores</h2>
<p>Nothing. Tool arguments are processed in memory and are not written to a database or log by this service. There are no user accounts, cookies, analytics, or advertising.</p>
<h2>Hosting provider</h2>
<p>The hosting provider may keep standard request logs (such as IP address, time, and requested path) for security and operations, under its own privacy policy.</p>
<h2>AI assistant providers</h2>
<p>Conversations remain with the AI assistant in use (for example, Claude or ChatGPT) and are governed by that provider's privacy policy. The service never receives the conversation, only the tool arguments the assistant sends.</p>
<h2>Children</h2>
<p>The service collects no personal information from anyone, including children.</p>
<h2>Contact</h2>
<p>Questions about this policy may be raised by <a href="${HOMEPAGE}/issues">opening an issue on GitHub</a>.</p>
`);
}

export function termsPage(): string {
  return page(`Terms · ${SERVER_TITLE}`, `
<h1>Terms of use</h1>
<p>The ${SERVER_TITLE} is a free, read-only service that returns excerpts, code, and citations from books and software written by Mike Nguyen.</p>
<h2>Content and licenses</h2>
<p>Each work retains its own license, listed by the <code>list_sources</code> tool and on each work's website. Works under open licenses are served in full; for the others, only short excerpts and code are served, and the full text remains on the work's website. Users are asked to cite the works they draw on; the <code>cite</code> tool formats the references.</p>
<h2>No warranty</h2>
<p>The service and its content are provided as is, without warranty of any kind. Statistical guidance is provided for educational purposes; users should verify results and assumptions against their own data before relying on them.</p>
<h2>Acceptable use</h2>
<p>The service must not be overloaded or used to reproduce the works wholesale. Access may be rate limited or changed at any time.</p>
<h2>Contact</h2>
<p>Questions may be raised by <a href="${HOMEPAGE}/issues">opening an issue on GitHub</a>.</p>
`);
}
