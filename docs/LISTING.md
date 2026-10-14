# Launch and listing kit

Everything needed to get the server onto every MCP marketplace. Steps that
need your accounts are marked **you**. Requirements were checked against each
marketplace's docs on 2026-10-14; they change often, so skim the linked page
before each submission.

## 1. Deploy the public endpoint (once)

**Deno Deploy** is the recommended free host: it runs the same web-standard
handler, has enough memory for the 24 MB index, and has no non-commercial clause
(Vercel Hobby does, which matters because the books link to Springer volumes).
Cloudflare Workers' free tier allows only 10 ms of CPU per request, which is
not enough.

1. **you** Push this repo to GitHub as `mikenguyen13/research-methods-mcp`.
2. **you** At https://deno.com/deploy, sign in with GitHub, create an app from the
   repo, and set the entrypoint to `src/deno.ts`. No build step is needed.
3. Optional: add a custom domain (for example `mcp.<your-domain>`). Links to the
   endpoint will live in people's configs for years, so a domain you control is
   worth it.
4. Point every file at the endpoint, rebuild, and commit:
   ```bash
   npm run set-endpoint -- https://<your-host>/mcp
   npm run build && npm test && npm run check-release
   ```
5. Check it from a real client: `claude mcp add --transport http research-methods https://<your-host>/mcp`,
   then ask "Which method should I use if only one state passed the law?"

Alternatives: any Docker host (`Dockerfile` is included), or `npm start` behind a reverse proxy.

## 2. Publish the packages (once per release)

1. **you** `npm login`, then `npm publish` (runs the build, tests, and release check first).
2. **you** Publish to the official MCP Registry. Most other directories pull from it:
   ```bash
   # install: https://github.com/modelcontextprotocol/registry/releases (mcp-publisher)
   mcp-publisher login github
   mcp-publisher publish
   ```
3. **you** Claude Desktop extension: `npx -y @anthropic-ai/mcpb pack . research-methods-mcp.mcpb`
   and attach the file to a GitHub release. (Anthropic's directory no longer lists
   `.mcpb` files; users install them by double-clicking.)
4. Later releases: bump the version in `package.json`, `server.json` (two places),
   `manifest.json`, and `CITATION.cff`, then publish a GitHub release. The
   `publish.yml` workflow publishes to npm (needs an `NPM_TOKEN` secret) and the
   MCP Registry (GitHub OIDC).

## 3. Listing copy (paste as needed)

- **Name:** Research Methods Library
- **One-liner (100 chars max):** Research methods for AI assistants: R and Python code, method advice, and citations from open books
- **Short description (200 chars max):** Ask how to analyze your data and get the right design, assumptions to check, runnable R and Python code, and a citation for every source. Causal inference, econometrics, ML, and more.
- **Description (2,000 chars max):**

  > The Research Methods Library gives AI assistants grounded answers on how to analyze data, drawn from about 13,000 sections of open books and an R package by Mike Nguyen: A Guide on Data Analysis, causalverse, Credit Scoring: Theory, Methods, and Practice, Marketing Research, and AI in Action.
  >
  > Describe a research question and choose_method recommends designs (difference-in-differences, synthetic control, regression discontinuity, instrumental variables, matching, double machine learning, and 56 more) with when to use each, the assumptions to check, and the R and Python packages that implement it. search and fetch read the underlying sections; get_code returns runnable R, Python, or Julia code; cite formats references in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections used.
  >
  > Every result links to the exact section and carries the citation of the work it came from. All tools are read-only, there is no account or API key, and the service stores nothing about its users.

- **Categories / tags:** Research, Education, Data science, Statistics, Developer tools
- **Icon:** `assets/icon.png` (512×512) and `assets/icon-400.png` (400×400, for Cline)
- **Privacy policy:** https://YOUR-HOST/privacy
- **Terms of service:** https://YOUR-HOST/terms
- **Support:** https://github.com/mikenguyen13/research-methods-mcp/issues
- **Documentation:** https://github.com/mikenguyen13/research-methods-mcp#readme
- **Auth:** none (public, read-only content)

### Test cases (OpenAI wants 5 positive and 3 negative; Anthropic wants test instructions)

Positive (the assistant should use the tools):

1. "States raised the minimum wage in different years. How should I estimate the effect on teen employment?" → `choose_method` returns staggered difference-in-differences first, with R and Python packages and links.
2. "Show me R code for a sharp regression discontinuity with rdrobust." → `get_code` returns `rdrobust` code with a link and citation.
3. "What is the weak instruments problem and how do I test for it?" → `search` then `fetch` on the weak instruments section; the answer cites A Guide on Data Analysis.
4. "Give me BibTeX for the sources you used." → `cite` with `style: bibtex` returns `@book` / `@manual` entries.
5. "Which Python packages fit a probability-of-default scorecard?" → `choose_method` returns credit scorecards (`optbinning`, `scikit-learn`) with the Credit Scoring chapter.

Negative (the assistant should not use the tools):

1. "What's the weather in Paris tomorrow?"
2. "Write a birthday poem for my sister."
3. "Book me a table for two tonight."

## 4. Marketplaces

Free listings first, roughly in order of reach. Tick them off as you go.

- [ ] **Official MCP Registry**: step 2 above. Feeds PulseMCP, the GitHub MCP Registry, and others. https://registry.modelcontextprotocol.io
- [ ] **GitHub MCP Registry** (VS Code, Copilot): after the official registry, email partnerships@github.com asking for onboarding; later versions sync automatically.
- [ ] **Anthropic Connectors Directory** (Claude): https://claude.ai/directory/manage → Submit new → MCP connector. Needs a paid Claude plan, the copy above, the privacy and support URLs, the icon, and test instructions (use the test cases). Tool titles and annotations are already set.
- [ ] **OpenAI ChatGPT Directory**: https://platform.openai.com/plugins. Needs individual or business verification first, the URLs above, a demo video, release notes, the 8 test cases, and domain verification: set `VERIFY_PATH` and `VERIFY_TOKEN` in the deployment's environment to the path and token OpenAI gives you.
- [ ] **Smithery**: https://smithery.ai/new, paste the endpoint.
- [ ] **Glama**: https://glama.ai/mcp/servers → Add Server with the repo URL. On its Dockerfile page, Deploy and then Make Release so the server gets a quality score. `glama.json` claims ownership.
- [ ] **Docker MCP Catalog**: fork https://github.com/docker/mcp-registry, run `task remote-wizard` (remote, streamable-http, the endpoint, icon URL `https://raw.githubusercontent.com/mikenguyen13/research-methods-mcp/main/assets/icon.png`), open a PR. Live about 24 hours after merge.
- [ ] **Cline MCP Marketplace**: open an issue at https://github.com/cline/mcp-marketplace with the repo URL, `assets/icon-400.png`, and one line on why it helps Cline users (grounded research-methods answers and code).
- [ ] **awesome-mcp-servers**: PR to https://github.com/punkpeye/awesome-mcp-servers adding, in alphabetical order under Research (or Education):
  `- [mikenguyen13/research-methods-mcp](https://github.com/mikenguyen13/research-methods-mcp) 📇 ☁️ 🏠 - Research methods library: pick causal inference and econometrics designs, get runnable R and Python code, and cite the sources.`
- [ ] **awesome-remote-mcp-servers**: same line, for the hosted endpoint.
- [ ] **MCP Market**: https://mcpmarket.com/submit (free queue takes 4 to 6 weeks; a paid fast track exists).
- [ ] **mcp.so**: https://mcp.so/submit (check whether a free path exists before paying).
- [ ] **cursor.directory**: submit through the site.
- [ ] **PulseMCP**: not taking submissions; it picks servers up from the official registry.

## 5. Make it travel

Listings get the server found; these get it used and cited.

- [ ] Add a "Use this book in your AI assistant" box with the endpoint and the Cursor and VS Code buttons to each book's home page and README.
- [ ] Publish `llms.txt` on each book site (credit_score already has one) pointing at the endpoint.
- [ ] Add the endpoint to the causalverse README and pkgdown home page.
- [ ] Announce with a short screen recording of one question going from `choose_method` to code to a BibTeX list.
- [ ] Watch usage in the Deno Deploy dashboard (request counts) and citations in Google Scholar.
