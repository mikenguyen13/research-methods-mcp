# Release and listing guide

This guide covers deployment, package publication, and submission to MCP
directories. Steps that require the maintainer's own accounts are marked
**maintainer**. Directory requirements were last checked on 2026-10-14; they
change frequently, so review each linked page before submitting.

## 1. Hosted endpoint

The public endpoint runs on **Deno Deploy** (organization `research-methods`,
app `mcp`) at `https://mcp.research-methods.deno.net/mcp`. Deno Deploy runs the same web-standard
handler as the Node server, has sufficient memory for the 24 MB index, and its
free tier carries no non-commercial clause (Vercel Hobby does, which matters
because several works are linked to Springer volumes). The free tier of
Cloudflare Workers allows only 10 ms of CPU time per request, which is
insufficient.

App configuration: install command `npm ci`, no build command, entrypoint
`src/deno.ts`. Each push to `main` is built and deployed automatically.

When the endpoint changes, point every file at it, rebuild, and commit:

```bash
npm run set-endpoint -- https://<host>/mcp
npm run build && npm test && npm run check-release
```

To verify a deployment from a real client:
`claude mcp add --transport http research-methods https://<host>/mcp`, then ask
"Which method should I use if only one state passed the law?"

Alternatives: any Docker host (a `Dockerfile` is included), or `npm start`
behind a reverse proxy.

## 2. Packages (once per release)

1. **maintainer** npm (pending): publishing requires two-factor authentication
   on the npm account. After `npm login` and `npm publish` (which runs the build,
   tests, and release check first), set `config.npmPublished` to `true` in
   `package.json` and run `npm run set-endpoint -- <endpoint>`. This restores the
   local-installation instructions on the landing page and in the README, and
   adds the npm package to `server.json`.
2. Official MCP Registry, from which most other directories read: run the
   **Publish** workflow from the repository's Actions tab. It authenticates with
   GitHub OIDC and skips npm when no `NPM_TOKEN` secret is set. Registry versions
   are immutable, so each publication needs a new version number.
3. Claude Desktop extension: `npx -y @anthropic-ai/mcpb pack . research-methods-mcp.mcpb`,
   attached to a GitHub release. (Anthropic's directory no longer lists `.mcpb`
   files; users install them by opening the file.)
4. Subsequent releases: bump the version in `package.json`, `server.json` (and
   its npm package entry, when present), `manifest.json`, and `CITATION.cff`,
   then publish a GitHub release.
   The `publish.yml` workflow publishes to npm (requires an `NPM_TOKEN` secret)
   and to the MCP Registry (GitHub OIDC).

## 3. Listing copy

- **Name:** Research Methods Library
- **One-line summary (100 characters maximum):** Research methods for AI assistants: study design guidance, R and Python code, and citations
- **Short description (200 characters maximum):** Recommends study designs for a research question, states the assumptions to verify, and returns runnable R and Python code with a citation for every source. Causal inference, econometrics, and more.
- **Description (2,000 characters maximum):**

  > The Research Methods Library is a Model Context Protocol server that grounds AI assistants in approximately 13,000 sections of methodological texts: A Guide on Data Analysis; causalverse, an R package for causal inference; Credit Scoring: Theory, Methods, and Practice; Marketing Research: A Technical and Academic Treatment; and AI in Action.
  >
  > Given a research question, choose_method recommends candidate designs (difference-in-differences, synthetic control, regression discontinuity, instrumental variables, matching, double machine learning, and 56 others), stating when each applies, the identifying assumptions to verify, and the R and Python packages that implement it. search and fetch retrieve the underlying sections; get_code returns runnable R, Python, or Julia code; cite formats references in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections consulted.
  >
  > Every result links to the specific section and carries the citation of the work from which it is drawn. All tools are read-only, no account or API key is required, and the service stores no information about its users.

- **Categories / tags:** Research, Education, Data science, Statistics, Developer tools
- **Icon:** `assets/icon.png` (512×512) and `assets/icon-400.png` (400×400, for Cline). The server also serves the 512×512 icon at https://mcp.research-methods.deno.net/icon.png and as its favicon; use that URL wherever a directory asks for a custom icon URL. After changing `assets/icon.png`, run `node scripts/embed-icon.mjs`.
- **Privacy policy:** https://mcp.research-methods.deno.net/privacy
- **Terms of use:** https://mcp.research-methods.deno.net/terms
- **Support:** https://github.com/mikenguyen13/research-methods-mcp/issues
- **Documentation:** https://github.com/mikenguyen13/research-methods-mcp#readme
- **Authentication:** none (public, read-only content)

### Test cases (OpenAI requires five positive and three negative; Anthropic requires test instructions)

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

## 4. Directories

Free listings first, in approximate order of reach.

- [ ] **Official MCP Registry**: section 2 above. Feeds PulseMCP, the GitHub MCP Registry, and others. https://registry.modelcontextprotocol.io
- [ ] **GitHub MCP Registry** (VS Code, Copilot): after the official registry, request onboarding at partnerships@github.com; later versions sync automatically.
- [ ] **Anthropic Connectors Directory** (Claude): https://claude.ai/directory/manage → Submit new → MCP connector. Requires a paid Claude plan, the copy above, the privacy and support URLs, the icon, and test instructions (use the test cases). Tool titles and annotations are already set.
- [ ] **OpenAI ChatGPT Directory**: https://platform.openai.com/plugins. Requires individual or business verification, the URLs above, a demonstration video, release notes, the eight test cases, and domain verification: set `VERIFY_PATH` and `VERIFY_TOKEN` in the deployment's environment to the path and token OpenAI provides.
- [ ] **Smithery**: https://smithery.ai/new, with the endpoint.
- [ ] **Glama**: https://glama.ai/mcp/servers → Add Server with the repository URL. On its Dockerfile page, Deploy and then Make Release so the server receives a quality score. `glama.json` claims ownership.
- [ ] **Docker MCP Catalog**: fork https://github.com/docker/mcp-registry, run `task remote-wizard` (remote, streamable-http, the endpoint, icon URL `https://raw.githubusercontent.com/mikenguyen13/research-methods-mcp/main/assets/icon.png`), and open a pull request. Listed about 24 hours after merge.
- [ ] **Cline MCP Marketplace**: open an issue at https://github.com/cline/mcp-marketplace with the repository URL, `assets/icon-400.png`, and a one-sentence rationale (grounded research-methods answers and code).
- [ ] **awesome-mcp-servers**: pull request to https://github.com/punkpeye/awesome-mcp-servers adding, in alphabetical order under Research (or Education):
  `- [mikenguyen13/research-methods-mcp](https://github.com/mikenguyen13/research-methods-mcp) 📇 ☁️ 🏠 - Research methods library: recommends causal inference and econometric designs, returns runnable R and Python code, and cites the sources.`
- [ ] **awesome-remote-mcp-servers**: the same entry, for the hosted endpoint.
- [ ] **MCP Market**: https://mcpmarket.com/submit (the free queue takes four to six weeks; a paid fast track exists).
- [ ] **mcp.so**: https://mcp.so/submit (confirm whether a free path exists before paying).
- [ ] **cursor.directory**: submit through the site.
- [ ] **PulseMCP**: not accepting submissions; it indexes servers from the official registry.

## 5. Adoption

- [ ] Add a section on using each book with an AI assistant, with the endpoint and the Cursor and VS Code buttons, to each book's home page and README.
- [ ] Publish `llms.txt` on each book site (credit_score already has one) pointing at the endpoint.
- [ ] Add the endpoint to the causalverse README and pkgdown home page.
- [ ] Announce with a short screen recording of one query proceeding from `choose_method` to code to a BibTeX reference list.
- [ ] Monitor usage in the Deno Deploy dashboard (request counts) and citations in Google Scholar.
