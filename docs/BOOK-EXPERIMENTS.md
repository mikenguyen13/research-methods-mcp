# Book-site changes for the growth experiments

What each book repository changes for the experiments in `scripts/experiments.json`, and
how each change is tagged so the dashboard's `experiment_scorecard` tab can measure it
(see "Reading the experiment scorecard" and "Tagging links for experiments" in
`docs/DASHBOARD.md`).

The book sites (id, repository folder next to this one, site):

| id | folder | format | site |
| --- | --- | --- | --- |
| data_analysis | `data_analysis` | bookdown | https://mikenguyen13.github.io/data_analysis/ (canonical since commit b0ec9a9; the same build is also on https://mike-data-analysis.share.connect.posit.cloud/) |
| advanced_data_analysis | `advanced_data_analysis` | Quarto | https://advanced-data-analysis.netlify.app/ |
| causalverse | `causalverse` | R package (pkgdown) | https://mikenguyen13.github.io/causalverse/ |
| credit_score | `credit_score/book` | Quarto | https://mikenguyen13.github.io/credit_score/ |
| marketing_research | `marketing_research` | Quarto | https://mikenguyen13.github.io/marketing_research/ (canonical since commit 68ac7e4 on origin/master; Posit copy at https://mike-marketing-research.share.connect.posit.cloud/) |
| ai_in_action | `ai_in_action` | Quarto | https://mikenguyen13.github.io/ai_in_action/ |
| tidy_finance_vn | `tidy_finance_vn` | Quarto | https://mikenguyen13.github.io/tidy_finance_vn/ |
| tidy_finance_vn_vi | `tidy_finance_vn_vi` | Quarto | https://mikenguyen13.github.io/tidy_finance_vn_vi/ |
| social_theory | `social-theory` | bookdown | https://mikenguyen13.github.io/social-theory/ |
| meta_analysis | `meta_analysis` | bookdown | https://mikenguyen13.github.io/meta_analysis/ (live since 2026-11-24, after the experiments started; canonical links and Search Console since 2026-11-27) |

`sources.yml` holds each book's citation (title, authors, year, DOI where there is one).

## Ground rules

- Work on a branch. Commit; do not push, merge, deploy, open a pull request, or post
  anywhere. The owner ships each change on its experiment's start date, so the
  scorecard's before-and-after windows line up.
- Prefer the book's existing include and template mechanism (Quarto `include-after-body`
  / `include-in-header` / partials, bookdown `includes` / `before_body` / `after_body`,
  pkgdown `_pkgdown.yml` templates). One shared include per book, not per-chapter edits,
  except where a change is per chapter by design (E7 openings, E9 related links).
- Render the book, or at least a few chapters, and check the result in the HTML.
- Never put UTM parameters on links between the nine book sites (E9): they would turn the
  referral into a campaign and hide it from the measure, which counts referrals by host.

## Changes

### E2 (start 2026-11-16, late): one canonical host and a sitemap

- Every page carries `<link rel="canonical">` with its URL on the site above (Quarto:
  `website.site-url` set to the site; bookdown: a header include or `url` in
  `_bookdown.yml` / `index.Rmd`).
- A `sitemap.xml` with absolute URLs on that host, and a `robots.txt` that names it.
- List any other host that serves the same pages (bookdown.org, Netlify previews, an
  old GitHub Pages path) in the report, for redirects. Search Console verification and
  sitemap submission are done by the owner.

### E3 (start 2026-11-16, late): "Use this book with your AI assistant"

- A short box on the home page and in every chapter's footer: one sentence ("Ask
  questions about this book in Claude, Cursor, VS Code, or ChatGPT, with answers that
  cite the section"), the endpoint
  `https://research-methods-mcp.vercel.app/mcp?src=book-<id with hyphens>`
  (`book-data-analysis`, `book-credit-score`, `book-tidy-finance-vn-vi`, ...), a copy
  button or plain code span, Cursor and VS Code install buttons in the same format as
  `README.md` in this repository (but with this book's `?src=` endpoint), and a link to
  https://research-methods-mcp.vercel.app/.
- Keep it small and quiet; it must not push chapter content down on phones.

### E7 (start 2026-11-23): pages AI assistants can cite

- `llms.txt` at the site root (several books already have one: update it rather than
  replace it): what the book covers, its chapters with URLs, how to cite it, and the
  endpoint with `?src=llms-txt`.
- A "Cite this section" box at the end of each chapter: APA and BibTeX for the book
  (from `sources.yml`), with the chapter title and URL.
- data_analysis only: a definition-first opening on 15 of 30 method chapters, with the
  other 15 held out. Pick 30 method chapters (one per method: DiD, RD, IV, synthetic
  control, matching, panel data, ...), pair them by similarity (topic and length), assign
  one of each pair at random with a fixed seed, and record the assignment in
  `experiments/e7-assignment.csv` (chapter file, URL, pair, treated 0/1, seed). In treated
  chapters only, rewrite the opening paragraph so its first sentence states what the
  method is and when it applies; change nothing else.

### E9 (start 2026-11-23): "Related in other books"

- Where a chapter has a strong match in one of the other eight books, a short "Related in
  other books" list at its end, at most three links, plain URLs with no UTM tags. Find
  matches with the Research Methods Library MCP tools (`search`, `choose_method`) or
  the index in `data/index.json.gz`; link only matches a reader would want.

### E10 (start 2026-11-23): Google Scholar meta tags

- In every page's head: `citation_title` (the book), `citation_author` (one per author,
  "Family, Given"), `citation_publication_date` (year), `citation_publisher` where there
  is one, `citation_doi` where `sources.yml` has a DOI, and `citation_pdf_url` only if a
  PDF exists. Zenodo DOIs and ORCID works are made by the owner.

### data_analysis extras

- E11 (start 2026-11-23): a Vietnamese landing page (`vi.html` or `vi/index`) with five
  translated chapter summaries (difference-in-differences, regression discontinuity,
  instrumental variables, panel data, regression), each about 300 words, linking to the
  English chapter. Natural Vietnamese for students; mark it for the owner's review. Also
  write `experiments/e11-share-links.md` with the landing page URL tagged per channel
  (`utm_source=zalo|viblo|facebook`, `utm_medium=social`, `utm_campaign=e11-<slug>`) for
  the owner to post.
- E12 (start 2026-11-23): refresh `README.md` (what the book covers, a preview image,
  the citation, the MCP endpoint with `?src=book-data-analysis`, suggested GitHub
  topics in the report).
- E8 (titles and descriptions of 20 chapters) waits for Search Console data; do not
  start it.

### causalverse extras

- E12: refresh `README.md` and the pkgdown home page (preview image, citation, MCP
  endpoint with `?src=book-causalverse`, suggested GitHub topics in the report), and
  draft entries for curated awesome lists (R, causal inference, econometrics) in
  `experiments/e12-awesome-lists.md` for the owner to submit. Do not submit them.

## Report

End with: the branch name; per experiment, what changed and which files; what was
verified in the rendered HTML; what is left for the owner (pushing on the start date,
Search Console, Zenodo, posting); and other hosts found for E2.
