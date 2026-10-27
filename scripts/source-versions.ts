// Release DOIs of books that are already indexed as sources. Zenodo mints a version DOI
// for every GitHub release of a book and pushes it to ORCID; DataCite records it as
// "IsVersionOf" the book's concept DOI, which sources.yml cites. Such a DOI is the same
// work as an indexed source, so it is neither a new publication nor a missing one.

import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

const UA = 'research-methods-mcp/build (https://github.com/mikenguyen13/research-methods-mcp)';

let sourceDois: Map<string, string> | undefined;

/** Concept DOI (lowercase) -> source id, from the `citation.doi` of each source in sources.yml. */
async function loadSourceDois(): Promise<Map<string, string>> {
  if (sourceDois) return sourceDois;
  const config = YAML.parse(await readFile('sources.yml', 'utf8')) as { sources: { id: string; citation?: { doi?: string } }[] };
  sourceDois = new Map(config.sources.filter((s) => s.citation?.doi).map((s) => [s.citation!.doi!.toLowerCase(), s.id]));
  return sourceDois;
}

/** The id of the indexed source that `doi` is a release version of, if any. */
export async function sourceVersionOf(doi: string): Promise<string | undefined> {
  if (!doi.toLowerCase().startsWith('10.5281/')) return undefined;
  const dois = await loadSourceDois();
  if (dois.has(doi.toLowerCase())) return dois.get(doi.toLowerCase());
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, { headers: { 'user-agent': UA } });
    if (res.ok) {
      const related: { relationType?: string; relatedIdentifier?: string }[] = (await res.json()).data?.attributes?.relatedIdentifiers ?? [];
      const concept = related.find((r) => r.relationType === 'IsVersionOf')?.relatedIdentifier?.toLowerCase();
      return concept ? dois.get(concept) : undefined;
    }
    if (attempt >= 3) throw new Error(`DataCite ${doi}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}
