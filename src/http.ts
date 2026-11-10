// Web-standard request handler (Request -> Response) shared by every HTTP host:
// Node (node-http.ts), Deno Deploy (deno.ts), Docker, or any fetch-style runtime.

import { createMcpHandler } from '@modelcontextprotocol/server';
import { FAVICON_ICO_BASE64, ICON_PNG_BASE64, ICON_SVG, OG_PNG_BASE64 } from './icon.ts';
import type { Library } from './library.ts';
import { configureWebAnalytics, landingPage, privacyPage, statsPage, termsPage, type WebAnalytics } from './pages.ts';
import { createServer, HOMEPAGE, PUBLIC_ORIGIN, SERVER_DESCRIPTION, SERVER_NAME, SERVER_TITLE, VERSION } from './server.ts';
import { describeCall, usageFields, type UsageStore } from './usage.ts';

/** Pages for search engines; lastmod is the index build date. */
function sitemap(lib: Library): string {
  const lastmod = lib.index.built.slice(0, 10);
  const urls = ['/', '/llms.txt', '/privacy', '/terms'].map(
    (p) => `  <url><loc>${PUBLIC_ORIGIN}${p}</loc><lastmod>${lastmod}</lastmod></url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/** llms.txt (https://llmstxt.org): what the server offers, how to connect, and what it draws on. */
function llmsTxt(lib: Library): string {
  const endpoint = `${PUBLIC_ORIGIN}/mcp`;
  const sources = lib.index.sources.map((s) => `- [${s.title}](${s.site}): ${s.summary}`);
  return [
    `# ${SERVER_TITLE}`,
    '',
    `> ${SERVER_DESCRIPTION} A Model Context Protocol (MCP) server; free, read-only, and requires no account or API key.`,
    '',
    `MCP endpoint (Streamable HTTP, no authentication): ${endpoint}`,
    '',
    '## Connect',
    '',
    `- Claude (web, desktop, and mobile): Settings > Connectors > Add custom connector, with the endpoint above.`,
    `- Claude Code: \`claude mcp add --transport http research-methods ${endpoint}\``,
    '- ChatGPT: enable developer mode, then add a custom connector of type MCP server with the endpoint above and no authentication.',
    `- Amazon Bedrock AgentCore: add the endpoint as an MCP server target of an AgentCore Gateway with no outbound authorization (\`agentcore add gateway-target --name research-methods --type mcp-server --endpoint ${endpoint} --gateway <gateway>\`, then \`agentcore deploy\`).`,
    `- Cursor, Visual Studio Code, Windsurf, Cline, Zed, and other MCP clients: {"mcpServers": {"research-methods": {"url": "${endpoint}"}}}`,
    '',
    '## Tools',
    '',
    '- choose_method: recommends study designs and methods for a research question, with assumptions, R and Python packages, and readings.',
    '- search and fetch: find and read sections, with code, links, and citations.',
    '- get_code: runnable R, Python, or Julia code for an analysis task.',
    '- cite: references in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections consulted.',
    '- list_sources: the works in the library, with licenses and citations.',
    '',
    `## Sources (${lib.index.records.length.toLocaleString('en-US')} sections)`,
    '',
    ...sources,
    '',
    '## Optional',
    '',
    `- [Installation and examples](${PUBLIC_ORIGIN}/)`,
    `- [Source code and documentation](${HOMEPAGE})`,
    `- [Privacy policy](${PUBLIC_ORIGIN}/privacy)`,
    `- [Terms of use](${PUBLIC_ORIGIN}/terms)`,
    '',
  ].join('\n');
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, authorization, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' } });

// Clients and directories show the server's icon (from serverInfo.icons or the
// site favicon) next to its name; link previews use the Open Graph image.
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const asset = (body: BodyInit, type: string) => () =>
  new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' } });
const ASSETS: Record<string, () => Response> = {
  '/favicon.ico': asset(bytes(FAVICON_ICO_BASE64), 'image/x-icon'),
  '/icon.svg': asset(ICON_SVG, 'image/svg+xml'),
  '/icon.png': asset(bytes(ICON_PNG_BASE64[512]), 'image/png'),
  '/icon-192.png': asset(bytes(ICON_PNG_BASE64[192]), 'image/png'),
  '/apple-touch-icon.png': asset(bytes(ICON_PNG_BASE64[180]), 'image/png'),
  '/favicon-32x32.png': asset(bytes(ICON_PNG_BASE64[32]), 'image/png'),
  '/favicon-16x16.png': asset(bytes(ICON_PNG_BASE64[16]), 'image/png'),
  '/og.png': asset(bytes(OG_PNG_BASE64), 'image/png'),
  '/site.webmanifest': asset(
    JSON.stringify({
      name: SERVER_TITLE,
      short_name: 'Research Methods',
      description: SERVER_DESCRIPTION,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
      theme_color: '#22385c',
      background_color: '#f4f6f9',
      display: 'browser',
    }),
    'application/manifest+json',
  ),
};

export interface AppOptions {
  /** Domain verification for directory submissions: serve `verifyToken` as plain text at `verifyPath`. */
  verifyPath?: string;
  verifyToken?: string;
  /** Where anonymous usage counts are kept; nothing is recorded without one. */
  usage?: UsageStore;
  /** Keeps a serverless function alive until the usage write finishes. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Secret for the /stats page (passed as ?key=); the page does not exist without it. */
  statsKey?: string;
  /** Page-view analytics for the HTML pages. */
  webAnalytics?: WebAnalytics;
}

/** The analytics settings every host reads from its environment. */
export function analyticsFromEnv(env: Record<string, string | undefined>): Pick<AppOptions, 'statsKey' | 'webAnalytics'> {
  return {
    statsKey: env.STATS_KEY || undefined,
    webAnalytics: { vercel: env.WEB_ANALYTICS_VERCEL === '1', googleId: env.GA_MEASUREMENT_ID },
  };
}

/** Counts the tool, prompt, and client named in a POST to /mcp, without delaying the response. */
function recordUsage(body: Promise<unknown>, opts: AppOptions): void {
  const { usage } = opts;
  if (!usage) return;
  const pending = body
    .then((b) => usage.record(usageFields(b)))
    .catch((err: Error) => console.error('[usage]', err.message));
  opts.waitUntil?.(pending);
}

/** How long an /mcp response may stay open before it is logged as slow. */
const SLOW_MS = 10_000;

/**
 * Logs MCP responses that stay open longer than SLOW_MS, naming the method, tool, and
 * argument sizes (see describeCall) so a hang can be traced without logging any query.
 */
function watchSlow(res: Response, body: Promise<unknown>): Response {
  if (!res.body) return res;
  const started = Date.now();
  const describe = () => body.then(describeCall, () => 'unparsed');
  const timer = setTimeout(() => {
    void describe().then((d) => console.warn(`[mcp] response still open after ${SLOW_MS / 1000} s: ${d}`));
  }, SLOW_MS);
  (timer as { unref?: () => void }).unref?.();
  const done = () => {
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (ms >= SLOW_MS) void describe().then((d) => console.warn(`[mcp] response finished after ${ms} ms: ${d}`));
  };
  const watched = res.body.pipeThrough(new TransformStream({ flush: done }));
  return new Response(watched, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function stats(url: URL, opts: AppOptions): Promise<Response> {
  if (!opts.usage || !opts.statsKey || url.searchParams.get('key') !== opts.statsKey) {
    return new Response('Not found', { status: 404 });
  }
  const days = await opts.usage.recent(Math.min(400, Math.max(1, Number(url.searchParams.get('days')) || 30)));
  const headers = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  if (url.searchParams.get('format') === 'json') return Response.json(days, { headers });
  return new Response(statsPage(days), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

export function createApp(lib: Library, opts: AppOptions = {}): (req: Request) => Promise<Response> {
  const mcp = createMcpHandler(() => createServer(lib), {
    onerror: (err) => console.error('[mcp]', err.message),
  });
  configureWebAnalytics(opts.webAnalytics ?? {});
  return async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/mcp') {
      if (req.method !== 'POST') return withCors(await mcp.fetch(req));
      const body: Promise<unknown> = req.clone().json().catch(() => undefined);
      recordUsage(body, opts);
      return withCors(watchSlow(await mcp.fetch(req), body));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    if (opts.verifyPath && opts.verifyToken && url.pathname === opts.verifyPath) {
      return new Response(opts.verifyToken, { headers: { 'content-type': 'text/plain' } });
    }
    // Behind a proxy the request URL may say http; the forwarded header has the public scheme.
    const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const origin = `${proto}://${req.headers.get('x-forwarded-host') ?? url.host}`;
    switch (path) {
      case '/':
        return html(landingPage(lib, origin));
      case '/privacy':
        return html(privacyPage(!!opts.usage));
      case '/terms':
        return html(termsPage());
      case '/stats':
        return stats(url, opts);
      case '/health':
        return Response.json({ ok: true, name: SERVER_NAME, version: VERSION, sections: lib.index.records.length, built: lib.index.built });
      case '/robots.txt':
        return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain' } });
      case '/sitemap.xml':
        return new Response(sitemap(lib), { headers: { 'content-type': 'application/xml', 'cache-control': 'public, max-age=86400' } });
      case '/llms.txt':
        return new Response(llmsTxt(lib), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
      default:
        return ASSETS[path]?.() ?? new Response('Not found', { status: 404 });
    }
  };
}
