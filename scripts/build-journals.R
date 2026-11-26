# Builds data/journals.json, the snapshot of causalverse's journal formatting
# registry that the journal_requirements, list_journals, and export_code tools
# serve. The rules themselves live in causalverse (R/journal_styles_data.R and
# inst/extdata/journal_sources.csv); this script only resolves each journal's
# layered style (defaults -> reporting family -> publisher artwork -> journal
# overrides) and writes the result as JSON. Never edit data/journals.json by hand.
#
# Run from the repository root:
#   npm run build:journals                         # causalverse checkout at ../causalverse
#   CAUSALVERSE_PATH=/path/to/causalverse npm run build:journals
#   Rscript scripts/build-journals.R /path/to/causalverse
#
# With a causalverse source checkout, the registry is read from its R/ files
# (so uncommitted registry edits are picked up). Without one, the installed
# causalverse package is used.

suppressWarnings(suppressMessages({
  if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Install jsonlite: install.packages('jsonlite')")
}))
options(causalverse.journal_stale_warning = FALSE)

args <- commandArgs(trailingOnly = TRUE)
cv_path <- if (length(args)) args[[1]] else Sys.getenv("CAUSALVERSE_PATH", "../causalverse")
out_file <- if (length(args) >= 2) args[[2]] else file.path("data", "journals.json")

from_source <- dir.exists(file.path(cv_path, "R")) &&
  file.exists(file.path(cv_path, "R", "journal_styles_data.R"))

if (from_source) {
  cv_path <- normalizePath(cv_path, winslash = "/")
  ns <- new.env(parent = globalenv())
  for (f in c("journal_styles_data.R", "journal_style.R", "journal_tables.R")) {
    sys.source(file.path(cv_path, "R", f), envir = ns, keep.source = FALSE)
  }
  sources_csv <- file.path(cv_path, "inst", "extdata", "journal_sources.csv")
  git <- function(...) tryCatch(
    suppressWarnings(system2("git", c("-C", shQuote(cv_path), ...), stdout = TRUE, stderr = FALSE)),
    error = function(e) character())
  commit <- git("rev-parse", "--short", "HEAD")
  dirty <- length(git("status", "--porcelain", "--", "R/journal_styles_data.R",
                      "R/journal_style.R", "inst/extdata/journal_sources.csv")) > 0
  origin <- list(kind = "source", commit = if (length(commit)) commit else NULL,
                 uncommitted_changes = dirty)
} else {
  if (!requireNamespace("causalverse", quietly = TRUE) ||
      !exists("journal_style", envir = asNamespace("causalverse"))) {
    stop("No causalverse checkout at '", cv_path, "' and the installed causalverse has no journal_style(). ",
         "Pass the checkout path: Rscript scripts/build-journals.R /path/to/causalverse")
  }
  ns <- asNamespace("causalverse")
  sources_csv <- system.file("extdata", "journal_sources.csv", package = "causalverse")
  origin <- list(kind = "installed", version = as.character(utils::packageVersion("causalverse")))
}

journal_style <- get("journal_style", envir = ns)
journal_list  <- get("journal_list", envir = ns)
format_caption <- get(".format_caption", envir = ns)
star_note <- get(".star_note", envir = ns)
verified <- get(".jstyle_verified", envir = ns)
sources <- utils::read.csv(sources_csv, stringsAsFactors = FALSE)

# JSON helpers: keep arrays as arrays (I()), named numeric vectors as objects,
# and Inf / NULL as null.
arr <- function(x) if (is.null(x)) I(character()) else I(unname(x))
obj <- function(x) as.list(x)
num <- function(x) if (is.null(x) || !is.finite(x)) NULL else x

journal_json <- function(id) {
  st <- journal_style(id)
  t <- st$table
  f <- st$figure
  src <- sources[sources$journal_id %in% c(id, paste0("publisher:", st$artwork), paste0("family:", st$family)), ]
  thr <- sort(t$stars)
  marker <- if (is.null(t$insert_marker)) NULL else sub("{n}", "1", t$insert_marker, fixed = TRUE)
  list(
    id = st$id, name = st$name, abbrev = st$abbrev, publisher = st$publisher,
    lists = arr(st$lists), family = st$family, artwork = st$artwork,
    confidence = st$confidence, verified = st$verified, caveats = arr(st$caveats),
    table = list(
      significance = t$significance,
      stars = if (t$significance == "stars")
        I(lapply(seq_along(thr), function(i) list(symbol = names(thr)[i], p = unname(thr[i])))) else I(list()),
      star_note = t$star_note,
      star_note_text = if (t$significance == "stars") arr(star_note(t)) else I(character()),
      tails = t$tails,
      uncertainty = t$uncertainty,
      leading_zero = t$leading_zero,
      digits = as.integer(t$digits), p_digits = as.integer(t$p_digits),
      numbering = t$numbering, label = t$label,
      caption = t$caption,
      caption_example = format_caption("table", 1, "Title", st)$text_oneline,
      notes_order = arr(t$notes_order), note_label = t$note_label,
      specific_marks = t$specific_marks, panel_label = t$panel_label,
      placement = t$placement, insert_marker = t$insert_marker, insert_marker_example = marker,
      max_columns = num(t$max_columns), vertical_rules = isTRUE(t$vertical_rules),
      formats = arr(t$formats)
    ),
    figure = list(
      formats_initial = arr(f$formats_initial), formats_final = arr(f$formats_final),
      vector_preferred = isTRUE(f$vector_preferred), vector_required = isTRUE(f$vector_required),
      dpi = obj(f$dpi), widths_mm = obj(f$widths_mm), widths_generic = isTRUE(f$widths_generic),
      font_family = f$font_family, min_font_pt = f$min_font_pt, max_font_pt = f$max_font_pt,
      title_in_image = isTRUE(f$title_in_image),
      label = f$label, numbering = f$numbering, caption_position = f$caption_position,
      caption_example = format_caption("figure", 1, "Title", st)$text_oneline,
      panel_label = f$panel_label,
      grayscale = isTRUE(f$grayscale), gray_range = arr(f$gray_range), gray_step = f$gray_step,
      max_series = num(f$max_series),
      alt_text = isTRUE(f$alt_text), alt_text_label = f$alt_text_label,
      source_data = isTRUE(f$source_data), color_print = f$color_print
    ),
    sources = I(lapply(seq_len(nrow(src)), function(i) list(scope = src$scope[i], url = src$url[i])))
  )
}

jl <- journal_list("all")
snapshot <- list(
  generator = "scripts/build-journals.R",
  registry = c(list(package = "causalverse", verified = verified), origin),
  lists = list(
    ft50_2026 = "FT50 after the April 2026 revision (current FT50)",
    ft50_2016 = "FT50 as published in 2016",
    utd24 = "UT Dallas 24"
  ),
  journals = lapply(jl$id, journal_json)
)

json <- jsonlite::toJSON(snapshot, auto_unbox = TRUE, null = "null", na = "null", digits = NA, pretty = TRUE)
writeLines(json, out_file, useBytes = TRUE)
conf <- table(jl$confidence)
message(sprintf("Wrote %s: %d journals (%s), registry verified %s, from %s%s.",
                out_file, nrow(jl), paste(names(conf), conf, sep = " ", collapse = ", "), verified,
                if (from_source) paste0("causalverse checkout ", cv_path) else "installed causalverse",
                if (isTRUE(origin$uncommitted_changes)) " (with uncommitted registry changes)" else ""))
