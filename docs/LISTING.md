# Release and listing guide

This guide covers deployment, package publication, and submission to MCP
directories. Steps that require the maintainer's own accounts are marked
**maintainer**. Directory requirements were last checked on 2026-10-14; they
change frequently, so review each linked page before submitting.

## 1. Hosted endpoint

The public endpoint runs on **Vercel** (Hobby plan, project `research-methods-mcp`)
at `https://research-methods-mcp.vercel.app/mcp`. `vercel.json` builds the bundle, rewrites
every path to the single function in `api/index.mjs` (entry point `src/vercel.ts`),
and ships the index and the prebuilt search index with it. Each push to `main` is
built and deployed automatically; the Vercel GitHub app can access this
repository only. The Hobby plan is limited to non-commercial use, which this free
academic service is, and requires no payment method.

Hosts considered and rejected (October 2026): Deno Deploy (`src/deno.ts` still
works) suspends unverified organizations at 1% of the free limits, and
verification requires a payment method (the former Deno organization was
suspended on 2026-10-16 after exhausting its outbound-traffic allowance and is
no longer used); Hugging Face Docker Spaces require a
paid plan; Cloudflare Workers allow only 10 ms of CPU per request on the free
plan. The prebuilt search index keeps instance startup near 0.5 s on any host.

The **Endpoint health** workflow checks `/health` daily and fails if the
endpoint does not answer.

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
   on the npm account. The account uses a security key, so `npm publish` prints
   an approval link and waits only about five minutes for it to be approved;
   four attempts on 2026-10-17 and 18 expired before approval. Either run
   `npm publish --access public --ignore-scripts` (immediately after a passing
   `npm run build && npm test && npm run check-release`) in one sitting, pressing
   Enter and approving in the browser at once, or add a granular `NPM_TOKEN`
   repository secret and run the **Publish** workflow. After the first
   publication, npm trusted publishing from the workflow can replace the token.
   After `npm login` and `npm publish` (which runs the build,
   tests, and release check first), set `config.npmPublished` to `true` in
   `package.json` and run `npm run set-endpoint -- <endpoint>`. This restores the
   local-installation instructions on the landing page and in the README, and
   adds the npm package to `server.json`.
2. Official MCP Registry, from which most other directories read: run the
   **Publish** workflow from the repository's Actions tab. It authenticates with
   GitHub OIDC and skips npm when no `NPM_TOKEN` secret is set. Registry versions
   are immutable, so each publication needs a new version number.
3. Claude Desktop extension: publishing a GitHub release runs the **Publish**
   workflow, which builds `research-methods-mcp.mcpb` and attaches it to the
   release (locally: `npm run pack:mcpb`). Anthropic's directory no longer lists
   `.mcpb` files; users install them by opening the file.
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

  > The Research Methods Library is a Model Context Protocol server that grounds AI assistants in approximately 17,000 sections of methodological texts by Mike Nguyen: A Guide on Data Analysis and its Springer volumes; Advanced Data Analysis; causalverse, an R package for causal inference; Credit Scoring: Theory, Methods, and Practice; Marketing Research: A Technical and Academic Treatment; Applying Tidy Finance with Python to Vietnam; Machine Learning in Python; AI in Action; and peer-reviewed research articles.
  >
  > Given a research question, choose_method recommends candidate designs (difference-in-differences, synthetic control, regression discontinuity, instrumental variables, matching, double machine learning, and 56 others), stating when each applies, the identifying assumptions to verify, and the R and Python packages that implement it. search and fetch retrieve the underlying sections; get_code returns runnable R, Python, or Julia code; cite formats references in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections consulted.
  >
  > Every result links to the specific section and carries the citation of the work from which it is drawn. All tools are read-only, no account or API key is required, and the service stores no information about its users.

- **Categories / tags:** Research, Education, Data science, Statistics, Developer tools
- **Icon:** `assets/icon.png` (512×512) and `assets/icon-400.png` (400×400, for Cline). The server serves the icon at https://research-methods-mcp.vercel.app/icon.png (512×512) and /icon.svg, a multi-size /favicon.ico, Apple touch and manifest icons, and a 1200×630 link-preview image at /og.png; it also advertises the icons in its MCP serverInfo. Use the icon.png URL wherever a directory asks for a custom icon URL. All of these are rendered from `assets/icon.svg` by `npm run build:icons`.
- **Privacy policy:** https://research-methods-mcp.vercel.app/privacy
- **Terms of use:** https://research-methods-mcp.vercel.app/terms
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

Free listings first, in approximate order of reach. Status as of 2026-10-17.

- [x] **Official MCP Registry**: section 2 above; `io.github.mikenguyen13/research-methods-mcp` 0.1.1. Feeds PulseMCP, the GitHub MCP Registry, and others. https://registry.modelcontextprotocol.io
- [ ] **GitHub MCP Registry** (VS Code, Copilot): after the official registry, request onboarding at partnerships@github.com; later versions sync automatically.
- [x] **Anthropic Connectors Directory** (Claude): https://claude.ai/directory/manage → Submit new → MCP connector. Requires a paid Claude plan, the copy above, the privacy and support URLs, the icon, and test instructions (use the test cases). Approved as a community connector on 2026-10-16; resubmitted on 2026-10-17 with the current description and the three prompts, and in review. Once approved, **maintainer**: Publish from the submission page; the listing then appears at https://claude.ai/directory/connectors/research-methods-library. Edits made before publishing return the listing to draft and need Submit for review again.
- [ ] **maintainer** **OpenAI ChatGPT plugin directory**: https://platform.openai.com/plugins. Submissions are plugin packages in the Agent Plugins format. `npm run pack:openai` validates `openai-plugin/plugin.json` and `openai-plugin/mcp.json` against the published schemas and writes `research-methods-openai-plugin.zip` (listing copy, the five positive and three negative test cases, release notes, and icons). Steps: (1) **maintainer** complete individual or business verification under Settings → Organization → General; (2) Upload new or existing plugin, choosing the verified developer identity; (3) domain verification: set `VERIFY_PATH=/.well-known/openai-apps-challenge` and `VERIFY_TOKEN` to the challenge token in the Vercel project's environment variables and redeploy; (4) connect the MCP server with no authentication and wait for the tool scan; (5) add the demonstration video URL (`review.demo_recording_url`, required for MCP review); (6) Submit for review and complete the attestations. Guide: https://developers.openai.com/plugins/deploy/submission.
- [x] **Smithery**: https://smithery.ai/servers/research-methods/library (namespace `research-methods`; display name, description, homepage, repository, and icon set under Settings).
- [x] **Glama**: server https://glama.ai/mcp/servers/mikenguyen13/research-methods-mcp (claimed through `glama.json`; Admin → Repository → Sync Server refreshes the README) and connector https://glama.ai/mcp/connectors/io.github.mikenguyen13/research-methods-mcp (claimed with GitHub; thumbnail set under Admin → Listing). The server page shows the GitHub account's avatar. Release 0.1.1 published on Glama on 2026-10-17 and rated A (tool definitions A, maintenance A). A successful Glama build is not visible to users until a release is created under Admin → Releases.
- [x] **Docker MCP Catalog**: pull request https://github.com/docker/mcp-registry/pull/5776 (`servers/research-methods`, remote), open with no review as of 2026-10-17. Listed about 24 hours after merge.
- [ ] **maintainer** **Cline MCP Marketplace**: open an issue at https://github.com/cline/mcp-marketplace with the repository URL, `assets/icon-400.png`, and a one-sentence rationale (grounded research-methods answers and code). Cline asks the submitter to confirm a test installation in Cline.
- [x] **awesome-mcp-servers**: pull request https://github.com/punkpeye/awesome-mcp-servers/pull/16594, with the Glama score badge. The bot requires a Glama listing that passes its checks and a quality score; both are met (label `has-glama`, score A), and the pull request awaits merge. Entry:
  `- [mikenguyen13/research-methods-mcp](https://github.com/mikenguyen13/research-methods-mcp) 📇 ☁️ 🏠 - Research methods library: recommends causal inference and econometric designs, returns runnable R and Python code, and cites the sources.`
- [x] **awesome-remote-mcp-servers**: pull request https://github.com/punkpeye/awesome-remote-mcp-servers/pull/2023, with the Glama connector badge. Merged on 2026-10-17 (Pacific). The maintainer offers a server-author flair in the MCP Discord (https://glama.ai/mcp/discord) on reply with a Discord username.
- [x] **mcprush**: listed without a submission on 2026-10-17 at https://mcprush.com/mikenguyen13/research-methods-library-mcp (unclaimed). Claiming is free and adds listing management and analytics; its hosting and paid-subscription features do not apply to this free service. Reply to the invitation email to request removal.
- [x] **MCP Market**: submitted to the free queue at https://mcpmarket.com/submit (four to six weeks; a paid fast track exists).
- [x] **mcp.so**: the web form is paid only; free submissions are issues on https://github.com/chatmcp/mcpso (submitted as https://github.com/chatmcp/mcpso/issues/5570).
- [x] **cursor.directory**: submitted as a plugin with one MCP server component (Manual tab; the Auto tab needs Open Plugins files in the repository). https://cursor.directory/plugins/research-methods-library appears once the site's security scan finishes.
- [ ] **PulseMCP**: not accepting submissions; it indexes servers from the official registry.
- [x] **Amazon Bedrock AgentCore**: no listing needed. AgentCore Gateway accepts MCP server targets with no outbound authorization, so Bedrock users add the endpoint with `agentcore add gateway-target --type mcp-server --endpoint <endpoint>`; the README, landing page, and `llms.txt` give the commands.
- [ ] **AWS Marketplace** (AI Agents and Tools, "API-based AI agents & tools", tool type MCP Server): deferred. Listing requires a seller account in AWS Partner Central (**maintainer**), the AWS Marketplace SaaS integration for the chosen pricing model (a free product sets every pricing dimension to $0), and an authorization method of API keys or OAuth; the form offers no unauthenticated option. Listing would therefore mean issuing API keys to Marketplace subscribers in addition to the open endpoint. AgentCore Gateway integration through the Marketplace requires two-legged OAuth. See https://docs.aws.amazon.com/marketplace/latest/userguide/listing-saas-ai-agents.html.

## 5. Adoption

- [ ] Add a section on using each book with an AI assistant, with the endpoint and the Cursor and VS Code buttons, to each book's home page and README.
- [ ] Publish `llms.txt` on each book site (credit_score already has one) pointing at the endpoint.
- [ ] Add the endpoint to the causalverse README and pkgdown home page.
- [ ] Announce with a short screen recording of one query proceeding from `choose_method` to code to a BibTeX reference list.
- [ ] Monitor usage in the Vercel dashboard (requests and function usage against the Hobby limits) and citations in Google Scholar.
