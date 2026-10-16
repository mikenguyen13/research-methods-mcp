// Bundles the Node entry points into dependency-free files, so `npx -y
// research-methods-mcp` installs nothing but this package.

import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
};

await build({ ...common, entryPoints: ['src/stdio.ts'], outfile: 'dist/stdio.js' });
await build({ ...common, entryPoints: ['src/node-http.ts'], outfile: 'dist/http.js' });
await build({ ...common, entryPoints: ['src/vercel.ts'], outfile: 'dist/vercel.js' });
await chmod('dist/stdio.js', 0o755);
await chmod('dist/http.js', 0o755);
console.log('built dist/stdio.js, dist/http.js, and dist/vercel.js');
