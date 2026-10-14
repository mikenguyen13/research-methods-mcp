<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

<h1 align="center">Research Methods Library</h1>

<p align="center">
Ask your AI assistant how to analyze your data. Get the right design, the assumptions to check, runnable R and Python code, and a citation for every source.
</p>

<p align="center">
<a href="https://www.npmjs.com/package/research-methods-mcp"><img src="https://img.shields.io/npm/v/research-methods-mcp?label=npm" alt="npm"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
<img src="https://img.shields.io/badge/MCP-remote%20%7C%20stdio-5b3fd1" alt="MCP">
</p>

An [MCP](https://modelcontextprotocol.io) server that gives Claude, ChatGPT, Cursor, VS Code, and any other MCP client grounded answers from about 13,000 sections of open books and an R package on causal inference, econometrics, experiments, marketing research, credit scoring, machine learning, and AI. Free, no account, no API key.

## Install

<!-- install:start -->
**Endpoint:** `https://YOUR-HOST/mcp` (free, no account, no API key)

| Client | How to add it |
| --- | --- |
| Claude (claude.ai, Desktop, mobile) | Settings → Connectors → **Add custom connector**, paste the endpoint |
| Claude Code | `claude mcp add --transport http research-methods https://YOUR-HOST/mcp` |
| ChatGPT | Settings → turn on developer mode → add a custom connector (MCP server) with the endpoint and no authentication |
| Windsurf, Cline, Zed, and other clients | Add the JSON below to the client's MCP settings |

```json
{
  "mcpServers": {
    "research-methods": {
      "url": "https://YOUR-HOST/mcp"
    }
  }
}
```

Prefer to run it on your own machine? It needs Node.js 20 or later:

```json
{
  "mcpServers": {
    "research-methods": {
      "command": "npx",
      "args": [
        "-y",
        "research-methods-mcp"
      ]
    }
  }
}
```
<!-- install:end -->

## What you can ask

> States raised the minimum wage in different years. How do I estimate the effect on teen employment?

The assistant calls `choose_method`, which returns staggered difference-in-differences: when to use it, why a plain two-way fixed effects regression can mislead, the assumptions to check, the R packages (`did`, `fixest`, `didimputation`, `HonestDiD`) and Python packages (`csdid`, `pyfixest`, `differences`), and the sections to read.

> Give me Python code for a probability-of-default model with gradient boosting.

> Only California passed the law and I have 30 years of state data. What can I do?

> Write the methods section for my regression discontinuity and give me BibTeX for the sources.

Every answer links to the exact section it used and carries the citation of the book it came from.

## Tools

| Tool | What it does |
| --- | --- |
| `choose_method` | Matches a research question to methods, with when to use each, key assumptions, R and Python packages, and readings. 62 curated methods. |
| `search` | Finds sections across all works, with links, snippets, code languages, and a citation. Compatible with ChatGPT deep research. |
| `fetch` | Reads a section in full, with its code, link, and citation. Compatible with ChatGPT deep research. |
| `get_code` | Runnable R, Python, or Julia code for a task, with the packages it uses. |
| `cite` | References in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections you used, deduplicated by work. |
| `list_sources` | The books and packages, with topics, languages, licenses, and links. |

Prompts (slash commands in clients that support them): `plan_analysis`, `write_methods_section`, `explain_method`. Resources: the library catalog and a table of contents for each work.

All tools are read-only. The server makes no calls to language models and stores nothing about you; see the [privacy policy](https://YOUR-HOST/privacy).

## Sources

| Work | Code | Served | License |
| --- | --- | --- | --- |
| [A Guide on Data Analysis](https://bookdown.org/mike/data_analysis/) | R | Full text | CC BY-NC-SA 4.0 |
| [causalverse: The All-in-One Causal Inference Toolkit](https://mikenguyen13.github.io/causalverse/) | R | Full text and function reference | GPL-3 |
| [Credit Scoring: Theory, Methods, and Practice](https://mikenguyen13.github.io/credit_score/) | Python | Full text | CC BY 4.0 text, MIT code |
| [Marketing Research: A Technical and Academic Treatment](https://mike-marketing-research.share.connect.posit.cloud/) | R | Excerpts and code; full text on the website | All rights reserved text, MIT code |
| [AI in Action: A Reference for Artificial Intelligence](https://mikenguyen13.github.io/ai_in_action/) | Python | Excerpts and code; full text on the website | All rights reserved |

Chapters of *A Guide on Data Analysis* that appear in the Springer print volumes are cited as those volumes, for example Nguyen, M. (2025). *Foundations of data analysis* (Vol. 1). Springer Cham. https://doi.org/10.1007/978-3-032-01858-8.

## How it works

The books are parsed from their source files (`.Rmd`, `.qmd`, `.Rd`) into one index of sections, code blocks, and citations. Every link is checked against the live websites when the index is built: a section whose anchor is missing links to its chapter page, and pages that are not published yet are left out. The server searches that index in memory; there is no database and no model in the loop.

## Self-hosting

```bash
docker build -t research-methods-mcp .
docker run -p 8080:8080 research-methods-mcp     # http://localhost:8080/mcp
```

Or with Node.js: `npm ci && npm run build && npm start` (listens on `127.0.0.1:8787`; set `HOST` and `PORT` to change). The same handler runs on Deno Deploy through `src/deno.ts`.

## Development

```bash
npm ci
npm run build:index   # parse the book repositories (sibling folders) into data/index.json.gz
npm run build         # bundle dist/stdio.js and dist/http.js
npm test              # end-to-end tests through real MCP clients
npm run check-links   # audit every link in the index against the live sites
```

To add a book, add an entry to [`sources.yml`](sources.yml) and rebuild the index. To add or tune a method, edit [`methods.yml`](methods.yml); the build fails if a method points at a section that does not exist.

## Citing

Please cite the works you use; the `cite` tool formats them. To cite the server itself, see [`CITATION.cff`](CITATION.cff).

## License

The server code is MIT licensed. The content it returns keeps each work's own license, listed above and by the `list_sources` tool.
