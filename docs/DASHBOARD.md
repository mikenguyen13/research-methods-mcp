# Usage dashboard

One private Looker Studio page with every usage number: calls to the hosted MCP
endpoint, visitors to each book site, and GitHub stars. It runs in the cloud, so it
can be opened from any device at any time, and it costs nothing.

```
Upstash Redis (MCP counters) ─┐
Google Analytics 4 (books)  ──┼─ GitHub Action, hourly ─→ Google Sheet ─→ Looker Studio
GitHub API (stars, forks)   ──┘   scripts/sync-stats.ts     (private)       (private link)
```

Freshness: MCP counts and GitHub stars are at most about an hour old (GitHub can start a
scheduled run 10–30 minutes late). Google Analytics itself processes data with a delay of
a few hours. For live visitors, use Realtime in Google Analytics.

The repository is public, so the Action's logs are public too: the script prints only
tab names and row counts, never a number from the data. The secrets live in GitHub's
encrypted Actions secrets.

## One-time setup (about 15 minutes)

### 1. Google Cloud service account (free, no billing)

1. Open https://console.cloud.google.com/ with the Google account that owns the
   Analytics properties, and create a project, for example `research-methods-stats`.
2. **APIs & Services → Library**: enable **Google Sheets API** and
   **Google Analytics Data API**.
3. **IAM & Admin → Service accounts → Create service account**, named `stats-sync`.
   Skip the optional role and user steps.
4. Open the new account → **Keys → Add key → Create new key → JSON**. A `.json` file
   downloads. Keep it private, and delete the local copy after step 4 below.
5. Copy the account's email (`stats-sync@<project>.iam.gserviceaccount.com`).

### 2. Give the service account read access to Google Analytics

In Google Analytics: **Admin → Account (Mike Nguyen) → Account access management → + →
Add users**, paste the service-account email, role **Viewer**, uncheck "Notify new users
by email", **Add**. Access granted on the account covers every property in it.

### 3. Create the Google Sheet

Create a blank sheet, for example "Research Methods usage". **Share** it with the
service-account email as **Editor** (uncheck "Notify people"). The sheet id is the long
string in its URL: `docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

### 4. Add the GitHub secrets

GitHub → this repository → **Settings → Secrets and variables → Actions → New
repository secret**, four times:

| Secret | Value |
| --- | --- |
| `STATS_SHEET_ID` | The sheet id from step 3 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The whole contents of the JSON key file from step 1 |
| `UPSTASH_REDIS_REST_URL` | `KV_REST_API_URL` from Vercel → Storage → `research-methods-usage` → Quickstart (.env.local tab) |
| `UPSTASH_REDIS_REST_READONLY_TOKEN` | `KV_REST_API_READ_ONLY_TOKEN` from the same place (the read-only token, not the read-write one) |

### 5. First run

GitHub → **Actions → Usage dashboard → Run workflow**. The first run backfills the full
history (Redis keeps about 13 months; Google Analytics up to 400 days), and later runs
re-read only the last three days. The sheet gets these tabs:

| Tab | One row per |
| --- | --- |
| `mcp_daily` | day: connections (split into `app_connections` from AI applications and `bot_connections` from directory crawlers and monitors), tool calls, calls per tool, prompts, resource reads |
| `mcp_clients` | day and client name, with its kind (`app` or `bot`) |
| `books_daily` | day and book site: active users, new users, sessions, views |
| `github_daily` | day and repository: stars, forks, watchers |
| `updated` | the time of the last successful write |

A run fails (and GitHub emails you) when a source stops answering; the other sources
are still written. A book site that fails keeps its previous numbers.

### 6. Build the Looker Studio report

1. https://lookerstudio.google.com → **Blank report** → **Google Sheets** → choose the
   sheet → tab `mcp_daily` → **Add**. Then **Add data** again for `books_daily`,
   `github_daily`, `mcp_clients`, and `updated`.
2. For each data source (**Resource → Manage added data sources → Edit**): check that
   `date` has type **Date**, and set **Data freshness** to **15 minutes**.
3. Suggested layout for one page:
   - **Header**: a table from `updated` showing `last_updated_utc`, and a date-range
     control (default: last 28 days).
   - **MCP**: scorecards for `tool_calls` and `app_connections` with "compare to
     previous period"; a time series of `tool_calls` by `date`; a bar chart of
     `tool_search`, `tool_fetch`, `tool_choose_method`, `tool_get_code`, `tool_cite`.
   - **Books**: a table from `books_daily` with dimension `book` and metrics `views`,
     `sessions`, `new_users` (sorted by views); a time series of `views` by `date`
     with breakdown `book`.
   - **GitHub**: a table from `github_daily` with dimension `repository`, metrics
     `stars`, `forks` (aggregation **Max**), and a filter on the latest date
     (date-range **Today** on that chart).
   - **Who connects**: a table from `mcp_clients` filtered to `kind = app`, dimension
     `client`, metric `connections`.
4. **Share** stays restricted to you. Bookmark the report URL (on a phone, add it to the
   home screen).

Note: `active_users` per day added over many days counts a returning visitor once per
day. For unique visitors over a period, use the numbers in Google Analytics itself.

## Maintenance

- **A new AI application shows up as `bot`.** Add the start of its client name to
  `APP_CLIENTS` in `scripts/sync-stats.ts`. Regular runs only reclassify the last three
  days; to reclassify history, clear the `mcp_daily` and `mcp_clients`
  tabs and run the workflow (it backfills from Redis, which keeps about 13 months).
- **A new book site.** Add its Analytics property id to `GA_PROPERTIES` and its
  repository to `sources.yml`.
- **GitHub pauses scheduled workflows** in a public repository after 60 days without a
  commit. If the dashboard stops updating, open **Actions → Usage dashboard** and
  click **Enable workflow**.
- **Rotating the key.** Create a new JSON key for the service account, replace the
  `GOOGLE_SERVICE_ACCOUNT_KEY` secret, then delete the old key in Google Cloud.
- Upstash cost: each run reads three keys, about 2,200 commands a month, well inside the
  free plan's 500,000.
