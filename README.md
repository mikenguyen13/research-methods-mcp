<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

<h1 align="center">Research Methods Library</h1>

<p align="center">
A Model Context Protocol server that grounds AI assistants in methodological texts: study design recommendations, identifying assumptions, runnable R and Python code, and a citation for every source.
</p>

<p align="center">
<a href="https://www.npmjs.com/package/research-methods-mcp"><img src="https://img.shields.io/npm/v/research-methods-mcp?label=npm" alt="npm"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
<img src="https://img.shields.io/badge/MCP-remote%20%7C%20stdio-5b3fd1" alt="MCP">
</p>

The Research Methods Library is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. Given a research question, it recommends candidate designs, states their identifying assumptions, returns runnable R and Python code, and supplies a formatted citation for every source consulted. Its index contains approximately 13,000 sections from four textbooks and one R package (listed under [Sources](#sources)) covering causal inference, econometrics, experimental design, marketing research, credit scoring, machine learning, and artificial intelligence.

The server works with Claude, ChatGPT, Cursor, Visual Studio Code, and any other MCP-compatible client. Access is free and requires no account or API key.

## Installation

<!-- install:start -->
**Endpoint:** `https://mcp.research-methods.deno.net/mcp`. Access is free and requires no account or API key.

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=research-methods&config=eyJ1cmwiOiJodHRwczovL21jcC5yZXNlYXJjaC1tZXRob2RzLmRlbm8ubmV0L21jcCJ9)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_server-0098FF?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=research-methods&config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.research-methods.deno.net%2Fmcp%22%7D)

| Client | Configuration |
| --- | --- |
| Claude (web, desktop, and mobile) | Settings → Connectors → **Add custom connector**; enter the endpoint |
| Claude Code | `claude mcp add --transport http research-methods https://mcp.research-methods.deno.net/mcp` |
| ChatGPT | Settings → enable developer mode → add a custom connector of type MCP server with the endpoint and no authentication |
| Cursor, Visual Studio Code | Use the buttons above |
| Windsurf, Cline, Zed, and other clients | Add the following JSON to the client's MCP configuration |

```json
{
  "mcpServers": {
    "research-methods": {
      "url": "https://mcp.research-methods.deno.net/mcp"
    }
  }
}
```

To run the server locally instead (requires Node.js 20 or later):

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

## Example queries

> States raised the minimum wage in different years. How do I estimate the effect on teen employment?

For this query the assistant calls `choose_method`, which returns staggered difference-in-differences together with its scope conditions, the reason a conventional two-way fixed-effects regression can be biased when treatment effects are heterogeneous, the assumptions to verify, implementations in R (`did`, `fixest`, `didimputation`, `HonestDiD`) and Python (`csdid`, `pyfixest`, `differences`), and the relevant readings.

> Give me Python code for a probability-of-default model with gradient boosting.

> Only California passed the law and I have 30 years of state data. What can I do?

> Write the methods section for my regression discontinuity and give me BibTeX for the sources.

Each response links to the specific section consulted and carries the citation of the work from which it is drawn.

## Tools

| Tool | What it does |
| --- | --- |
| `choose_method` | Matches a research question to methods, with when to use each, key assumptions, R and Python packages, and readings. 62 curated methods. |
| `search` | Finds sections across all works, with links, snippets, code languages, and a citation. Compatible with ChatGPT deep research. |
| `fetch` | Reads a section in full, with its code, link, and citation. Compatible with ChatGPT deep research. |
| `get_code` | Runnable R, Python, or Julia code for a task, with the packages it uses. |
| `cite` | References in APA, Chicago, MLA, Harvard, BibTeX, or RIS for the sections consulted, deduplicated by work. |
| `list_sources` | The books and packages, with topics, languages, licenses, and links. |

Prompts (slash commands in clients that support them): `plan_analysis`, `write_methods_section`, `explain_method`. Resources: the library catalog and a table of contents for each work.

All tools are read-only. The server makes no calls to language models and stores no information about its users; see the [privacy policy](https://mcp.research-methods.deno.net/privacy).

## Sources

| Work | Code | Served | License |
| --- | --- | --- | --- |
| [A Guide on Data Analysis](https://bookdown.org/mike/data_analysis/) | R | Full text | CC BY-NC-SA 4.0 |
| [causalverse: The All-in-One Causal Inference Toolkit](https://mikenguyen13.github.io/causalverse/) | R | Full text and function reference | GPL-3 |
| [Credit Scoring: Theory, Methods, and Practice](https://mikenguyen13.github.io/credit_score/) | Python | Full text | CC BY 4.0 text, MIT code |
| [Marketing Research: A Technical and Academic Treatment](https://mike-marketing-research.share.connect.posit.cloud/) | R | Excerpts and code; full text on the website | All rights reserved text, MIT code |
| [AI in Action: A Reference for Artificial Intelligence](https://mikenguyen13.github.io/ai_in_action/) | Python | Excerpts and code; full text on the website | All rights reserved |

Chapters of *A Guide on Data Analysis* that appear in the Springer print volumes are cited as those volumes, for example Nguyen, M. (2025). *Foundations of data analysis* (Vol. 1). Springer Cham. https://doi.org/10.1007/978-3-032-01858-8.

## Method

The source files of each work (`.Rmd`, `.qmd`, `.Rd`) are parsed into a single index of sections, code blocks, and citations. During index construction every link is verified against the published website: a section whose anchor is absent links to its chapter page, and unpublished pages are excluded. Queries are answered from the in-memory index; no database or language model is involved.

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

## Citation

Users are asked to cite the works they draw on; the `cite` tool formats the references. To cite the server itself, see [`CITATION.cff`](CITATION.cff).

## License

The server code is MIT licensed. The content it returns keeps each work's own license, listed above and by the `list_sources` tool.
