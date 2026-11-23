# Usage dashboard

A private Data Studio (formerly Looker Studio) report with every usage number: calls to
the hosted MCP endpoint, visitors to each book site (with locations and traffic
sources), and GitHub stars. It runs in the cloud, so it can be opened from any device at
any time, and it costs nothing.

**Dashboard:** https://datastudio.google.com/reporting/32b8df75-bc4b-442b-8cf4-c3eb48a5fbfa
(pages *Overview*, *Growth & experiments*, *Locations*, and *Bio*; visible only to the owner's Google account).

```
Upstash Redis (MCP counters) ─┐
Google Analytics 4 (books)  ──┤
Google Search Console       ──┼─ GitHub Action, hourly ─→ Google Sheet ─→ Looker Studio
GitHub API (stars, forks)   ──┘   scripts/sync-stats.ts     (private)       (private link)
```

Freshness: MCP counts and GitHub stars are at most about an hour old (GitHub can start a
scheduled run 10–30 minutes late). Google Analytics itself processes data with a delay of
a few hours. For live visitors, use Realtime in Google Analytics.

The repository is public, so the Action’s logs are public too: the script prints only
tab names and row counts, never a number from the data. Google access is keyless (no
service-account key exists): the workflow trades GitHub’s OIDC token for a one-hour token
through Workload Identity Federation, and only this repository is allowed to. MCP counts
are read the same way, by the workflow proving itself to the endpoint, so nothing
secret is stored in GitHub at all.

## Setup (done 2026-11-14)

These are already in place; they are listed so the setup can be checked or rebuilt.

### 1. Google Cloud project `research-methods-stats` (free, no billing)

Owned by the Google account that owns the Analytics properties.

- **APIs enabled:** Google Sheets API, Google Analytics Data API, IAM Service Account
  Credentials API.
- **Service account:** `stats-sync@research-methods-stats.iam.gserviceaccount.com`, with
  no project roles and no keys.
- **Workload Identity pool `github`**, provider `github-actions` (OIDC, issuer
  `https://token.actions.githubusercontent.com`, default audience). Attribute mapping
  `google.subject = assertion.sub`, `attribute.repository = assertion.repository`;
  condition `assertion.repository == 'mikenguyen13/research-methods-mcp'`.
- **Grant:** on `stats-sync`, Workload Identity User for
  `principalSet://iam.googleapis.com/projects/720871649247/locations/global/workloadIdentityPools/github/attribute.repository/mikenguyen13/research-methods-mcp`
  (pool page → Grant access → service account impersonation).

The provider and service account are named in `.github/workflows/stats.yml`; they are
identifiers, not secrets.

### 2. Google Analytics access

Admin → Account “Mike Nguyen” → Account access management: `stats-sync@…` has
**Viewer**. Access on the account covers every property in it, including new ones.

### 3. Google Sheet

“Research Methods usage” in the owner’s Drive, shared with `stats-sync@…` as
**Editor**. Its id (from the URL `docs.google.com/spreadsheets/d/<id>/edit`) is the
`STATS_SHEET_ID` variable below.

### 4. GitHub variable

Repository → **Settings → Secrets and variables → Actions → Variables**:
`STATS_SHEET_ID` = the sheet id. The workflow is skipped while it is unset. No secrets
are needed.

### 5. MCP counts without a secret

The hosted endpoint serves the daily counters at `/stats.json` only to a request
carrying a GitHub Actions OIDC token that GitHub signed for **this repository’s
`.github/workflows/stats.yml` running on `main`**, with audience
`research-methods-stats` (`src/oidc.ts` checks the signature against GitHub’s published
keys, the issuer, audience, expiry, repository, and workflow ref). Any other caller gets
401. The allowed repository is set in `src/vercel.ts` (override with
`STATS_OIDC_REPOSITORY`). Outside GitHub Actions, the script can read Upstash directly
with `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_READONLY_TOKEN`.

### 6. First run

GitHub → **Actions → Usage dashboard → Run workflow**. The first run backfills the full
history (Redis keeps about 13 months; Google Analytics up to 400 days), and later runs
re-read only the last three days. The sheet gets these tabs:

| Tab | One row per |
| --- | --- |
| `mcp_daily` | day: connections (split into `app_connections` from AI applications and `bot_connections` from directory crawlers and monitors), tool calls, calls per tool, prompts, resource reads |
| `mcp_clients` | day and client name, with its kind (`app` or `bot`) |
| `mcp_src` | day and `?src=` label on the endpoint URL (see "Source labels" in `docs/LISTING.md`): connections, tool calls |
| `books_daily` | day and book site: active users, new users, sessions, views, engaged sessions |
| `books_geo` | day, book, market (United States, Vietnam, Rest of world), country, and region (state or province): active users, views, engaged sessions; 120 days |
| `books_sources` | day, book, channel, source, and medium: sessions, active users, views, engaged sessions; 120 days |
| `books_campaigns` | day, book, `utm_campaign`, source, and medium, for tagged links only: sessions, engaged sessions, views; 120 days |
| `gsc_daily` | day and book: Google Search clicks, impressions, click-through, average position (after step 8) |
| `gsc_top` | the top 50 queries and the top 50 pages per book over the last 28 days (replaced each run) |
| `experiments` | one experiment from the growth plan, filled in by hand; the sync creates the tab once and never writes to it again |
| `experiment_scorecard` | experiment, rewritten every run: its metric over the 28 days before its start (`baseline`) and over its run so far (`current`, at most the last 28 complete days), `target`, `change_pct`, the same change in the control, engaged sessions from all channels but Direct and Unassigned (`all_books_change_pct`), the change net of it (`adjusted_change_pct`), and a `status`. A rate is averaged over the days its tab has data, and the status says when the baseline rests on fewer than 28 days |
| `github_daily` | day and repository: stars, forks, watchers |
| `github_latest` | repository: current stars, forks, watchers |
| `summary` | headline metric: last 7 complete days, the 7 before, change in %, last 28 days; `order` keeps the row order |
| `reach` | book, over each Google Analytics property's whole history: readers (total users), views, engaged sessions, countries with at least one engaged session, first month with data (`since`); an `All books` row on top. Rewritten once a day |
| `citations` | each work with a DOI on the ORCID record: type, year, `citations` (the larger of `openalex` and `crossref`), and whether it is a volume of the Springer series. Rewritten once a day |
| `bio_daily` | day: Springer series volumes, citations (all works), readers and countries (all books), all-time engaged sessions, GitHub stars. One row a day, for watching the bio numbers grow |
| `updated` | the time of the last successful write |

A run fails (and GitHub emails you) when a source stops answering; the other sources
are still written. A book site that fails keeps its previous numbers.

### 7. Build the Looker Studio report

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

**Engaged sessions** (Google Analytics: longer than 10 seconds, two or more pages, or a key
event) are the number to judge experiments by, because a large part of the views total is
automated (one-page visits at one view per visitor, often from a single country or
referrer). A tab written before
the `engaged_sessions` column existed is re-read in full once, so the column has history.

### Bio numbers (page *Bio*)

Add `bio_daily`, `reach`, and `citations` as data sources, then a page with: scorecards
from `bio_daily` for `series_volumes`, `citations`, `readers_all_books`, and `countries`
(aggregation **Max**, date range **Last 7 days**, so each shows the latest day); a time
series of `citations` and `readers_all_books` by `date`; and tables of `reach` and
`citations` (sorted by `readers` and `citations`).

The bio page (mikenguyen.netlify.app) reads `stats/bio.json` from this repository: readers,
views, and countries rounded down to a milestone (`bioMilestones`), so it says "more than
half a million" rather than an exact count. The sync rewrites the file when it reads the
full reach, and the workflow commits it only when a milestone changes. If the file cannot
be fetched, the page keeps the numbers written into it.

How far each number can be trusted when quoting it:

- **Readers** start when each book's Google Analytics 4 property did (the `since`
  column). Visits counted before it, under Universal Analytics or on bookdown.org, are
  not included, so the true total is higher. `All books` adds the books together: one
  person who read two books counts twice.
- **Readers and views include automated visits** (see engaged sessions above).
  `engaged_sessions` and `countries` count only real reading, so they are the safer
  numbers to quote.
- **Citations** come from OpenAlex and Crossref by DOI. Google Scholar has no API and
  counts more, chiefly citations of the open web books, which have no DOI; check Scholar
  by hand before quoting it. A work missing from the ORCID record is not counted (in
  November 2026, the chapters of volume 2 were not on ORCID).
- **Series volumes** are books on the ORCID record with a Springer DOI (prefix
  `10.1007`), so a new volume appears once it is added to ORCID.

### Reading the experiment scorecard

Each experiment's metric is defined in `MEASURES` in `scripts/sync-stats.ts`; the
dates and the `decision` column come from the `experiments` tab, so changing a start
date there moves its windows. Rates are scaled to the unit of the plan's target (a day,
a week, or 28 days), so a run shorter than 28 days still compares with the baseline.

- `adjusted_change_pct` = (1 + change) / (1 + control change) - 1. It keeps a term
  break or a holiday from reading as lift (or as a loss). It is a before-and-after
  comparison against all books, not a randomized test: several experiments that start
  in the same weeks share it.
- The control (`all_books_change_pct`; the column keeps its name for the report) is
  engaged sessions on all book sites from every channel except Direct and Unassigned,
  minus the rows the experiment itself counts (E1's control leaves out Data Analysis
  organic search). Automated bursts land in Direct or Unassigned, or have no engaged
  sessions: on November 19–22, 2026, about 10,000 one-page Direct visits from China made
  all-book sessions jump 300% and read E1 as `declining`, while engaged sessions from the
  other channels stayed at 20 to 45 a day. E11, read from `books_geo`, uses the same
  control without leaving anything out.
- `status`: `not started`; `start date passed; not shipped` (the decision still
  says `planned`: set it to `running` on the day the change goes live); `too early`
  (under 7 days); `target met`; `improving; below target` (adjusted change of +10% or
  more); `declining` (-10% or less); `no clear change yet`, with `(within noise)` when
  the change is 10% or more but, for a rate, no more than twice its rough Poisson
  standard error (from the session counts of the measure and its control in both
  windows), as happens with small counts or short runs; `ended: ...` after its end
  date. Decide keep or stop at the end date and type it in `decision` and `result`.
- E10 (Google Scholar) has no numeric target; check Scholar by hand each month.
- E7's treated-versus-held-out comparison needs page-level numbers, which the sync does
  not read yet; the scorecard shows the total.

### Tagging links for experiments

The scorecard finds an experiment's visits by these tags, so every link an experiment
publishes carries them (see "Source labels" in `docs/LISTING.md`):

- Book links: `utm_source` = the site or app the link is on, `utm_medium` = `social`,
  `video`, `forum`, `email`, `course`, `directory`, `ai-tool` or `talk`, and
  `utm_campaign` = the experiment id and a slug: `e6-syllabus-causal`,
  `e11-zalo-did`, `e14-video-did`, `e15-launch-hn`.
- Links the server returns are tagged automatically (E4):
  `utm_source=research-methods-mcp&utm_medium=ai-tool&utm_campaign=e4-<tool>`.
- MCP endpoint links: `?src=<label>` (`book-<id>`, `youtube`, `linkedin`, ...).

### 8. Search Console (pending)

1. In the `research-methods-stats` Cloud project, enable the **Google Search Console API**.
2. In Search Console, for each property that covers a book site (a URL-prefix property
   such as `https://mikenguyen13.github.io/`, or a domain property), **Settings → Users
   and permissions → Add user**: `stats-sync@research-methods-stats.iam.gserviceaccount.com`,
   permission **Restricted** (read-only). Sites without a property need one first
   (verify ownership, then submit the sitemap).
3. Run the workflow. The sync lists every property shared with the service account,
   matches each book site in `sources.yml` to the most specific property covering it
   (a shared `github.io` property is split by page URL), backfills `gsc_daily`, and then
   re-reads the last five days each hour. Until step 1 is done it logs "Search Console
   is not set up; skipping" and the run still succeeds.

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
- **No secrets to rotate.** Google access and the MCP counts both rely on GitHub’s
  short-lived OIDC tokens.
- **Running locally.** Set `GOOGLE_ACCESS_TOKEN` (for example from
  `gcloud auth print-access-token --impersonate-service-account=stats-sync@research-methods-stats.iam.gserviceaccount.com`)
  or `GOOGLE_SERVICE_ACCOUNT_KEY`, plus the variables above, and run `npx tsx scripts/sync-stats.ts`.
- Upstash cost: each run reads three keys, about 2,200 commands a month, well inside the
  free plan's 500,000.
