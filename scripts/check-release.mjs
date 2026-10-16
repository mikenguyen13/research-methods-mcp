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

const versions = {
  'package.json': pkg.version,
  'server.json': server.version,
  ...(server.packages ? { 'server.json packages[0]': server.packages[0]?.version } : {}),
  'manifest.json': manifest.version,
  'CITATION.cff': /^version:\s*(\S+)/m.exec(cff)?.[1],
};
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
