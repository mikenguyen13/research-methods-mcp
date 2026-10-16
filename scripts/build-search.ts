// Builds data/search.json.gz, the serialized section search index, from data/index.json.gz.
// Loading it takes about a fifth of the CPU time of building the index at startup.
//   npm run build:search   (also run by npm run build:index)

import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { serializeSectionSearch } from '../src/library.ts';
import type { LibraryIndex } from '../src/types.ts';

const index = JSON.parse(gunzipSync(await readFile('data/index.json.gz')).toString()) as LibraryIndex;
const text = serializeSectionSearch(index);
const gz = gzipSync(text, { level: 9 });
await writeFile('data/search.json.gz', gz);
console.log(`data/search.json.gz: ${index.records.length} sections, ${(text.length / 1e6).toFixed(1)} MB JSON, ${(gz.length / 1e6).toFixed(1)} MB gzipped`);
