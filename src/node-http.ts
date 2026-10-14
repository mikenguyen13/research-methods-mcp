// HTTP server for Node and Docker: `npm start` or `docker run -p 8080:8080 ...`.
// HOST defaults to loopback; the Docker image sets HOST=0.0.0.0.

import { createServer as createHttpServer } from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createApp } from './http.ts';
import { loadLibrary } from './load.ts';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

const t0 = Date.now();
const lib = await loadLibrary();
const handler = toNodeHandler({
  fetch: createApp(lib, { verifyPath: process.env.VERIFY_PATH, verifyToken: process.env.VERIFY_TOKEN }),
});

createHttpServer((req, res) => {
  handler(req, res).catch((err: Error) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end('Internal error');
  });
}).listen(port, host, () => {
  console.log(`research-methods-mcp: ${lib.index.records.length} sections loaded in ${Date.now() - t0} ms; MCP endpoint http://${host}:${port}/mcp`);
});
