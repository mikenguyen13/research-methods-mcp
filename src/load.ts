// Loads the bundled index from disk under Node. The path resolves from both
// src/ (tsx) and dist/ (bundled) because each sits one level below the root.

import { readFile } from 'node:fs/promises';
import { Library } from './library.ts';

export async function loadLibrary(): Promise<Library> {
  const file = process.env.RML_INDEX ?? new URL('../data/index.json.gz', import.meta.url);
  return Library.fromGzip(await readFile(file));
}
