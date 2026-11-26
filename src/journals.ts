// Table and figure formatting rules for top business journals (FT50 and UTD24),
// served by the journal_requirements, list_journals, and export_code tools.
//
// data/journals.json is a generated snapshot of the causalverse R package's
// journal registry (R/journal_styles_data.R and inst/extdata/journal_sources.csv),
// with each journal's layered style already resolved. Regenerate it with
// `npm run build:journals` (scripts/build-journals.R); never edit it by hand.

import snapshot from '../data/journals.json' with { type: 'json' };

export interface JournalStyle {
  id: string;
  name: string;
  abbrev: string;
  publisher: string;
  lists: string[];
  family: string;
  artwork: string;
  confidence: 'high' | 'medium' | 'low' | string;
  verified: string;
  caveats: string[];
  table: {
    significance: 'stars' | 'none' | 'exact_p' | string;
    stars: { symbol: string; p: number }[];
    star_note: string;
    star_note_text: string[];
    tails: string | null;
    uncertainty: 'se' | 't' | 'ci' | string;
    leading_zero: 'always' | 'bounded' | 'never' | string;
    digits: number;
    p_digits: number;
    numbering: 'arabic' | 'roman' | string;
    label: string;
    caption: {
      label_upper: boolean;
      label_bold: boolean;
      sep: string;
      title_italic: boolean;
      title_upper: boolean;
      align: string;
      end_period: boolean;
      position: string;
    };
    caption_example: string;
    notes_order: string[];
    note_label: string;
    specific_marks: string;
    panel_label: string;
    placement: 'embedded' | 'end' | 'either' | string;
    insert_marker: string | null;
    insert_marker_example: string | null;
    max_columns: number | null;
    vertical_rules: boolean;
    formats: string[];
  };
  figure: {
    formats_initial: string[];
    formats_final: string[];
    vector_preferred: boolean;
    vector_required: boolean;
    dpi: { line_art: number; halftone: number; combination: number };
    widths_mm: { single: number; onehalf: number; double: number };
    widths_generic: boolean;
    font_family: string;
    min_font_pt: number;
    max_font_pt: number;
    title_in_image: boolean;
    label: string;
    numbering: string;
    caption_position: string;
    caption_example: string;
    panel_label: string;
    grayscale: boolean;
    gray_range: number[];
    gray_step: number;
    max_series: number | null;
    alt_text: boolean;
    alt_text_label: string;
    source_data: boolean;
    color_print: string;
  };
  sources: { scope: string; url: string }[];
}

interface Snapshot {
  registry: { package: string; verified: string; kind: string; commit?: string | null; version?: string };
  lists: Record<string, string>;
  journals: JournalStyle[];
}

const data = snapshot as unknown as Snapshot;

export const JOURNALS: readonly JournalStyle[] = data.journals;
export const JOURNAL_IDS = JOURNALS.map((j) => j.id) as [string, ...string[]];
export const REGISTRY_VERIFIED: string = data.registry.verified;
export const JOURNAL_LISTS = ['all', 'ft50', 'ft50_2026', 'ft50_2016', 'utd24'] as const;
export type JournalList = (typeof JOURNAL_LISTS)[number];
export const CAUSALVERSE_URL = 'https://github.com/mikenguyen13/causalverse';

const LIST_LABELS: Record<string, string> = {
  ft50_2026: 'FT50 (2026)',
  ft50_2016: 'FT50 (2016)',
  utd24: 'UTD24',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find a journal by id ("smj"), abbreviation ("SMJ"), or name ("Strategic Management
 * Journal"), case- and punctuation-insensitive, as causalverse's journal_style() does.
 * Returns the journal, or the candidates when the input is ambiguous or unknown.
 */
export function findJournal(query: string): { journal?: JournalStyle; candidates: JournalStyle[] } {
  const key = query.trim().toLowerCase();
  const k = norm(key);
  if (!k) return { candidates: [] };
  const byId = JOURNALS.find((j) => j.id === key);
  // An id wins, as in causalverse; other journals with that abbreviation come back as candidates.
  if (byId) return { journal: byId, candidates: JOURNALS.filter((j) => j !== byId && norm(j.abbrev) === k) };
  const strip = (s: string) => norm(s.replace(/^the\s+/i, ''));
  const byName = JOURNALS.filter((j) => norm(j.name) === k || strip(j.name) === norm(key.replace(/^the\s+/, '')));
  if (byName.length === 1) return { journal: byName[0], candidates: [] };
  const byAbbrev = JOURNALS.filter((j) => norm(j.abbrev) === k);
  if (byAbbrev.length === 1) return { journal: byAbbrev[0], candidates: [] };
  if (byAbbrev.length > 1) return { candidates: byAbbrev };
  const partial = JOURNALS.filter((j) => norm(j.name).includes(k));
  if (partial.length === 1) return { journal: partial[0], candidates: [] };
  return { candidates: partial };
}

export function listJournals(list: JournalList = 'all'): JournalStyle[] {
  const key = list === 'ft50' ? 'ft50_2026' : list;
  return key === 'all' ? [...JOURNALS] : JOURNALS.filter((j) => j.lists.includes(key));
}

/** Short summary of one journal for list_journals. */
export function journalSummary(j: JournalStyle) {
  return {
    id: j.id,
    name: j.name,
    abbrev: j.abbrev,
    publisher: j.publisher,
    lists: j.lists,
    ft50_2026: j.lists.includes('ft50_2026'),
    ft50_2016: j.lists.includes('ft50_2016'),
    utd24: j.lists.includes('utd24'),
    confidence: j.confidence,
    verified: j.verified,
  };
}

const UNCERTAINTY: Record<string, string> = {
  se: 'standard errors',
  t: 't-statistics',
  ci: 'confidence intervals',
};

const LEADING_ZERO: Record<string, string> = {
  always: 'always write the leading zero (0.25)',
  bounded: 'drop the leading zero only for statistics that cannot exceed 1, such as p-values and correlations (.25); keep it otherwise (0.25)',
  never: 'never write the leading zero (.25)',
};

const PLACEMENT: Record<string, string> = {
  embedded: 'embedded in the text',
  end: 'at the end of the manuscript, after the references, each on its own page',
  either: 'embedded or at the end (not specified)',
};

function significanceText(t: JournalStyle['table']): string {
  if (t.significance === 'none') return 'No significance stars (the journal does not allow them). Report standard errors and, where useful, exact p-values or confidence intervals.';
  if (t.significance === 'exact_p') return `No significance stars. Report exact p-values (${t.p_digits} digits).`;
  const levels = [...t.stars].sort((a, b) => a.p - b.p).map((s) => `${s.symbol} p < ${s.p}`).join(', ');
  return `Stars: ${levels}${t.tails ? ` (${t.tails})` : ''}.`;
}

const yes = (b: boolean, y: string, n: string) => (b ? y : n);

/** Markdown rendering of journal_requirements. */
export function requirementsMarkdown(j: JournalStyle): string {
  const t = j.table;
  const f = j.figure;
  const lists = j.lists.map((l) => LIST_LABELS[l] ?? l).join(', ') || 'none';
  const lines = [
    `# ${j.name} (${j.abbrev}): table and figure formatting`,
    `${j.publisher} · lists: ${lists} · confidence: **${j.confidence}** · verified ${j.verified}`,
    '',
    '## Tables',
    `- Significance: ${significanceText(t)}`,
  ];
  if (t.star_note_text.length) lines.push(`- Significance note: "${t.star_note_text.join(' / ')}"`);
  lines.push(
    `- In parentheses: ${UNCERTAINTY[t.uncertainty] ?? t.uncertainty}`,
    `- Leading zero: ${LEADING_ZERO[t.leading_zero] ?? t.leading_zero}`,
    `- Decimal places: ${t.digits} (p-values ${t.p_digits})`,
    `- Numbering and caption: ${t.numbering === 'roman' ? 'Roman numerals' : 'Arabic numerals'}; caption ${t.caption.position} the table, e.g. "${t.caption_example.replace(' / ', '" then on the next line "')}"` +
      `${t.caption.label_bold ? ', label in bold' : ''}${t.caption.title_italic ? ', title in italics' : ''}${t.caption.title_upper ? ', title in capitals' : ''}${t.caption.end_period ? ', title ends with a period' : ''}${t.caption.align !== 'left' ? `, ${t.caption.align}-aligned` : ''}`,
    `- Notes: introduced by "${t.note_label}", in the order ${t.notes_order.join(', ')}; specific notes marked with ${t.specific_marks}; panels labelled "${t.panel_label}"`,
    `- Placement: ${PLACEMENT[t.placement] ?? t.placement}${t.insert_marker_example ? `; put "${t.insert_marker_example}" in the text where the table belongs` : ''}`,
    `- Maximum columns: ${t.max_columns ?? 'not specified'}; vertical rules: ${yes(t.vertical_rules, 'allowed', 'no')}`,
    `- Editable formats: ${t.formats.join(', ')}`,
    '',
    '## Figures',
    `- Formats: review copy ${f.formats_initial.join(', ')}; final ${f.formats_final.join(', ')}${f.vector_required ? ' (vector required)' : f.vector_preferred ? ' (vector preferred)' : ''}`,
    `- Minimum resolution: line art ${f.dpi.line_art} dpi, halftone ${f.dpi.halftone} dpi, combination ${f.dpi.combination} dpi`,
    `- Widths: single column ${f.widths_mm.single} mm, 1.5 column ${f.widths_mm.onehalf} mm, double column ${f.widths_mm.double} mm${f.widths_generic ? ' (generic; the journal does not specify)' : ''}`,
    `- Font: ${f.font_family}, ${f.min_font_pt} to ${f.max_font_pt} pt`,
    `- Caption: ${f.caption_position} the figure, e.g. "${f.caption_example.replace(' / ', ' ')}"; panels labelled "${f.panel_label}"`,
    `- Title inside the image: ${yes(f.title_in_image, 'allowed', 'no, put it in the caption')}`,
    `- Grayscale: ${yes(f.grayscale, `must remain readable in grayscale (gray levels ${f.gray_range.join(' to ')}, step ${f.gray_step})`, 'not required')}${f.max_series ? `; at most ${f.max_series} series` : ''}`,
    `- Alt text: ${yes(f.alt_text, 'required', 'not required')}; source data: ${yes(f.source_data, 'supply the plotted data', 'not required')}`,
    `- Colour in print: ${f.color_print}`,
  );
  if (j.caveats.length) lines.push('', '## Caveats', ...j.caveats.map((c) => `- ${c}`));
  lines.push(
    '',
    '## Sources',
    ...j.sources.map((s) => `- ${s.scope}: ${s.url}`),
    '',
    `Rules from the causalverse journal registry (${CAUSALVERSE_URL}), verified ${j.verified}. ${j.confidence === 'high' ? 'Read from the journal\'s own current guidelines.' : j.confidence === 'medium' ? 'Partly from an older copy, a search excerpt, or publisher-wide rules: check the sources before submitting.' : 'Only publisher-wide rules were readable: check the journal\'s own guidelines before submitting.'} Use export_code for R code that applies these rules.`,
  );
  return lines.join('\n');
}

export const CODE_KINDS = ['table', 'figure', 'both'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

/** Runnable R code that formats a table and/or figure for the journal with causalverse. */
export function exportCode(j: JournalStyle, kind: CodeKind = 'both'): string {
  const t = j.table;
  const f = j.figure;
  const id = j.id;
  const out: string[] = [
    `# ${j.name} (${j.abbrev}): tables and figures formatted with causalverse`,
    `# Rules verified ${j.verified} (${j.confidence} confidence). Print them with journal_style("${id}").`,
    '# install.packages("pak"); pak::pkg_install("mikenguyen13/causalverse")',
    'library(causalverse)',
    '',
    `journal_style("${id}")`,
  ];
  if (kind === 'table' || kind === 'both') {
    const sig =
      t.significance === 'none' ? `# ${j.abbrev} does not allow significance stars: the table shows ${UNCERTAINTY[t.uncertainty]} only.`
      : t.significance === 'exact_p' ? `# ${j.abbrev} wants exact p-values instead of stars.`
      : `# Stars: ${[...t.stars].sort((a, b) => a.p - b.p).map((s) => `${s.symbol} p < ${s.p}`).join(', ')}.`;
    out.push(
      '',
      '# ---- Table ----------------------------------------------------------------',
      '# Replace these example models with your own (any model supported by broom).',
      'm1 <- lm(mpg ~ am, data = mtcars)',
      'm2 <- lm(mpg ~ am + wt, data = mtcars)',
      'models <- list("(1)" = m1, "(2)" = m2)',
      '',
      sig,
      `# In parentheses: ${UNCERTAINTY[t.uncertainty]}; ${t.digits} decimals; leading zero: ${t.leading_zero}; caption like "${t.caption_example}".`,
      `tab <- journal_table(models, journal = "${id}",`,
      `                     title = "Manual Transmission and Fuel Economy", number = 1,`,
      '                     coef_map = c(am = "Manual transmission", wt = "Weight (1,000 lbs)"),',
      '                     notes = "OLS estimates. The dependent variable is miles per gallon.")',
      'tab',
      'journal_check(tab)   # lists any rule the table breaks',
      '',
      `# Writes table1.${t.formats.join(', table1.')} (plus a dated copy in archive/).`,
      'export_tab(tab, "table1", "output/tables")',
    );
    if (t.placement === 'end') {
      out.push(t.insert_marker_example
        ? `# ${j.abbrev} wants tables after the references; put "${t.insert_marker_example}" in the text where Table ${t.numbering === 'roman' ? 'I' : '1'} belongs.`
        : `# ${j.abbrev} wants tables after the references, each on its own page.`);
    }
    if (t.max_columns) out.push(`# At most ${t.max_columns} columns per table.`);
  }
  if (kind === 'figure' || kind === 'both') {
    out.push(
      '',
      '# ---- Figure ---------------------------------------------------------------',
      'library(ggplot2)',
      'p <- ggplot(mtcars, aes(wt, mpg, colour = factor(cyl), shape = factor(cyl))) +',
      '  geom_point(size = 2) +',
      '  labs(title = "Heavier Cars Travel Fewer Miles per Gallon",',
      '       x = "Weight (1,000 lbs)", y = "Miles per gallon", colour = "Cylinders", shape = "Cylinders") +',
      `  scale_colour_journal("${id}") +`,
      `  theme_journal("${id}")`,
      '',
      `journal_check(p, "${id}")   # flags fonts, colours, and titles that break the rules`,
      '',
      `# ${f.title_in_image ? 'The title may stay in the image.' : 'The title moves from the image into the caption.'} Final files: ${f.formats_final.join(', ')} at ${f.dpi.line_art} dpi (line art), ${f.widths_mm.single} mm wide (single column).`,
    );
    const args = [
      `export_fig(p, "figure1", "output/figures", journal = "${id}",`,
      '           width = "single", stage = "final", number = 1',
    ];
    if (f.alt_text) args[1] += ',\n           alt_text = "Scatter plot: miles per gallon fall as car weight rises, for 4, 6, and 8 cylinders."';
    out.push(args.join('\n') + ')');
    if (f.source_data) out.push(`# ${j.abbrev} asks for the data behind each chart: export_fig() also writes figure1_data.csv.`);
    if (f.grayscale) out.push(`# ${j.abbrev} figures must stay readable in grayscale: scale_colour_journal() uses gray levels; keep shapes or line types distinct too.`);
    out.push('# Use stage = "initial" for the review copy (' + f.formats_initial.join(' + ') + ').');
  }
  return out.join('\n');
}
