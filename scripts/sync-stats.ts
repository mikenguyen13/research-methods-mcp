// Copies usage numbers into a private Google Sheet that a Looker Studio report reads,
// so every number can be seen on one page without a running computer. Run hourly by
// .github/workflows/stats.yml; see docs/DASHBOARD.md for the one-time setup.
//
// Sources, each skipped when its credentials are missing:
//   - MCP endpoint: the anonymous daily counters in Upstash Redis (usage:YYYY-MM-DD).
//   - Book sites: Google Analytics 4, through the Analytics Data API.
//   - GitHub: stars, forks, and watchers of this repository and each book repository.
//
// The repository is public, so this script never prints a count: Action logs only
// show which tabs were written and how many rows they hold.
//
// Environment:
//   STATS_SHEET_ID                      the spreadsheet id (from its URL)
//   GOOGLE_ACCESS_TOKEN                 a short-lived token for the service account; the
//                                       workflow gets one through Workload Identity
//                                       Federation, so no key exists
//   GOOGLE_SERVICE_ACCOUNT_KEY          alternatively, a JSON key (for local runs)
//   (MCP counts) in GitHub Actions, nothing: the run's OIDC token opens the endpoint's
//   /stats.json. Elsewhere, Upstash directly:
//   UPSTASH_REDIS_REST_URL              the Redis REST URL
//   UPSTASH_REDIS_REST_READONLY_TOKEN   a read-only token (KV_REST_API_READ_ONLY_TOKEN)
//   GITHUB_TOKEN                        optional, raises the GitHub API rate limit

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Google Analytics 4 properties of the book sites (property id → label). */
const GA_PROPERTIES: Record<string, string> = {
  '282893909': 'A Guide on Data Analysis',
  '542217526': 'Advanced Data Analysis',
  '282930143': 'Marketing Research',
  '533726944': 'Credit Scoring',
  '523270394': 'AI in Action',
  '458599553': 'Machine Learning in Python (mlpy)',
  '431260917': 'causalverse',
  '283138615': 'Social Theory',
  '523176131': 'Tidy Finance in Vietnam',
  '525746215': 'Tidy Finance in Vietnam (Vietnamese)',
  '525746517': 'Tidy Finance in Vietnam (website)',
  '283135077': 'Communication Theory',
  '301873766': 'Measurement Theory',
  '349531366': 'Meta Analysis',
  '563446251': 'Research Methods Library (MCP site)',
};

/**
 * Client names (clientInfo.name) of applications people use. Anything else that connects
 * is a directory crawler, uptime monitor, or quality probe, counted as "bot". Matched on
 * the start of the name; extend this list when a new application shows up in mcp_clients.
 */
const APP_CLIENTS = [
  'anthropic', 'claude', 'cursor', 'vscode', 'visual-studio-code', 'github-copilot', 'copilot',
  'windsurf', 'cline', 'roo', 'kilo', 'zed', 'goose', 'opencode', 'codex', 'openai', 'chatgpt',
  'gemini', 'continue', 'librechat', 'n8n', 'raycast', 'lm-studio', 'lmstudio', 'jan', 'msty',
  '5ire', 'cherry', 'chatwise', 'mcp-remote', 'amp', 'warp', 'kiro', 'perplexity', 'le-chat',
  'mistral', 'jetbrains', 'junie', 'coda-agent-runtime', 'trae', 'qodo', 'augment', 'witsy',
];

const TOOLS = ['search', 'fetch', 'choose_method', 'get_code', 'cite', 'list_sources', 'other'];
/** Days re-read on each run; the sheet keeps everything older. A first run backfills. */
const RECENT_DAYS = 3;
const BACKFILL_DAYS = 400;

export function clientKind(name: string): 'app' | 'bot' {
  return APP_CLIENTS.some((p) => name === p || name.startsWith(p + '-') || name.startsWith(p + '.')) ? 'app' : 'bot';
}

const env = process.env;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const lastDays = (n: number, now = new Date()) =>
  Array.from({ length: n }, (_, i) => iso(new Date(now.getTime() - i * 86_400_000)));

// ---------------------------------------------------------------- Google auth

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

async function googleToken(sa: ServiceAccount, scopes: string[]): Promise<string> {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: scopes.join(' '),
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token request failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function google<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url.split('?')[0]} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------- Sheet

type Cell = string | number;
type Row = Cell[];

class Sheet {
  private base: string;
  private tabs = new Set<string>();

  constructor(
    private token: string,
    id: string,
  ) {
    this.base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  }

  async init() {
    const meta = await google<{ sheets: { properties: { title: string } }[] }>(this.token, `${this.base}?fields=sheets.properties.title`);
    for (const s of meta.sheets) this.tabs.add(s.properties.title);
  }

  private async ensure(tab: string) {
    if (this.tabs.has(tab)) return;
    await google(this.token, `${this.base}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    });
    this.tabs.add(tab);
  }

  /** Data rows of a tab (header excluded); the first column, a date, comes back as YYYY-MM-DD. */
  async read(tab: string): Promise<Row[]> {
    if (!this.tabs.has(tab)) return [];
    const q = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
    const r = await google<{ values?: Row[] }>(this.token, `${this.base}/values/${encodeURIComponent(tab)}!A2:Z?${q}`);
    return (r.values ?? []).map(([date, ...rest]) => [serialDate(date), ...rest]);
  }

  /** Replaces a tab's contents with a header and rows. */
  async write(tab: string, header: string[], rows: Row[]) {
    await this.ensure(tab);
    const range = encodeURIComponent(`${tab}!A1:Z`);
    await google(this.token, `${this.base}/values/${range}:clear`, { method: 'POST', body: '{}' });
    await google(this.token, `${this.base}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      body: JSON.stringify({ values: [header, ...rows] }),
    });
    console.log(`wrote ${tab} (${rows.length} rows)`);
  }
}

/** Sheets stores dates as days since 1899-12-30; turn one back into YYYY-MM-DD. */
export function serialDate(c: Cell): string {
  return typeof c === 'number' ? iso(new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000)) : String(c);
}

/** Keeps stored rows for dates not re-read now, adds the fresh rows, sorts newest first. */
export function merge(stored: Row[], fresh: Row[], freshDates: Set<string>): Row[] {
  return [...stored.filter((r) => !freshDates.has(String(r[0]))), ...fresh].sort(
    (a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])),
  );
}

// ---------------------------------------------------------------- MCP usage (Upstash)

/** The hosted endpoint's origin, from package.json (config.endpoint without /mcp). */
function endpointOrigin(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { config?: { endpoint?: string } };
  return (env.MCP_ORIGIN ?? pkg.config?.endpoint ?? 'https://research-methods-mcp.vercel.app/mcp').replace(/\/mcp\/?$/, '');
}

/**
 * The counts from the endpoint's /stats.json, which answers only this repository's
 * stats workflow on main, proven by the run's GitHub OIDC token. No secret is involved.
 */
async function mcpDaysFromEndpoint(days: number): Promise<{ date: string; counts: Record<string, number> }[]> {
  const idRes = await fetch(`${env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=research-methods-stats`, {
    headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!idRes.ok) throw new Error(`GitHub OIDC token request failed: ${idRes.status}`);
  const { value } = (await idRes.json()) as { value: string };
  const res = await fetch(`${endpointOrigin()}/stats.json?days=${days}`, { headers: { authorization: `Bearer ${value}` } });
  if (!res.ok) throw new Error(`/stats.json responded ${res.status}`);
  return res.json() as Promise<{ date: string; counts: Record<string, number> }[]>;
}

async function mcpDays(dates: string[]): Promise<{ date: string; counts: Record<string, number> }[]> {
  if (!env.UPSTASH_REDIS_REST_READONLY_TOKEN) return mcpDaysFromEndpoint(dates.length);
  const url = env.UPSTASH_REDIS_REST_URL!.replace(/\/+$/, '');
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.UPSTASH_REDIS_REST_READONLY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(dates.map((d) => ['HGETALL', `usage:${d}`])),
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const replies = (await res.json()) as { result?: string[] }[];
  return dates.map((date, i) => {
    const flat = replies[i]?.result ?? [];
    const counts: Record<string, number> = {};
    for (let j = 0; j + 1 < flat.length; j += 2) counts[flat[j]] = Number(flat[j + 1]);
    return { date, counts };
  });
}

export function mcpRows(days: { date: string; counts: Record<string, number> }[]) {
  const daily: Row[] = [];
  const clients: Row[] = [];
  for (const { date, counts } of days) {
    if (!Object.keys(counts).length) continue;
    let app = 0;
    let bot = 0;
    for (const [field, n] of Object.entries(counts)) {
      if (!field.startsWith('client:')) continue;
      const name = field.slice(7);
      const kind = clientKind(name);
      kind === 'app' ? (app += n) : (bot += n);
      clients.push([date, name, kind, n]);
    }
    const prompts = Object.entries(counts)
      .filter(([k]) => k.startsWith('prompt:'))
      .reduce((s, [, n]) => s + n, 0);
    daily.push([
      date,
      counts.connect ?? 0,
      app,
      bot,
      counts.calls ?? 0,
      ...TOOLS.map((t) => counts[`tool:${t}`] ?? 0),
      prompts,
      counts['resource:read'] ?? 0,
    ]);
  }
  return { daily, clients };
}

/** What this run wrote, for the summary tab. */
const written: { mcp?: Row[]; books?: Row[]; github?: Row[]; githubHistory?: Row[]; geo?: Row[]; sources?: Row[] } = {};

async function syncMcp(sheet: Sheet) {
  const stored = await sheet.read('mcp_daily');
  const dates = lastDays(stored.length ? RECENT_DAYS : BACKFILL_DAYS);
  const { daily, clients } = mcpRows(await mcpDays(dates));
  const fresh = new Set(dates);
  written.mcp = merge(stored, daily, fresh);
  await sheet.write(
    'mcp_daily',
    ['date', 'connections', 'app_connections', 'bot_connections', 'tool_calls', ...TOOLS.map((t) => `tool_${t}`), 'prompts', 'resource_reads'],
    written.mcp,
  );
  await sheet.write('mcp_clients', ['date', 'client', 'kind', 'connections'], merge(await sheet.read('mcp_clients'), clients, fresh));
}

// ---------------------------------------------------------------- Book sites (GA4)

interface GaReport {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

async function syncBooks(sheet: Sheet, token: string) {
  const stored = await sheet.read('books_daily');
  const n = stored.length ? RECENT_DAYS : BACKFILL_DAYS;
  const dates = lastDays(n);
  const rows: Row[] = [];
  const failed: string[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      const r = await google<GaReport>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: JSON.stringify({
          dateRanges: [{ startDate: `${n - 1}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
          limit: 1000,
        }),
      });
      for (const row of r.rows ?? []) {
        const d = row.dimensionValues[0].value;
        rows.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, book, ...row.metricValues.map((m) => Number(m.value))]);
      }
    } catch (e) {
      failed.push(`${book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // A property that failed keeps its stored rows rather than losing the re-read days.
  const failedBooks = new Set(failed.map((f) => f.split(':')[0]));
  const fresh = new Set(dates);
  const kept = stored.filter((r) => !fresh.has(String(r[0])) || failedBooks.has(String(r[1])));
  const merged = [...kept, ...rows].sort(
    (a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])),
  );
  written.books = merged;
  await sheet.write('books_daily', ['date', 'book', 'active_users', 'new_users', 'sessions', 'views'], merged);
  if (failed.length) throw new Error(`Google Analytics failed for ${failed.length} properties:\n${failed.join('\n')}`);
}

/**
 * Where book-site sessions come from (google / organic, chatgpt.com / referral, ...), per
 * day and book, so marketing experiments can be read off the dashboard.
 */
async function syncBookSources(sheet: Sheet, token: string) {
  const stored = await sheet.read('books_sources');
  const n = stored.length ? RECENT_DAYS : GEO_DAYS;
  const dates = new Set(lastDays(n));
  const oldest = lastDays(GEO_DAYS).at(-1)!;
  const rows: Row[] = [];
  const failed: string[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      const r = await google<GaReport>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: JSON.stringify({
          dateRanges: [{ startDate: `${n - 1}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
          limit: 100000,
        }),
      });
      for (const row of r.rows ?? []) {
        const [d, source, medium, channel] = row.dimensionValues.map((v) => v.value);
        const [sessions, users, views] = row.metricValues.map((m) => Number(m.value));
        if (!sessions && !views) continue;
        rows.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, book, channel, source, medium, sessions, users, views]);
      }
    } catch (e) {
      failed.push(`${book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const failedBooks = new Set(failed.map((f) => f.split(':')[0]));
  const kept = stored.filter((r) => String(r[0]) >= oldest && (!dates.has(String(r[0])) || failedBooks.has(String(r[1]))));
  const merged = [...kept, ...rows].sort(
    (a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])) || Number(b[5]) - Number(a[5]),
  );
  written.sources = merged;
  await sheet.write('books_sources', ['date', 'book', 'channel', 'source', 'medium', 'sessions', 'active_users', 'views'], merged);
  if (failed.length) throw new Error(`Google Analytics (sources) failed for ${failed.length} properties:\n${failed.join('\n')}`);
}

/** Days of location history kept; daily rows per book, country, and region add up fast. */
const GEO_DAYS = 120;

/** The dashboard's three markets. */
export function market(country: string): string {
  return country === 'United States' ? 'United States' : country === 'Vietnam' ? 'Vietnam' : 'Rest of world';
}

/**
 * Book-site visitors by country and region (US state, Vietnamese province, ...) per day,
 * as Google Analytics reports them. GA derives location from the visitor's IP address;
 * only these aggregates reach the sheet.
 */
async function syncBooksGeo(sheet: Sheet, token: string) {
  const stored = await sheet.read('books_geo');
  const n = stored.length ? RECENT_DAYS : GEO_DAYS;
  const dates = new Set(lastDays(n));
  const oldest = lastDays(GEO_DAYS).at(-1)!;
  const rows: Row[] = [];
  const failed: string[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      const r = await google<GaReport>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: JSON.stringify({
          dateRanges: [{ startDate: `${n - 1}daysAgo`, endDate: 'today' }],
          dimensions: [{ name: 'date' }, { name: 'country' }, { name: 'region' }],
          metrics: [{ name: 'activeUsers' }, { name: 'screenPageViews' }],
          limit: 100000,
        }),
      });
      for (const row of r.rows ?? []) {
        const [d, country, region] = row.dimensionValues.map((v) => v.value);
        const [users, views] = row.metricValues.map((m) => Number(m.value));
        if (!users && !views) continue;
        rows.push([`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, book, market(country), country, region, users, views]);
      }
    } catch (e) {
      failed.push(`${book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const failedBooks = new Set(failed.map((f) => f.split(':')[0]));
  const kept = stored.filter((r) => String(r[0]) >= oldest && (!dates.has(String(r[0])) || failedBooks.has(String(r[1]))));
  const merged = [...kept, ...rows].sort(
    (a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])) || Number(b[6]) - Number(a[6]),
  );
  written.geo = merged;
  await sheet.write('books_geo', ['date', 'book', 'market', 'country', 'region', 'active_users', 'views'], merged);
  if (failed.length) throw new Error(`Google Analytics (locations) failed for ${failed.length} properties:\n${failed.join('\n')}`);
}

// ---------------------------------------------------------------- GitHub

function githubRepos(): string[] {
  const yml = readFileSync(new URL('../sources.yml', import.meta.url), 'utf8');
  const repos = [...yml.matchAll(/^\s*github:\s*https:\/\/github\.com\/([\w.-]+\/[\w.-]+)/gm)].map((m) => m[1]);
  return ['mikenguyen13/research-methods-mcp', ...new Set(repos)];
}

async function syncGithub(sheet: Sheet) {
  const today = iso(new Date());
  const rows: Row[] = [];
  for (const repo of githubRepos()) {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'research-methods-stats',
        ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub ${repo}: ${res.status}`);
    const j = (await res.json()) as { stargazers_count: number; forks_count: number; subscribers_count: number };
    rows.push([today, repo.split('/')[1], j.stargazers_count, j.forks_count, j.subscribers_count]);
  }
  written.github = rows;
  written.githubHistory = merge(await sheet.read('github_daily'), rows, new Set([today]));
  await sheet.write('github_daily', ['date', 'repository', 'stars', 'forks', 'watchers'], written.githubHistory);
  // One row per repository, so a dashboard table needs no aggregation choice.
  await sheet.write(
    'github_latest',
    ['repository', 'stars', 'forks', 'watchers'],
    rows.map((r) => r.slice(1)).sort((a, b) => Number(b[1]) - Number(a[1]) || Number(b[2]) - Number(a[2])),
  );
}

/**
 * Headline numbers over complete days (yesterday and before): the last 7 days, the 7
 * before them, the change, and the last 28 days. Precomputed so the dashboard can show
 * them as a plain table.
 */
export function summaryRows(w: typeof written, now = new Date()): Row[] {
  const days = lastDays(29, now).slice(1); // yesterday first
  const last7 = new Set(days.slice(0, 7));
  const prev7 = new Set(days.slice(7, 14));
  const last28 = new Set(days);
  const sum = (rows: Row[] | undefined, col: number, set: Set<string>, keep: (r: Row) => boolean = () => true) =>
    (rows ?? []).filter((r) => set.has(String(r[0])) && keep(r)).reduce((t, r) => t + (Number(r[col]) || 0), 0);
  const line = (metric: string, rows: Row[] | undefined, col: number, keep?: (r: Row) => boolean): Row => {
    const a = sum(rows, col, last7, keep);
    const b = sum(rows, col, prev7, keep);
    return [metric, a, b, b ? Math.round(((a - b) / b) * 100) : '', sum(rows, col, last28, keep)];
  };
  const out: Row[] = [];
  if (w.mcp) {
    out.push(line('MCP tool calls', w.mcp, 4), line('MCP connections from AI apps', w.mcp, 2), line('MCP connections from bots', w.mcp, 3));
  }
  if (w.books) {
    out.push(line('Book views (all books)', w.books, 5), line('Book sessions (all books)', w.books, 4));
    const books = [...new Set(w.books.map((r) => String(r[1])))];
    const perBook = books.map((b) => line(`Views: ${b}`, w.books, 5, (r) => r[1] === b)).filter((r) => Number(r[4]) > 0);
    out.push(...perBook.sort((x, y) => Number(y[4]) - Number(x[4])));
  }
  if (w.geo) {
    for (const m of ['United States', 'Vietnam', 'Rest of world']) out.push(line(`Book views: ${m}`, w.geo, 6, (r) => r[2] === m));
  }
  if (w.sources) {
    const ai = /chatgpt|openai|claude|anthropic|perplexity|gemini|copilot|bard|deepseek|you.com|phind/i;
    out.push(line('Book sessions from AI assistants', w.sources, 5, (r) => ai.test(String(r[3]))));
    out.push(line('Book sessions from search engines', w.sources, 5, (r) => r[2] === 'Organic Search'));
  }
  if (w.github) {
    const total = (rows: Row[]) => rows.reduce((t, r) => t + Number(r[2]), 0);
    const weekAgo = (w.githubHistory ?? []).filter((r) => r[0] === days[6]);
    out.push(['GitHub stars (all repositories)', total(w.github), weekAgo.length ? total(weekAgo) : '', '', total(w.github)]);
  }
  return out;
}

// ---------------------------------------------------------------- main

export async function main() {
  if (!env.STATS_SHEET_ID || !(env.GOOGLE_ACCESS_TOKEN || env.GOOGLE_SERVICE_ACCOUNT_KEY)) {
    console.log('STATS_SHEET_ID or Google credentials are not set; nothing to do (see docs/DASHBOARD.md).');
    return;
  }
  const token =
    env.GOOGLE_ACCESS_TOKEN ||
    (await googleToken(JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY!) as ServiceAccount, [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/analytics.readonly',
    ]));
  const sheet = new Sheet(token, env.STATS_SHEET_ID);
  await sheet.init();

  const errors: string[] = [];
  const run = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  };
  if ((env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_READONLY_TOKEN) || env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    await run('MCP usage', () => syncMcp(sheet));
  } else console.log('No Upstash token and no GitHub OIDC token; skipping MCP usage.');
  await run('Book sites', () => syncBooks(sheet, token));
  await run('Book-site locations', () => syncBooksGeo(sheet, token));
  await run('Book-site traffic sources', () => syncBookSources(sheet, token));
  await run('GitHub', () => syncGithub(sheet));
  // `order` lets a dashboard table keep this row order (sort by it ascending).
  await sheet.write(
    'summary',
    ['metric', 'last_7_days', 'previous_7_days', 'change_pct', 'last_28_days', 'order'],
    summaryRows(written).map((r, i) => [...r, i + 1]),
  );
  await sheet.write('updated', ['last_updated_utc'], [[new Date().toISOString().replace('T', ' ').slice(0, 16)]]);

  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  }
}

if (/sync-stats\.ts$/.test(process.argv[1] ?? '')) await main();
