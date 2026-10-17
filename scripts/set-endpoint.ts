// Points every published file at the deployed endpoint.
//
//   npm run set-endpoint -- https://research-methods.example.org/mcp
//
// Rewrites server.json's remote, regenerates the install block in README.md
// (between the install:start/install:end markers), and replaces the old origin
// in docs/LISTING.md. The current endpoint is kept in package.json "config".
// The npm package entry and the local-install instructions are included only
// when package.json config.npmPublished is true.

import { readFile, writeFile } from 'node:fs/promises';
import { installLinks, NPM_PUBLISHED } from '../src/pages.ts';

const endpoint = process.argv[2];
if (!endpoint || !/^https:\/\/[^/]+\/mcp$/.test(endpoint)) {
  console.error('usage: npm run set-endpoint -- https://<host>/mcp');
  process.exit(1);
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const previous: string = pkg.config?.endpoint ?? 'https://YOUR-HOST/mcp';
const oldOrigin = new URL(previous.replace('YOUR-HOST', 'your-host.invalid')).origin.replace('your-host.invalid', 'YOUR-HOST');
const newOrigin = new URL(endpoint).origin;

const server = JSON.parse(await readFile('server.json', 'utf8'));
delete server.packages;
delete server.remotes;
if (NPM_PUBLISHED) {
  server.packages = [{ registryType: 'npm', identifier: pkg.name, version: pkg.version, transport: { type: 'stdio' } }];
}
server.remotes = [{ type: 'streamable-http', url: endpoint }];
await writeFile('server.json', JSON.stringify(server, null, 2) + '\n');

const l = installLinks(endpoint);
const local = NPM_PUBLISHED
  ? `\nTo run the server locally instead (requires Node.js 20 or later):\n\n\`\`\`json\n${l.stdio}\n\`\`\`\n`
  : '';
const block = `<!-- install:start -->
**Endpoint:** \`${endpoint}\`. Access is free and requires no account or API key.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](${l.cursor})
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?logo=visualstudiocode&logoColor=white)](${l.vscode})

| Client | Configuration |
| --- | --- |
| Claude (web, desktop, and mobile) | Settings → Connectors → **Add custom connector**; enter the endpoint |
| Claude Code | \`${l.claudeCode}\` |
| ChatGPT | Settings → enable developer mode → add a custom connector of type MCP server with the endpoint and no authentication |
| Amazon Bedrock AgentCore | Add the endpoint as an MCP server target of an AgentCore Gateway, with no outbound authorization: \`agentcore add gateway-target --name research-methods --type mcp-server --endpoint ${endpoint} --gateway <gateway>\`, then \`agentcore deploy\` |
| Cursor, Visual Studio Code | Use the buttons above |
| Windsurf, Cline, Zed, and other clients | Add the following JSON to the client's MCP configuration |

\`\`\`json
${l.json}
\`\`\`
${local}<!-- install:end -->`;

let readme = await readFile('README.md', 'utf8');
readme = readme.replace(/<!-- install:start -->[\s\S]*?<!-- install:end -->/, block).replaceAll(oldOrigin, newOrigin);
await writeFile('README.md', readme);

const listing = await readFile('docs/LISTING.md', 'utf8');
await writeFile('docs/LISTING.md', listing.replaceAll(oldOrigin, newOrigin));

pkg.config = { ...pkg.config, endpoint };
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`endpoint set to ${endpoint} (was ${previous})`);
