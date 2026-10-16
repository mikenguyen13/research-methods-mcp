// Entry point for Deno Deploy (free tier). Uses the same web-standard handler as
// the Node server; deno.json maps the npm packages. The prebuilt search index
// keeps cold starts cheap: it is loaded on first search instead of being built.

import { createApp } from './http.ts';
import { Library } from './library.ts';

const bytes = await Deno.readFile(new URL('../data/index.json.gz', import.meta.url));
const search = await Deno.readFile(new URL('../data/search.json.gz', import.meta.url)).catch(() => undefined);
const lib = await Library.fromGzip(bytes, search);
Deno.serve(createApp(lib, { verifyPath: Deno.env.get('VERIFY_PATH'), verifyToken: Deno.env.get('VERIFY_TOKEN') }));
