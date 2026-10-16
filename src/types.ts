// Shapes shared by the index builder (scripts/build-index.ts) and the server.

export type TextAccess = 'full' | 'teaser';

export interface Person {
  family: string;
  given: string;
  orcid?: string;
}

/** A citable work: a book, a print volume, a chapter, a journal article, a dataset, or a software package. */
export interface Work {
  key: string;
  type: 'book' | 'software' | 'article' | 'chapter' | 'dataset' | 'misc';
  /** Kind of item for `misc` works, printed in brackets in APA, e.g. "Presentation". */
  genre?: string;
  title: string;
  subtitle?: string;
  authors: Person[];
  year: number;
  volume?: number | string;
  /** Journal issue (articles). */
  issue?: string;
  /** Page range, e.g. "45-78" (articles and chapters). */
  pages?: string;
  /** Journal name (articles) or book title (chapters). */
  container?: string;
  edition?: string;
  version?: string;
  publisher?: string;
  /** Imprint place, e.g. "Cham" for Springer: APA prints "Springer Cham", Chicago "Cham: Springer". */
  place?: string;
  doi?: string;
  isbn?: string;
  url: string;
}

export interface SourceMeta {
  id: string;
  title: string;
  summary: string;
  format: 'bookdown' | 'quarto' | 'r-package' | 'publications';
  site: string;
  github: string;
  text_access: TextAccess;
  license: { text: string; code: string };
  /** Key of the work cited for this source by default. */
  citation: string;
  languages: string[];
  sections: number;
  code_blocks: number;
}

/** One section of a book page (a chapter, or a level 2 or 3 heading inside it). */
export interface SectionRecord {
  /** `<source>:<page>` for a page, `<source>:<page>#<anchor>` for a section. */
  id: string;
  source: string;
  title: string;
  /** Titles of the enclosing chapter and sections, outermost first. */
  crumbs: string[];
  level: number;
  url: string;
  /** Source file the section came from, relative to the source root. */
  file: string;
  /** Keys of the works to cite, most specific first. */
  cite: string[];
  /** Markdown body: full text with code, or a teaser followed by the code. */
  md: string;
  /** Packages and qualified functions used in the code, lowercased. */
  pkgs: string[];
  /** Languages of the code blocks in this section. */
  langs: string[];
}

/** One entry of the curated method catalog behind `choose_method`. */
export interface MethodEntry {
  id: string;
  name: string;
  family: string;
  use_when: string;
  assumptions: string[];
  avoid_when?: string;
  keywords: string[];
  sections: string[];
  packages: { r?: string[]; python?: string[] };
}

export interface LibraryIndex {
  schema: 1;
  built: string;
  sources: SourceMeta[];
  works: Work[];
  records: SectionRecord[];
  methods: MethodEntry[];
}
