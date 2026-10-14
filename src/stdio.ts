// Local server over stdio: `npx -y research-methods-mcp`.

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadLibrary } from './load.ts';
import { createServer } from './server.ts';

const lib = await loadLibrary();
serveStdio(() => createServer(lib));
