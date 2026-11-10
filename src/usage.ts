// Anonymous daily usage counts for the hosted endpoint: how many times each tool and
// prompt is called, and which client applications connect. Tool arguments, IP
// addresses, and session identifiers are never read or stored; see the privacy page.
//
// Counts live in a Redis hash per UTC day (usage:YYYY-MM-DD), written through the
// Upstash REST API. Without credentials (local runs, npx, Docker) nothing is recorded.

const PREFIX = 'usage:';
/** About 13 months, so a year-over-year comparison stays possible. */
const TTL_SECONDS = 400 * 86_400;

// Names outside these sets are counted as "other" so arbitrary input cannot add fields.
const TOOLS = new Set(['choose_method', 'search', 'fetch', 'get_code', 'cite', 'list_sources']);
const PROMPTS = new Set(['plan_analysis', 'write_methods_section', 'explain_method']);

/** A client's self-reported name (clientInfo.name), reduced to a short, safe label. */
export function clientLabel(name: unknown): string {
  if (typeof name !== 'string') return 'unknown';
  const label = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return label || 'unknown';
}

/**
 * Counter fields for one JSON-RPC body sent to /mcp (a message or a batch). Only the
 * method, the tool or prompt name, and the client's name are read; arguments are not.
 */
export function usageFields(body: unknown): string[] {
  const fields: string[] = [];
  for (const msg of Array.isArray(body) ? body : [body]) {
    if (!msg || typeof msg !== 'object') continue;
    const { method, params } = msg as { method?: unknown; params?: any };
    if (method === 'initialize') {
      fields.push('connect', `client:${clientLabel(params?.clientInfo?.name)}`);
    } else if (method === 'tools/call') {
      fields.push('calls', `tool:${TOOLS.has(params?.name) ? params.name : 'other'}`);
    } else if (method === 'prompts/get') {
      fields.push(`prompt:${PROMPTS.has(params?.name) ? params.name : 'other'}`);
    } else if (method === 'resources/read') {
      fields.push('resource:read');
    }
  }
  return fields;
}

export interface DayCounts {
  date: string;
  counts: Record<string, number>;
}

export interface UsageStore {
  record(fields: string[], now?: Date): Promise<void>;
  /** The last `days` UTC days, newest first. */
  recent(days: number, now?: Date): Promise<DayCounts[]>;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Upstash Redis over REST: one pipelined request per write or read. */
export class UpstashUsage implements UsageStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async pipeline(commands: (string | number)[][]): Promise<{ result?: unknown; error?: string }[]> {
    const res = await fetch(`${this.url.replace(/\/+$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`usage store responded ${res.status}`);
    return res.json();
  }

  async record(fields: string[], now = new Date()): Promise<void> {
    if (!fields.length) return;
    const key = PREFIX + dayKey(now);
    await this.pipeline([...fields.map((f) => ['HINCRBY', key, f, 1]), ['EXPIRE', key, TTL_SECONDS]]);
  }

  async recent(days: number, now = new Date()): Promise<DayCounts[]> {
    const dates = Array.from({ length: days }, (_, i) => dayKey(new Date(now.getTime() - i * 86_400_000)));
    const replies = await this.pipeline(dates.map((d) => ['HGETALL', PREFIX + d]));
    return dates.map((date, i) => {
      const flat = (replies[i]?.result as string[] | undefined) ?? [];
      const counts: Record<string, number> = {};
      for (let j = 0; j + 1 < flat.length; j += 2) counts[flat[j]] = Number(flat[j + 1]);
      return { date, counts };
    });
  }
}

/**
 * The store configured in the environment: Upstash's own variable names, or the ones
 * Vercel's Upstash integration sets. Undefined when neither is present.
 */
export function usageFromEnv(env: Record<string, string | undefined>): UsageStore | undefined {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? new UpstashUsage(url, token) : undefined;
}
