// Copies usage numbers into a private Google Sheet that a Looker Studio report reads,
// so every number can be seen on one page without a running computer. Run hourly by
// .github/workflows/stats.yml; see docs/DASHBOARD.md for the one-time setup.
//
// Sources, each skipped when its credentials are missing:
//   - MCP endpoint: the anonymous daily counters in Upstash Redis (usage:YYYY-MM-DD).
//   - Book sites: Google Analytics 4, through the Analytics Data API, and Google Search
//     Console for every property shared with the service account.
//   - GitHub: stars, forks, and watchers of this repository and each book repository.
//   - ORCID, OpenAlex, and Crossref (public, no key): published volumes and citations, once a day.
//
// The repository is public, so this script never prints a count: Action logs only
// show which tabs were written and how many rows they hold. The one public number file,
// stats/bio.json, holds round milestones (500,000 readers, 200 countries) for the bio
// page, and the workflow commits it only when a milestone changes.
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
import { readFileSync, writeFileSync } from 'node:fs';

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
/** Columns of the hand-kept experiment log (one row per experiment in the growth plan). */
const EXPERIMENTS_HEADER = ['id', 'channel', 'change', 'metric', 'start', 'end', 'baseline', 'target', 'result', 'decision'];
interface PlannedExperiment {
  id: string;
  priority: number;
  channel: string;
  change: string;
  metric: string;
  start: string;
  end: string;
  baseline: string;
  target: string;
  result: string;
  decision: string;
}

/**
 * The experiment log is kept by hand in the sheet (results and decisions are typed in
 * there). While the tab is empty it is seeded from `scripts/experiments.json`, the
 * experiments of the growth plan; once it has rows the sync never touches it.
 */
export async function seedExperiments(sheet: Pick<Sheet, 'create' | 'read' | 'write'>) {
  await sheet.create('experiments', EXPERIMENTS_HEADER);
  if ((await sheet.read('experiments')).length) return;
  const planned = JSON.parse(readFileSync(new URL('./experiments.json', import.meta.url), 'utf8')) as PlannedExperiment[];
  await sheet.write(
    'experiments',
    EXPERIMENTS_HEADER,
    // Free text such as "+25%" or "+1 percentage point" would be parsed as a number or a
    // formula (USER_ENTERED); a leading apostrophe keeps it as text.
    planned.map((e) =>
      [e.id, `${e.channel} (P${e.priority})`, e.change, e.metric, e.start, e.end, e.baseline, e.target, e.result, e.decision].map((v) =>
        /^[+=\-@]/.test(v) ? `'${v}` : v,
      ),
    ),
  );
}

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

  /** Creates a tab with only a header when it does not exist; an existing tab is left alone. */
  async create(tab: string, header: string[]) {
    if (this.tabs.has(tab)) return;
    await this.ensure(tab);
    await google(this.token, `${this.base}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [header] }),
    });
    console.log(`created ${tab}`);
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

/**
 * One row per key (the first `keyCols` columns: date, book, and any breakdown). When a key
 * repeats, the row with the larger metric total wins (Google Analytics only adds to a day's
 * numbers as it processes late hits), and on a tie the later row, so fresh rows beat stored
 * ones. Removes duplicates an earlier run wrote, and keeps new ones from piling up.
 */
export function dedupe(rows: Row[], keyCols: number): Row[] {
  const total = (r: Row) => r.slice(keyCols).reduce<number>((t, v) => t + (Number(v) || 0), 0);
  const byKey = new Map<string, Row>();
  for (const r of rows) {
    const key = JSON.stringify(r.slice(0, keyCols));
    const had = byKey.get(key);
    if (!had || total(r) >= total(had)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

/**
 * Google Analytics reads dates in each property's own time zone, while the dates a run
 * re-reads (lastDays) are UTC. Asking for those exact calendar dates, rather than
 * "NdaysAgo" to "today" in the property's zone, keeps the two lists the same, so every day
 * a run reads replaces its stored rows instead of being added a second time.
 */
const gaRange = (dates: string[]) => ({ startDate: dates.at(-1)!, endDate: dates[0] });

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
  const sources: Row[] = [];
  for (const { date, counts } of days) {
    if (!Object.keys(counts).length) continue;
    // ?src= labels on the /mcp URL (src/usage.ts): connections and tool calls per label.
    const labels = new Set(Object.keys(counts).flatMap((k) => (k.startsWith('src:') ? [k.slice(4)] : k.startsWith('src_calls:') ? [k.slice(10)] : [])));
    for (const label of [...labels].sort()) sources.push([date, label, counts[`src:${label}`] ?? 0, counts[`src_calls:${label}`] ?? 0]);
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
  return { daily, clients, sources };
}

/** What this run wrote, for the summary tab. */
const written: {
  mcp?: Row[];
  mcpSrc?: Row[];
  clients?: Row[];
  books?: Row[];
  github?: Row[];
  githubHistory?: Row[];
  geo?: Row[];
  sources?: Row[];
  campaigns?: Row[];
  gsc?: Row[];
} = {};

async function syncMcp(sheet: Sheet) {
  const stored = await sheet.read('mcp_daily');
  const dates = lastDays(stored.length ? RECENT_DAYS : BACKFILL_DAYS);
  const { daily, clients, sources } = mcpRows(await mcpDays(dates));
  const fresh = new Set(dates);
  written.mcp = merge(stored, daily, fresh);
  await sheet.write(
    'mcp_daily',
    ['date', 'connections', 'app_connections', 'bot_connections', 'tool_calls', ...TOOLS.map((t) => `tool_${t}`), 'prompts', 'resource_reads'],
    written.mcp,
  );
  written.clients = merge(await sheet.read('mcp_clients'), clients, fresh);
  await sheet.write('mcp_clients', ['date', 'client', 'kind', 'connections'], written.clients);
  written.mcpSrc = merge(await sheet.read('mcp_src'), sources, fresh);
  await sheet.write('mcp_src', ['date', 'src', 'connections', 'tool_calls'], written.mcpSrc);
}

// ---------------------------------------------------------------- Book sites (GA4)

interface GaReport {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

/** Whether a tab already has every column of `header`; if not, it is re-read in full. */
const current = (stored: Row[], header: string[]) => stored.length > 0 && stored[0].length >= header.length;

const BOOKS_DAILY = ['date', 'book', 'active_users', 'new_users', 'sessions', 'views', 'engaged_sessions'];

async function syncBooks(sheet: Sheet, token: string) {
  const stored = await sheet.read('books_daily');
  // A tab written before a column was added is backfilled once, so the new column has history.
  const n = current(stored, BOOKS_DAILY) ? RECENT_DAYS : BACKFILL_DAYS;
  const dates = lastDays(n);
  const rows: Row[] = [];
  const failed: string[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      const r = await google<GaReport>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: JSON.stringify({
          dateRanges: [gaRange(dates)],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }, { name: 'newUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }, { name: 'engagedSessions' }],
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
  const merged = dedupe([...kept, ...rows], 2).sort(
    (a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])),
  );
  written.books = merged;
  await sheet.write('books_daily', BOOKS_DAILY, merged);
  if (failed.length) throw new Error(`Google Analytics failed for ${failed.length} properties:\n${failed.join('\n')}`);
}

/** Days of detail kept in the per-source, per-location, and per-campaign tabs; their rows add up fast. */
const DETAIL_DAYS = 120;

/** The dashboard's three markets. */
export function market(country: string): string {
  return country === 'United States' ? 'United States' : country === 'Vietnam' ? 'Vietnam' : 'Rest of world';
}

/** Campaign names Google Analytics fills in itself; anything else came from a utm_campaign tag. */
const UNTAGGED_CAMPAIGNS = ['(not set)', '(organic)', '(referral)', '(direct)', '(none)', '(data not available)', '(cross-network)', ''];

interface GaTab {
  tab: string;
  label: string;
  header: string[];
  /** Report dimensions after `date`. */
  dimensions: string[];
  metrics: string[];
  dimensionFilter?: unknown;
  /** The sheet row for one report row, or null to drop it. */
  row: (date: string, book: string, dims: string[], mets: number[]) => Row | null;
  /** Column sorted largest first within a date and book. */
  sortCol: number;
}

/**
 * One daily Google Analytics tab with a breakdown (source, location, campaign) for every
 * book site, keeping DETAIL_DAYS of history. A property that fails keeps its stored rows.
 */
async function syncGaTab(sheet: Sheet, token: string, spec: GaTab): Promise<Row[]> {
  const stored = await sheet.read(spec.tab);
  const n = current(stored, spec.header) ? RECENT_DAYS : DETAIL_DAYS;
  const dateList = lastDays(n);
  const dates = new Set(dateList);
  const oldest = lastDays(DETAIL_DAYS).at(-1)!;
  const rows: Row[] = [];
  const failed: string[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      const r = await google<GaReport>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
        method: 'POST',
        body: JSON.stringify({
          dateRanges: [gaRange(dateList)],
          dimensions: ['date', ...spec.dimensions].map((name) => ({ name })),
          metrics: spec.metrics.map((name) => ({ name })),
          ...(spec.dimensionFilter ? { dimensionFilter: spec.dimensionFilter } : {}),
          limit: 100000,
        }),
      });
      for (const row of r.rows ?? []) {
        const [d, ...dims] = row.dimensionValues.map((v) => v.value);
        const out = spec.row(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, book, dims, row.metricValues.map((m) => Number(m.value)));
        if (out) rows.push(out);
      }
    } catch (e) {
      failed.push(`${book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const failedBooks = new Set(failed.map((f) => f.split(':')[0]));
  const kept = stored.filter((r) => String(r[0]) >= oldest && (!dates.has(String(r[0])) || failedBooks.has(String(r[1]))));
  // The columns before the metrics (date, book, breakdown) identify a row.
  const merged = dedupe([...kept, ...rows], spec.header.length - spec.metrics.length).sort(
    (a, b) =>
      String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])) || Number(b[spec.sortCol]) - Number(a[spec.sortCol]),
  );
  await sheet.write(spec.tab, spec.header, merged);
  if (failed.length) throw new Error(`Google Analytics (${spec.label}) failed for ${failed.length} properties:\n${failed.join('\n')}`);
  return merged;
}

/**
 * Where book-site sessions come from (google / organic, chatgpt.com / referral, ...), per
 * day and book, so marketing experiments can be read off the dashboard.
 */
async function syncBookSources(sheet: Sheet, token: string) {
  written.sources = await syncGaTab(sheet, token, {
    tab: 'books_sources',
    label: 'sources',
    header: ['date', 'book', 'channel', 'source', 'medium', 'sessions', 'active_users', 'views', 'engaged_sessions'],
    dimensions: ['sessionDefaultChannelGroup', 'sessionSource', 'sessionMedium'],
    metrics: ['sessions', 'activeUsers', 'screenPageViews', 'engagedSessions'],
    row: (date, book, [channel, source, medium], [sessions, users, views, engaged]) =>
      sessions || views ? [date, book, channel, source, medium, sessions, users, views, engaged] : null,
    sortCol: 5,
  });
}

/**
 * Book-site visitors by country and region (US state, Vietnamese province, ...) per day,
 * as Google Analytics reports them. GA derives location from the visitor's IP address;
 * only these aggregates reach the sheet.
 */
async function syncBooksGeo(sheet: Sheet, token: string) {
  written.geo = await syncGaTab(sheet, token, {
    tab: 'books_geo',
    label: 'locations',
    header: ['date', 'book', 'market', 'country', 'region', 'active_users', 'views', 'engaged_sessions'],
    dimensions: ['country', 'region'],
    metrics: ['activeUsers', 'screenPageViews', 'engagedSessions'],
    row: (date, book, [country, region], [users, views, engaged]) =>
      users || views ? [date, book, market(country), country, region, users, views, engaged] : null,
    sortCol: 6,
  });
}

/**
 * Sessions from links carrying utm_campaign (see "Source labels" in docs/LISTING.md), per
 * day, book, and campaign, so each experiment's posts and links can be counted.
 */
async function syncBookCampaigns(sheet: Sheet, token: string) {
  written.campaigns = await syncGaTab(sheet, token, {
    tab: 'books_campaigns',
    label: 'campaigns',
    header: ['date', 'book', 'campaign', 'source', 'medium', 'sessions', 'engaged_sessions', 'views'],
    dimensions: ['sessionCampaignName', 'sessionSource', 'sessionMedium'],
    metrics: ['sessions', 'engagedSessions', 'screenPageViews'],
    dimensionFilter: {
      notExpression: { filter: { fieldName: 'sessionCampaignName', inListFilter: { values: UNTAGGED_CAMPAIGNS } } },
    },
    row: (date, book, [campaign, source, medium], [sessions, engaged, views]) =>
      sessions || views ? [date, book, campaign, source, medium, sessions, engaged, views] : null,
    sortCol: 5,
  });
}

// ---------------------------------------------------------------- Search Console

const SEARCH_CONSOLE = 'https://searchconsole.googleapis.com/webmasters/v3';
/** Search Console finalises a day's numbers after two to three days. */
const GSC_RECENT_DAYS = 5;

/** Each book's site from sources.yml, plus the MCP endpoint's own pages. */
export function bookSites(yml = readFileSync(new URL('../sources.yml', import.meta.url), 'utf8')): { book: string; site: string }[] {
  const sites = yml
    .split(/^\s*- id:\s*/m)
    .slice(1)
    .flatMap((block) => {
      const book = block.match(/^([\w-]+)/)?.[1];
      const site = block.match(/^\s*site:\s*(\S+)/m)?.[1];
      return book && site ? [{ book, site }] : [];
    });
  return [...sites, { book: 'mcp_site', site: `${endpointOrigin()}/` }];
}

/**
 * The Search Console property that covers a site: the longest URL-prefix property that
 * the site starts with, else a domain property (sc-domain:) for its host.
 */
export function coveringProperty(site: string, properties: string[]): string | undefined {
  const host = new URL(site).hostname;
  const prefix = properties.filter((p) => !p.startsWith('sc-domain:') && site.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  return prefix ?? properties.find((p) => p.startsWith('sc-domain:') && (host === p.slice(10) || host.endsWith(`.${p.slice(10)}`)));
}

interface GscReport {
  rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
}

/**
 * Google Search clicks, impressions, click-through, and average position per day and
 * book, plus each book's top queries and pages over the last 28 days. Reads every
 * property shared with the service account; skipped until Search Console is set up.
 */
async function syncSearchConsole(sheet: Sheet, token: string) {
  let properties: string[];
  try {
    const r = await google<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(token, `${SEARCH_CONSOLE}/sites`);
    properties = (r.siteEntry ?? []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => s.siteUrl);
  } catch (e) {
    // 403: the API is not enabled or the token lacks the scope (docs/DASHBOARD.md, step 8).
    if (/failed: 403/.test((e as Error).message)) return console.log('Search Console is not set up; skipping.');
    throw e;
  }
  const books = bookSites()
    .map((b) => ({ ...b, property: coveringProperty(b.site, properties) }))
    .filter((b): b is { book: string; site: string; property: string } => !!b.property);
  if (!books.length) return console.log('No Search Console property covers a book site; skipping.');

  const stored = await sheet.read('gsc_daily');
  const n = stored.length ? GSC_RECENT_DAYS : BACKFILL_DAYS;
  const dates = new Set(lastDays(n));
  const query = (b: { site: string; property: string }, body: Record<string, unknown>) =>
    google<GscReport>(token, `${SEARCH_CONSOLE}/sites/${encodeURIComponent(b.property)}/searchAnalytics/query`, {
      method: 'POST',
      body: JSON.stringify({
        ...body,
        dataState: 'all',
        // A property shared by several books (a github.io user site) is split by page URL.
        ...(b.property === b.site ? {} : { dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: b.site }] }] }),
      }),
    });
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  const daily: Row[] = [];
  const top: Row[] = [];
  const failed: string[] = [];
  for (const b of books) {
    try {
      const r = await query(b, { startDate: lastDays(n).at(-1), endDate: iso(new Date()), dimensions: ['date'], rowLimit: 25000 });
      for (const x of r.rows ?? []) daily.push([x.keys[0], b.book, x.clicks, x.impressions, round(x.ctr, 4), round(x.position, 1)]);
      for (const kind of ['query', 'page']) {
        const t = await query(b, { startDate: lastDays(29).at(-1), endDate: lastDays(2).at(-1), dimensions: [kind], rowLimit: 50 });
        for (const x of t.rows ?? []) top.push([kind, b.book, x.keys[0], x.clicks, x.impressions, round(x.ctr, 4), round(x.position, 1)]);
      }
    } catch (e) {
      failed.push(`${b.book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const failedBooks = new Set(failed.map((f) => f.split(':')[0]));
  const kept = stored.filter((r) => !dates.has(String(r[0])) || failedBooks.has(String(r[1])));
  written.gsc = [...kept, ...daily].sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])));
  await sheet.write('gsc_daily', ['date', 'book', 'clicks', 'impressions', 'ctr', 'position'], written.gsc);
  if (top.length || !failed.length) {
    await sheet.write('gsc_top', ['kind', 'book', 'key', 'clicks', 'impressions', 'ctr', 'position'], top.sort((a, b) => Number(b[3]) - Number(a[3])));
  }
  if (failed.length) throw new Error(`Search Console failed for ${failed.length} sites:\n${failed.join('\n')}`);
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

// ---------------------------------------------------------------- Bio numbers

/**
 * The numbers worth quoting in a bio, refreshed once a day: readers and countries over
 * each book site's whole Google Analytics history, the published volumes and their
 * citations (from the ORCID record and OpenAlex), and GitHub stars. `bio_daily` keeps one
 * row per day so their growth can be watched.
 */
const ORCID = '0000-0002-3432-8595';
/** Google Analytics 4 accepts no start date earlier than this; it means "since the property began". */
const GA_EPOCH = '2015-08-14';

export interface OrcidWork {
  type: string;
  title: string;
  doi: string;
  year: string;
}

/** Works with a DOI from ORCID's public works list (one summary per group). */
export function orcidWorks(record: any): OrcidWork[] {
  return (record?.group ?? []).flatMap((g: any) => {
    const w = g['work-summary']?.[0];
    const doi = (g['external-ids']?.['external-id'] ?? []).find((x: any) => x['external-id-type'] === 'doi')?.['external-id-value'];
    return w && doi
      ? [{ type: String(w.type), title: String(w.title?.title?.value ?? ''), doi: String(doi).toLowerCase(), year: String(w['publication-date']?.year?.value ?? '') }]
      : [];
  });
}

/** Volumes of the Springer series: books (not chapters) with a Springer DOI (prefix 10.1007). */
export const seriesVolumes = (works: OrcidWork[]) => works.filter((w) => w.type === 'book' && w.doi.startsWith('10.1007/'));

/** A count from a JSON API, or undefined when the work is not indexed there (404). */
async function countFrom(url: string, pick: (j: any) => number): Promise<number | undefined> {
  const res = await fetch(url, { headers: { 'user-agent': 'research-methods-stats' } });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${new URL(url).host}: ${res.status}`);
  return pick(await res.json());
}

/**
 * Citations of each work by DOI, from OpenAlex and Crossref; each misses some, so the
 * larger is kept. (OpenAlex's DOI filter misses recent books, so each DOI is looked up
 * directly.) Google Scholar has no API and usually counts more, since it also finds
 * citations of the open web books, which have no DOI: this is a floor that moves the
 * same way, and Scholar is checked by hand.
 */
export async function workCitations(works: OrcidWork[]): Promise<Map<string, { openalex?: number; crossref?: number }>> {
  const out = new Map<string, { openalex?: number; crossref?: number }>();
  for (const w of works) {
    const openalex = await countFrom(`https://api.openalex.org/works/doi:${w.doi}?select=cited_by_count`, (j) => j.cited_by_count);
    // Crossref holds only DOIs it registered (not Zenodo's DataCite ones), hence the 404s.
    const crossref = w.doi.startsWith('10.5281/')
      ? undefined
      : await countFrom(`https://api.crossref.org/works/${w.doi}`, (j) => j.message['is-referenced-by-count']);
    out.set(w.doi, { openalex, crossref });
  }
  return out;
}

export const bestCount = (c: { openalex?: number; crossref?: number } | undefined) => Math.max(c?.openalex ?? 0, c?.crossref ?? 0);

interface Reach {
  book: string;
  readers: number;
  views: number;
  engaged: number;
  since: string;
  /** Countries with at least one engaged session (automated one-page visits are not). */
  countries: Set<string>;
}

/** All-time readers, views, engaged sessions, first month, and countries of one GA property. */
async function lifetimeReach(token: string, id: string, book: string): Promise<Reach> {
  const dateRanges = [{ startDate: GA_EPOCH, endDate: 'today' }];
  const r = await google<{ reports: GaReport[] }>(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:batchRunReports`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        { dateRanges, metrics: [{ name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'engagedSessions' }] },
        { dateRanges, dimensions: [{ name: 'yearMonth' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'yearMonth' } }], limit: 1 },
        { dateRanges, dimensions: [{ name: 'country' }], metrics: [{ name: 'engagedSessions' }], limit: 1000 },
      ],
    }),
  });
  const [totals, first, geo] = r.reports;
  const m = totals.rows?.[0]?.metricValues.map((v) => Number(v.value)) ?? [0, 0, 0];
  const ym = first.rows?.[0]?.dimensionValues[0].value ?? '';
  const countries = new Set(
    (geo.rows ?? []).filter((x) => Number(x.metricValues[0].value) > 0 && x.dimensionValues[0].value !== '(not set)').map((x) => x.dimensionValues[0].value),
  );
  return { book, readers: m[0], views: m[1], engaged: m[2], since: ym ? `${ym.slice(0, 4)}-${ym.slice(4)}` : '', countries };
}

/** The `reach` tab: one row per book, largest first, and an "All books" row on top. */
export function reachRows(list: Reach[]): Row[] {
  const all = new Set(list.flatMap((r) => [...r.countries]));
  const sum = (k: 'readers' | 'views' | 'engaged') => list.reduce((t, r) => t + r[k], 0);
  const since = list.map((r) => r.since).filter(Boolean).sort()[0] ?? '';
  return [
    ['All books', sum('readers'), sum('views'), sum('engaged'), all.size, since],
    ...list
      .filter((r) => r.readers || r.views)
      .sort((a, b) => b.readers - a.readers)
      .map((r) => [r.book, r.readers, r.views, r.engaged, r.countries.size, r.since]),
  ];
}

/**
 * The public bio numbers, rounded down to a milestone so they read as "more than" and the
 * file changes only a few times a year: readers and views to the leading digit's place
 * (529,152 is 500,000; 1,076,993 is 1,000,000), countries to the 50 below (218 is 200).
 */
export function bioMilestones(readers: number, views: number, countries: number) {
  const lead = (n: number) => {
    const step = n >= 10 ? 10 ** Math.floor(Math.log10(n)) : 1;
    return Math.floor(n / step) * step;
  };
  return { readers: lead(readers), views: lead(views), countries: Math.floor(countries / 50) * 50 };
}

const BIO_DAILY = ['date', 'series_volumes', 'citations', 'readers_all_books', 'countries', 'engaged_sessions_all_time', 'github_stars'];

async function syncBio(sheet: Sheet, token: string) {
  const today = iso(new Date());
  const stored = await sheet.read('bio_daily');
  // Once a day is enough, and all-time Analytics reports cost more quota than daily ones.
  if (stored.some((r) => r[0] === today)) return;

  const errors: string[] = [];
  let works: OrcidWork[] = [];
  let cites = 0;
  try {
    const res = await fetch(`https://pub.orcid.org/v3.0/${ORCID}/works`, { headers: { accept: 'application/json', 'user-agent': 'research-methods-stats' } });
    if (!res.ok) throw new Error(`ORCID: ${res.status}`);
    works = orcidWorks(await res.json());
    const counts = await workCitations(works);
    cites = works.reduce((t, w) => t + bestCount(counts.get(w.doi)), 0);
    const blank = (n: number | undefined) => n ?? '';
    await sheet.write(
      'citations',
      ['title', 'type', 'year', 'doi', 'citations', 'openalex', 'crossref', 'series_volume'],
      works
        .map((w) => {
          const c = counts.get(w.doi);
          return [w.title, w.type, w.year, w.doi, bestCount(c), blank(c?.openalex), blank(c?.crossref), seriesVolumes([w]).length ? 'yes' : ''] as Row;
        })
        .sort((a, b) => Number(b[4]) - Number(a[4]) || String(a[0]).localeCompare(String(b[0]))),
    );
  } catch (e) {
    errors.push((e as Error).message.slice(0, 200));
  }

  const reach: Reach[] = [];
  for (const [id, book] of Object.entries(GA_PROPERTIES)) {
    try {
      reach.push(await lifetimeReach(token, id, book));
    } catch (e) {
      errors.push(`${book}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const rows = reachRows(reach);
  // A partial read would understate the totals, so the tab and the history wait for a full one.
  if (reach.length === Object.keys(GA_PROPERTIES).length) {
    await sheet.write('reach', ['book', 'readers', 'views', 'engaged_sessions', 'countries', 'since'], rows);
    const [, readers, views, , countries] = rows[0];
    const bio = bioMilestones(Number(readers), Number(views), Number(countries));
    writeFileSync(new URL('../stats/bio.json', import.meta.url), `${JSON.stringify(bio, null, 2)}
`);
  }

  if (!errors.length) {
    const stars = (written.github ?? []).reduce((t, r) => t + Number(r[2]), 0);
    const [, readers, , engaged, countries] = rows[0];
    const row: Row = [today, seriesVolumes(works).length, cites, readers, countries, engaged, written.github ? stars : ''];
    await sheet.write('bio_daily', BIO_DAILY, merge(stored, [row], new Set([today])));
  } else throw new Error(`bio numbers incomplete:\n${errors.join('\n')}`);
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
  if (w.mcpSrc?.length) {
    out.push(line('MCP tool calls via a ?src= label', w.mcpSrc, 3));
    const labels = [...new Set(w.mcpSrc.map((r) => String(r[1])))];
    const perLabel = labels.map((l) => line(`MCP tool calls via src=${l}`, w.mcpSrc, 3, (r) => r[1] === l)).filter((r) => Number(r[4]) > 0);
    out.push(...perLabel.sort((x, y) => Number(y[4]) - Number(x[4])));
  }
  if (w.books) {
    out.push(line('Book views (all books)', w.books, 5), line('Book sessions (all books)', w.books, 4));
    out.push(line('Book engaged sessions (all books)', w.books, 6));
    const books = [...new Set(w.books.map((r) => String(r[1])))];
    const perBook = books.map((b) => line(`Views: ${b}`, w.books, 5, (r) => r[1] === b)).filter((r) => Number(r[4]) > 0);
    out.push(...perBook.sort((x, y) => Number(y[4]) - Number(x[4])));
  }
  if (w.geo) {
    for (const m of ['United States', 'Vietnam', 'Rest of world']) out.push(line(`Book views: ${m}`, w.geo, 6, (r) => r[2] === m));
    for (const m of ['United States', 'Vietnam', 'Rest of world']) out.push(line(`Book engaged sessions: ${m}`, w.geo, 7, (r) => r[2] === m));
  }
  if (w.sources) {
    const ai = /chatgpt|openai|claude|anthropic|perplexity|gemini|copilot|bard|deepseek|you.com|phind/i;
    out.push(line('Book sessions from AI assistants', w.sources, 5, (r) => ai.test(String(r[3]))));
    out.push(line('Book sessions from search engines', w.sources, 5, (r) => r[2] === 'Organic Search'));
    out.push(line('Book engaged sessions from search engines', w.sources, 8, (r) => r[2] === 'Organic Search'));
  }
  if (w.campaigns) {
    out.push(line('Book sessions from tagged links (utm_campaign)', w.campaigns, 5), line('Book engaged sessions from tagged links', w.campaigns, 6));
  }
  if (w.gsc) {
    out.push(line('Google Search clicks (Search Console)', w.gsc, 2), line('Google Search impressions (Search Console)', w.gsc, 3));
  }
  if (w.github) {
    const total = (rows: Row[]) => rows.reduce((t, r) => t + Number(r[2]), 0);
    const weekAgo = (w.githubHistory ?? []).filter((r) => r[0] === days[6]);
    out.push(['GitHub stars (all repositories)', total(w.github), weekAgo.length ? total(weekAgo) : '', '', total(w.github)]);
  }
  return out;
}

// ---------------------------------------------------------------- Experiment scorecard

/** One experiment's metric as a daily series: a count, or a numerator and denominator. */
interface Series {
  num: Map<string, number>;
  den?: Map<string, number>;
  /**
   * The first day its tab has data. A rate is averaged over the days from then on, so a
   * window that starts before the data does is not read as days of zero.
   */
  since?: string;
}

interface Measure {
  /** What is measured, in words, for the scorecard row. */
  label: string;
  /**
   * rate: average per `per` days (window sums are scaled, so a part window still compares);
   * ratio: 100 × num / den over the window (a percentage);
   * level: the value on the window's last day with data (stars);
   * total: the sum since the start (one-off launches).
   */
  kind: 'rate' | 'ratio' | 'level' | 'total';
  per?: 1 | 7 | 28;
  /** The goal in the same unit; a function of the baseline for relative targets. */
  target?: number | ((baseline: number) => number);
  /** Compare the change with all book-site sessions, so a seasonal swing is not read as lift. */
  control?: boolean;
  series: (w: typeof written) => Series | undefined;
}

const AI_SOURCE = /chatgpt|openai|claude|anthropic|perplexity|gemini|copilot|bard|deepseek|you\.com|phind/i;
const LMS_SOURCE = /canvas|instructure|blackboard|moodle|brightspace|d2l|schoology|sakai|classroom\.google/i;

/** Sums column `col` per date over the rows `keep` accepts; undefined when the tab was not synced. */
export function byDate(rows: Row[] | undefined, col: number, keep: (r: Row) => boolean = () => true): Map<string, number> | undefined {
  if (!rows) return undefined;
  const m = new Map<string, number>();
  for (const r of rows) if (keep(r)) m.set(String(r[0]), (m.get(String(r[0])) ?? 0) + (Number(r[col]) || 0));
  return m;
}

/** The earliest date in a tab's rows; undefined when the tab is empty or was not synced. */
export const firstDate = (rows: Row[] | undefined): string | undefined =>
  rows?.reduce<string | undefined>((min, r) => (min === undefined || String(r[0]) < min ? String(r[0]) : min), undefined);

const one = (num: Map<string, number> | undefined, since?: string): Series | undefined => num && { num, since };
const pair = (num?: Map<string, number>, den?: Map<string, number>): Series | undefined => (num && den ? { num, den } : undefined);

/**
 * How each experiment in scripts/experiments.json is read off the tabs this sync writes.
 * Column numbers follow the tab headers above (books_sources: date, book, channel, source,
 * medium, sessions, active_users, views, engaged_sessions; and so on).
 */
export const MEASURES: Record<string, Measure> = {
  E1: {
    label: 'Organic Search sessions a week, A Guide on Data Analysis',
    kind: 'rate', per: 7, target: 450, control: true,
    series: (w) => one(byDate(w.sources, 5, (r) => r[1] === 'A Guide on Data Analysis' && r[2] === 'Organic Search'), firstDate(w.sources)),
  },
  E2: {
    label: 'Organic Search sessions a week per book: Marketing Research, AI in Action, Credit Scoring (average)',
    kind: 'rate', per: 7, target: 30, control: true,
    series: (w) => {
      const m = byDate(w.sources, 5, (r) => ['Marketing Research', 'AI in Action', 'Credit Scoring'].includes(String(r[1])) && r[2] === 'Organic Search');
      return one(m && new Map([...m].map(([d, v]) => [d, v / 3])), firstDate(w.sources));
    },
  },
  E3: {
    label: 'MCP connections a week from book-site links (src=book-*)',
    kind: 'rate', per: 7, target: 50,
    series: (w) => one(byDate(w.mcpSrc, 2, (r) => String(r[1]).startsWith('book-')), firstDate(w.mcp)),
  },
  E4: {
    label: 'Book sessions from server links (utm_source=research-methods-mcp), % of fetch calls',
    kind: 'ratio', target: 5,
    series: (w) => pair(byDate(w.campaigns, 5, (r) => r[3] === 'research-methods-mcp'), byDate(w.mcp, 6)),
  },
  E5: {
    label: 'MCP connections a day from AI applications',
    kind: 'rate', per: 1, target: 100,
    series: (w) => one(byDate(w.mcp, 2), firstDate(w.mcp)),
  },
  E6: {
    label: 'Book sessions per 28 days from courses (LMS referrers or utm_medium=course)',
    kind: 'rate', per: 28, target: 150, control: true,
    series: (w) => one(byDate(w.sources, 5, (r) => r[4] === 'course' || LMS_SOURCE.test(String(r[3]))), firstDate(w.sources)),
  },
  E7: {
    label: 'Book sessions per 28 days from AI assistants',
    kind: 'rate', per: 28, target: 200, control: true,
    series: (w) => one(byDate(w.sources, 5, (r) => AI_SOURCE.test(String(r[3]))), firstDate(w.sources)),
  },
  E8: {
    label: 'Google Search click-through %, data_analysis (Search Console)',
    kind: 'ratio', target: (b) => b + 1,
    series: (w) => pair(byDate(w.gsc, 2, (r) => r[1] === 'data_analysis'), byDate(w.gsc, 3, (r) => r[1] === 'data_analysis')),
  },
  E9: {
    label: 'Book sessions per 28 days referred by another book site',
    kind: 'rate', per: 28, target: 250, control: true,
    series: (w) => {
      const hosts = new Set(bookSites().map((b) => new URL(b.site).hostname));
      return one(byDate(w.sources, 5, (r) => r[4] === 'referral' && hosts.has(String(r[3]))), firstDate(w.sources));
    },
  },
  E10: {
    label: 'Book sessions per 28 days from Google Scholar',
    kind: 'rate', per: 28, control: true,
    series: (w) => one(byDate(w.sources, 5, (r) => /scholar\.google/.test(String(r[3]))), firstDate(w.sources)),
  },
  E11: {
    label: 'Book views per 28 days from Vietnam',
    kind: 'rate', per: 28, target: 600, control: true,
    series: (w) => one(byDate(w.geo, 6, (r) => r[2] === 'Vietnam'), firstDate(w.geo)),
  },
  E12: {
    label: 'GitHub stars, data_analysis + causalverse',
    kind: 'level', target: 160,
    series: (w) => one(byDate(w.githubHistory, 2, (r) => r[1] === 'data_analysis' || r[1] === 'causalverse')),
  },
  E13: {
    label: 'Book sessions per 28 days from Cross Validated and Reddit',
    kind: 'rate', per: 28, target: 100, control: true,
    series: (w) => one(byDate(w.sources, 5, (r) => /stats\.stackexchange|reddit/.test(String(r[3]))), firstDate(w.sources)),
  },
  E14: {
    label: 'Engaged sessions since start from links tagged utm_campaign=e14-*',
    kind: 'total', target: 300,
    series: (w) => one(byDate(w.campaigns, 6, (r) => /^e14/i.test(String(r[2])))),
  },
  E15: {
    label: 'Engaged sessions since start from links tagged utm_campaign=e15-*',
    kind: 'total', target: 1000,
    series: (w) => one(byDate(w.campaigns, 6, (r) => /^e15/i.test(String(r[2])))),
  },
  E16: {
    label: 'MCP connections a day from Claude clients',
    kind: 'rate', per: 1, target: (b) => b * 1.25,
    series: (w) => one(byDate(w.clients, 3, (r) => /^(anthropic|claude)/.test(String(r[1]))), firstDate(w.clients)),
  },
};

export const SCORECARD_HEADER = [
  'id', 'channel', 'measured', 'start', 'end', 'days_in', 'baseline', 'current', 'target',
  'change_pct', 'all_books_change_pct', 'adjusted_change_pct', 'status', 'decision',
];

const addDays = (d: string, n: number) => iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/** A measure's value over [from, to]; undefined when it cannot be computed. */
function windowValue(m: Pick<Measure, 'kind' | 'per'>, s: Series, from: string, to: string): number | undefined {
  const inWindow = (map: Map<string, number>) => [...map.keys()].filter((d) => d >= from && d <= to);
  const sum = (map: Map<string, number>) => inWindow(map).reduce((t, d) => t + map.get(d)!, 0);
  if (m.kind === 'level') {
    const last = inWindow(s.num).sort().at(-1);
    return last ? s.num.get(last) : undefined;
  }
  if (m.kind === 'ratio') {
    const den = s.den ? sum(s.den) : 0;
    return den ? (100 * sum(s.num)) / den : undefined;
  }
  if (m.kind === 'total') return sum(s.num);
  // A rate averages over the days with data only: before the tab's first day is unknown, not zero.
  const start = s.since && s.since > from ? s.since : from;
  if (start > to) return undefined;
  return (inWindow(s.num).filter((d) => d >= start).reduce((t, d) => t + s.num.get(d)!, 0) / daysBetween(start, to)) * (m.per ?? 1);
}

export interface PlannedRow {
  id: string;
  channel: string;
  start: string;
  end: string;
  decision: string;
}

/**
 * One row per experiment: its metric over the 28 days before it started (baseline) and
 * over its run so far (at most its last 28 complete days), the change, the same change in
 * all book-site sessions, and the change net of that, (1 + change) / (1 + all-books change)
 * - 1, a rough difference-in-differences that keeps a term break or holiday from reading
 * as lift. Dates and decisions come from the hand-kept experiments tab.
 */
export function scorecardRows(w: typeof written, plan: PlannedRow[], now = new Date()): Row[] {
  const yesterday = lastDays(2, now)[1];
  const control = byDate(w.books, 4);
  return plan.map((e) => {
    const m = MEASURES[e.id];
    const head = [e.id, e.channel, m?.label ?? '(measured by hand)', e.start, e.end];
    const blank = (status: string): Row => [...head, '', '', '', '', '', '', '', status, e.decision];
    if (!m) return blank('measured by hand');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.start)) return blank('no start date');
    const s = m.series(w);
    if (!s) return blank('no data (source not synced this run)');

    const before: [string, string] = [addDays(e.start, -28), addDays(e.start, -1)];
    const end = e.end && e.end < yesterday ? e.end : yesterday;
    const daysIn = yesterday < e.start ? 0 : daysBetween(e.start, end);
    const from = m.kind === 'rate' || m.kind === 'ratio' ? [e.start, addDays(end, -27)].sort()[1] : e.start;
    const baseline = m.kind === 'total' ? 0 : windowValue(m, s, ...before);
    const current = daysIn ? windowValue(m, s, from, end) : undefined;
    const target = typeof m.target === 'function' ? (baseline === undefined ? undefined : m.target(baseline)) : m.target;
    const change = baseline && current !== undefined ? current / baseline - 1 : undefined;
    const ctrlBase = control && windowValue({ kind: 'rate', per: 1 }, { num: control }, ...before);
    const ctrlNow = control && daysIn ? windowValue({ kind: 'rate', per: 1 }, { num: control }, from, end) : undefined;
    const ctrl = m.control && ctrlBase && ctrlNow !== undefined ? ctrlNow / ctrlBase - 1 : undefined;
    const adjusted = change !== undefined && ctrl !== undefined ? (1 + change) / (1 + ctrl) - 1 : change;

    let status: string;
    if (!daysIn) status = 'not started';
    else if (/^planned$/i.test(e.decision.trim())) status = 'start date passed; not shipped (decision is "planned")';
    else if (daysIn < 7) status = `too early (${daysIn} days)`;
    else if (target !== undefined && current !== undefined && current >= target) status = 'target met';
    else if (adjusted === undefined) status = current ? 'running; no baseline to compare' : 'running; nothing measured yet';
    else if (adjusted >= 0.1) status = 'improving; below target';
    else if (adjusted <= -0.1) status = 'declining';
    else status = 'no clear change yet';
    if (daysIn && e.end && yesterday > e.end) status = `ended: ${status}`;
    // Say when the baseline rests on fewer than its 28 days, so a short one is read with care.
    if (m.kind === 'rate' && baseline !== undefined && s.since && s.since > before[0]) {
      status += `; baseline from ${daysBetween(s.since, before[1])} of 28 days`;
    }

    const pct = (x: number | undefined) => (x === undefined ? '' : Math.round(x * 100));
    const val = (x: number | undefined) => (x === undefined ? '' : Math.round(x * 10) / 10);
    return [...head, daysIn, val(baseline), val(current), val(target), pct(change), pct(ctrl), pct(adjusted), status, e.decision];
  });
}

/** Rewrites the experiment_scorecard tab from the experiments tab and this run's data. */
async function syncScorecard(sheet: Sheet) {
  const plan = (await sheet.read('experiments'))
    .filter((r) => r[0])
    .map((r) => ({ id: String(r[0]), channel: String(r[1] ?? ''), start: serialDate(r[4] ?? ''), end: serialDate(r[5] ?? ''), decision: String(r[9] ?? '') }));
  await sheet.write('experiment_scorecard', SCORECARD_HEADER, scorecardRows(written, plan));
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
      'https://www.googleapis.com/auth/webmasters.readonly',
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
  await run('Book-site campaigns', () => syncBookCampaigns(sheet, token));
  await run('Search Console', () => syncSearchConsole(sheet, token));
  await run('GitHub', () => syncGithub(sheet));
  // After GitHub, so the day's row carries the star count.
  await run('Bio numbers', () => syncBio(sheet, token));
  // Filled in by hand; the sync only creates it, never writes to it again.
  await run('Experiments tab', () => seedExperiments(sheet));
  // Rewritten each run: every experiment's metric before and since its start.
  await run('Experiment scorecard', () => syncScorecard(sheet));
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
