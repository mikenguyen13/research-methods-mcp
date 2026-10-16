// Loads the bundled index from disk under Node. The path resolves from both
// src/ (tsx) and dist/ (bundled) because each sits one level below the root.
// The prebuilt search index is optional; without it the search index is built
// on first use.

import { readFile } from 'node:fs/promises';
import { Library } from './library.ts';

export async function loadLibrary(): Promise<Library> {
  const file = process.env.RML_INDEX ?? new URL('../data/index.json.gz', import.meta.url);
  const searchFile = process.env.RML_SEARCH ?? new URL('../data/search.json.gz', import.meta.url);
  const search = process.env.RML_INDEX && !process.env.RML_SEARCH ? undefined : await readFile(searchFile).catch(() => undefined);
  return Library.fromGzip(await readFile(file), search);
}
