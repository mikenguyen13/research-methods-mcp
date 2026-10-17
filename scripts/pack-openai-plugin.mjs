// Builds the ChatGPT plugin directory package (Agent Plugins format) from
// openai-plugin/ and the icons in assets/, validates it against the published
// Agent Plugins schemas, and writes research-methods-openai-plugin.zip.
//   node scripts/pack-openai-plugin.mjs
// Upload the ZIP at platform.openai.com → Plugins → Upload new or existing plugin.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const stage = 'dist/openai-plugin';
const out = 'research-methods-openai-plugin.zip';

rmSync(stage, { recursive: true, force: true });
mkdirSync(`${stage}/assets`, { recursive: true });
copyFileSync('openai-plugin/plugin.json', `${stage}/plugin.json`);
copyFileSync('openai-plugin/mcp.json', `${stage}/mcp.json`);
copyFileSync('assets/icon.png', `${stage}/assets/icon.png`); // composer icon
copyFileSync('assets/icon-square.png', `${stage}/assets/logo.png`); // primary listing icon

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
for (const [file, schemaUrl] of [
  ['plugin.json', 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'],
  ['mcp.json', 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'],
]) {
  const schema = await (await fetch(schemaUrl)).json();
  delete schema.$schema; // validate with the 2020-12 dialect regardless of the declared draft
  const validate = ajv.compile(schema);
  const data = JSON.parse(readFileSync(`${stage}/${file}`, 'utf8'));
  if (!validate(data)) {
    console.error(`${file} does not match ${schemaUrl}:`, validate.errors);
    process.exit(1);
  }
}

rmSync(out, { force: true });
// bsdtar (Windows 10+, macOS) writes a ZIP when the archive name ends in .zip.
execFileSync('tar', ['-a', '-cf', out, '-C', stage, 'plugin.json', 'mcp.json', 'assets'], { stdio: 'inherit' });
console.log(`wrote ${out}`);
