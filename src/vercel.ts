// Entry point for Vercel Functions (Node.js runtime), bundled to dist/vercel.js and
// re-exported by api/index.mjs. vercel.json rewrites every path to that function and
// passes the original path in the __path query parameter, which is restored here so
// the shared web-standard handler sees the request as the client sent it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from './http.ts';
import { Library } from './library.ts';

const dataDir = path.join(process.cwd(), 'data');

// Loaded once per instance; concurrent first requests share the same promise.
const app = (async () => {
  const index = await readFile(path.join(dataDir, 'index.json.gz'));
  const search = await readFile(path.join(dataDir, 'search.json.gz')).catch(() => undefined);
  const lib = await Library.fromGzip(index, search);
  return createApp(lib, { verifyPath: process.env.VERIFY_PATH, verifyToken: process.env.VERIFY_TOKEN });
})();

function restorePath(req: Request): Request {
  const url = new URL(req.url);
  const original = url.searchParams.get('__path');
  if (original === null) return req;
  url.searchParams.delete('__path');
  url.pathname = original.startsWith('/') ? original : `/${original}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? req.body : undefined,
    signal: req.signal,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

export async function handle(req: Request): Promise<Response> {
  return (await app)(restorePath(req));
}
