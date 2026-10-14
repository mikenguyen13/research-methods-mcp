// Entry point for Deno Deploy (free tier). Uses the same web-standard handler as
// the Node server; deno.json maps the npm packages.

import { createApp } from './http.ts';
import { Library } from './library.ts';

const bytes = await Deno.readFile(new URL('../data/index.json.gz', import.meta.url));
const lib = await Library.fromGzip(bytes);
Deno.serve(createApp(lib, { verifyPath: Deno.env.get('VERIFY_PATH'), verifyToken: Deno.env.get('VERIFY_TOKEN') }));
