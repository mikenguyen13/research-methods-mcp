// Pre-publish checks: versions agree, no placeholders, listing limits respected.
//   node scripts/check-release.mjs

import { existsSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const errors = [];
const read = (f) => readFileSync(f, 'utf8');
const pkg = JSON.parse(read('package.json'));
const server = JSON.parse(read('server.json'));
const manifest = JSON.parse(read('manifest.json'));
const cff = read('CITATION.cff');
const plugin = JSON.parse(read('openai-plugin/plugin.json'));

const versions = {
  'package.json': pkg.version,
  'server.json': server.version,
  ...(server.packages ? { 'server.json packages[0]': server.packages[0]?.version } : {}),
  'manifest.json': manifest.version,
  'CITATION.cff': /^version:\s*(\S+)/m.exec(cff)?.[1],
  'openai-plugin/plugin.json': plugin.version,
};

// ChatGPT plugin directory limits (developers.openai.com/plugins/deploy/submission).
const ui = plugin.extensions?.['com.openai']?.interface ?? {};
const tests = plugin.extensions?.['com.openai']?.review?.test_cases ?? {};
for (const [field, max] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000]]) {
  if (!ui[field] || ui[field].length > max) errors.push(`openai-plugin ${field} is ${ui[field]?.length ?? 0} chars (1..${max})`);
}
if (plugin.name.length > 64) errors.push(`openai-plugin name is ${plugin.name.length} chars (max 64)`);
if ((ui.capabilities ?? []).length > 20 || (ui.capabilities ?? []).some((c) => c.length > 120)) errors.push('openai-plugin capabilities: at most 20, each at most 120 chars');
for (const u of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) if (!ui[u]) errors.push(`openai-plugin ${u} is required for MCP review`);
if ((tests.positive ?? []).length < 5 || (tests.negative ?? []).length < 3) errors.push('openai-plugin needs five positive and three negative test cases');
const pluginMcp = JSON.parse(read('openai-plugin/mcp.json'));
const pluginUrl = Object.values(pluginMcp.mcpServers ?? {})[0]?.url;
if (pluginUrl !== pkg.config?.endpoint) errors.push(`openai-plugin/mcp.json url ${pluginUrl} != package.json config.endpoint ${pkg.config?.endpoint}`);
const npmPublished = pkg.config?.npmPublished === true;
if (Boolean(server.packages?.length) !== npmPublished) {
  errors.push(`server.json packages must ${npmPublished ? '' : 'not '}be listed while config.npmPublished is ${npmPublished}; run npm run set-endpoint`);
}
if (!npmPublished && read('README.md').includes('"npx"')) {
  errors.push('README.md offers npx installation but config.npmPublished is false; run npm run set-endpoint');
}
if (new Set(Object.values(versions)).size !== 1) errors.push(`versions disagree: ${JSON.stringify(versions)}`);
if (server.name !== pkg.mcpName) errors.push(`server.json name ${server.name} != package.json mcpName ${pkg.mcpName}`);
if (server.description.length > 100) errors.push(`server.json description is ${server.description.length} chars (max 100)`);
if (server.title.length > 100) errors.push('server.json title over 100 chars');
for (const f of ['server.json', 'README.md', 'docs/LISTING.md']) {
  if (read(f).includes('YOUR-HOST')) errors.push(`${f} still has the YOUR-HOST placeholder; run npm run set-endpoint -- https://<host>/mcp`);
}
if (!existsSync('data/index.json.gz')) errors.push('data/index.json.gz missing; run npm run build:index');
else {
  const index = JSON.parse(gunzipSync(readFileSync('data/index.json.gz')).toString());
  const days = (Date.now() - Date.parse(index.built)) / 864e5;
  if (days > 60) console.warn(`warning: the index was built ${Math.round(days)} days ago`);
  console.log(`index: ${index.records.length} sections, ${index.methods.length} methods, built ${index.built}`);
  // The prebuilt search index must match this index build, or hosts rebuild it at runtime (slow, costly).
  if (!existsSync('data/search.json.gz')) errors.push('data/search.json.gz missing; run npm run build:search');
  else {
    const text = gunzipSync(readFileSync('data/search.json.gz')).toString();
    const header = JSON.parse(text.slice(0, text.indexOf('\n')));
    if (header.built !== index.built || header.records !== index.records.length) {
      errors.push(`data/search.json.gz is for index ${header.built}, not ${index.built}; run npm run build:search`);
    }
  }
}
for (const f of ['dist/stdio.js', 'dist/http.js']) {
  if (!existsSync(f)) errors.push(`${f} missing; run npm run build`);
  else if (statSync(f).mtimeMs < statSync('src/server.ts').mtimeMs) errors.push(`${f} is older than src/; run npm run build`);
}

if (errors.length) {
  console.error(`release check failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('release check passed');
