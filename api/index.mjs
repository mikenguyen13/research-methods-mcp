// Vercel Function serving the whole site: the MCP endpoint, the landing, privacy,
// and terms pages, the icon, and the health check. See src/vercel.ts and vercel.json.
import { handle } from '../dist/vercel.js';

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
