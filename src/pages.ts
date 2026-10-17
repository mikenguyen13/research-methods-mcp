// HTML pages served next to the MCP endpoint: install instructions, privacy, terms.
// Directory listings (Anthropic, OpenAI) require public privacy and terms URLs.

import pkg from '../package.json' with { type: 'json' };
import type { Library } from './library.ts';
import { HOMEPAGE, PUBLIC_ORIGIN, SERVER_DESCRIPTION, SERVER_NAME, SERVER_TITLE } from './server.ts';

/** Local (npx) installation is offered only once the package is on npm; see package.json config. */
export const NPM_PUBLISHED: boolean = pkg.config.npmPublished;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{--bg:#f6f7f9;--fg:#18202c;--muted:#586274;--card:#fff;--line:#dde1e8;--accent:#2b5a8f;--code:#eef1f5;--brand:#22385c}
@media (prefers-color-scheme:dark){:root{--bg:#0f141c;--fg:#e4e9f1;--muted:#9aa6b8;--card:#161d28;--line:#2a3443;--accent:#8db8e8;--code:#1b2431;--brand:#c9d7ec}}
.brand{display:flex;align-items:center;gap:14px;margin:0 0 8px}.brand img{width:48px;height:48px;flex:none}.brand h1{margin:0;color:var(--brand)}
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

function page(title: string, body: string, path = '/'): string {
  const url = `${PUBLIC_ORIGIN}${path}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(SERVER_DESCRIPTION)}">
<link rel="canonical" href="${esc(url)}">
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"><link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest"><meta name="theme-color" content="#22385c">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(SERVER_TITLE)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(SERVER_DESCRIPTION)}"><meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${PUBLIC_ORIGIN}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(SERVER_TITLE)}: study designs, assumptions, R and Python code, and citations for AI assistants">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(SERVER_DESCRIPTION)}"><meta name="twitter:image" content="${PUBLIC_ORIGIN}/og.png">
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
<div class="brand"><img src="/icon.svg" alt="" width="48" height="48"><h1>${SERVER_TITLE}</h1></div>
<p class="lede">A Model Context Protocol server that grounds AI assistants in ${total} sections of methodological texts on causal inference, econometrics, experimental design, marketing research, credit scoring, and artificial intelligence. Responses include study design recommendations, the assumptions to verify, runnable R and Python code, and a citation for every source. Access is free and requires no account or API key.</p>
<div class="endpoint"><pre><code id="ep">${esc(endpoint)}</code></pre><button onclick="navigator.clipboard.writeText(document.getElementById('ep').textContent)">Copy URL</button></div>
<div class="badges"><a href="${esc(links.cursor)}">Add to Cursor</a><a href="${esc(links.vscode)}">Install in VS Code</a></div>

<h2>Installation</h2>
<dl>
<dt>Claude (web, desktop, and mobile)</dt><dd>Settings → Connectors → Add custom connector; enter the endpoint URL above.</dd>
<dt>Claude Code</dt><dd><pre><code>${esc(links.claudeCode)}</code></pre></dd>
<dt>ChatGPT</dt><dd>Enable developer mode in Settings, add a custom connector of type MCP server with the endpoint URL above, and select no authentication.</dd>
<dt>Amazon Bedrock AgentCore</dt><dd>Add the endpoint as an MCP server target of an AgentCore Gateway, with no outbound authorization:<pre><code>agentcore add gateway-target --name research-methods --type mcp-server --endpoint ${esc(endpoint)} --gateway &lt;gateway&gt;
agentcore deploy</code></pre></dd>
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
<dt><code>list_sources</code></dt><dd>The works in the library: textbooks, an R package, and research articles.</dd>
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
`, '/privacy');
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
`, '/terms');
}
