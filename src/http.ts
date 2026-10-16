// Web-standard request handler (Request -> Response) shared by every HTTP host:
// Node (node-http.ts), Deno Deploy (deno.ts), Docker, or any fetch-style runtime.

import { createMcpHandler } from '@modelcontextprotocol/server';
import { ICON_PNG_BASE64 } from './icon.ts';
import type { Library } from './library.ts';
import { landingPage, privacyPage, termsPage } from './pages.ts';
import { createServer, SERVER_NAME, VERSION } from './server.ts';

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

// Clients and directories show the server's favicon next to its name.
const ICON = Uint8Array.from(atob(ICON_PNG_BASE64), (c) => c.charCodeAt(0));
const icon = () =>
  new Response(ICON, {
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*' },
  });

export interface AppOptions {
  /** Domain verification for directory submissions: serve `verifyToken` as plain text at `verifyPath`. */
  verifyPath?: string;
  verifyToken?: string;
}

export function createApp(lib: Library, opts: AppOptions = {}): (req: Request) => Promise<Response> {
  const mcp = createMcpHandler(() => createServer(lib), {
    onerror: (err) => console.error('[mcp]', err.message),
  });
  return async (req: Request) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/mcp') return withCors(await mcp.fetch(req));
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
        return html(privacyPage());
      case '/terms':
        return html(termsPage());
      case '/health':
        return Response.json({ ok: true, name: SERVER_NAME, version: VERSION, sections: lib.index.records.length, built: lib.index.built });
      case '/robots.txt':
        return new Response('User-agent: *\nAllow: /\n', { headers: { 'content-type': 'text/plain' } });
      case '/favicon.ico':
      case '/icon.png':
      case '/apple-touch-icon.png':
        return icon();
      default:
        return new Response('Not found', { status: 404 });
    }
  };
}
