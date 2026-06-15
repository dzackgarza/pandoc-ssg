# Proof Obligations

Permanent, abstract obligations the app must fulfill.
The test suite exists to prove exactly these; every test must trace to one obligation.
Tests use real content fixtures and real pandoc — no mocks, no skips (see global test-guidelines).

## O1 — Classification totality and exclusivity

Every file under `content/` is classified into exactly one of: `reserved` (underscore-prefixed control paths), `page` (markdown with `site.page: true` frontmatter), `asset` (everything else, including non-opt-in markdown), `opaque` (files inside declared passthrough subtrees).
Non-opt-in markdown is never compiled.
Files inside opaque subtrees are never compiled even if they carry the page marker.

## O2 — Deterministic, injective routing

- `content/index.md` → `dist/index.html`
- `content/foo.md` → `dist/foo/index.html`
- `content/a/b/index.md` → `dist/a/b/index.html`
- A page may override its route only via a validated `site.route` field.
- Two sources claiming one output path = build failure (page/page and page/asset collisions both detected), with both sources named.

## O3 — Fail-fast schema validation

Opt-in pages declare `site.schema`. Unknown schema id, missing required fields, or unknown fields → build fails naming the file and the violation.
Non-opt-in markdown is never validated.
A failing page fails the whole build (no partial output).

## O4 — Content-mirror fidelity

Every non-reserved asset file appears byte-identical in `dist/` at the same relative path.
Opaque subtrees are copied verbatim with structure preserved.
No reserved file leaks into `dist/`.

## O5 — Rendering contract

Each page renders to standalone HTML through pandoc using its type's template: title present, body markdown converted (headers, emphasis, links), TeX math wrapped for MathJax, site-wide math macros from `content/_data/math-macros.yaml` injected into the page head exactly once.
MathJax loads on every page (not gated on the page containing pandoc-level math, so island-authored math still typesets), and its config recognizes **both** `$…$` and `\(…\)` inline (and `$$…$$` / `\[…\]` display) delimiters — one math path for page content and island data alike.
The `normalize_math` filter (ported from `~/.pandoc`) normalizes displayed equations into `align*` environments (`align` when a `\label` is present), not bare `\[ \]`; inline math stays pandoc's `\( \)`.

## O6 — Manifest as single contract

Build emits `site-manifest.json` enumerating every route (source, url, output, type, schema) and every passthrough copy.
Manifest ↔ `dist/` is a bijection: every emitted file is accounted for, every manifest entry exists on disk.

## O7 — Navigation is config-driven

Nav is pure config: `content/_data/navigation.toml` declares an ordered list of `[[main]]` entries (`title`, `href`, `weight`). The SSG's only job is to validate that config's *shape* (malformed TOML or an unknown/missing field → `BuildError kind=nav`, fail loud) and expose it as the pandoc `nav` template variable, ordered by `weight`; the template's `$for(nav)$` populates the navbar.
The build does **not** gate nav *targets* — an `href` may point at an on-site route, a passthrough asset (e.g. a CV PDF), or an off-site URL. Nav-link **integrity** is not special-cased: it is covered by the general link checker (O12), which resolves every rendered link (nav included) against routes + passthrough + on-disk files and is surfaced by `ssg check`. Rendered pages contain the nav links.

## O25 — Blog-post table of contents

A blog post (`blog-post.v1`, rendered via `blog.html`) emits an in-page **table of contents** built by pandoc's own `--toc` (`toc: true`, `toc-depth: 3` in `blog.yaml`), wrapped by the template in a `<nav class="post-toc">`. The TOC lists the post's body headings down to **level 3** with links to their auto-generated in-page anchors (`href="#heading-slug"`); a level-4+ heading still renders in the body (with its id) but is **not** listed in the TOC. Only blog posts get a TOC — ordinary pages (`page.html`) carry no `post-toc`. This is pandoc templating, not SSG logic: the generator only sets the defaults and the template variable.

## O8 — Directory-inferred defaults

`content/_site.toml` maps directory globs to page types (template + schema).
A page in a mapped directory needs only `site.page: true` plus the schema's required fields; type/template are inferred.
Explicit frontmatter beats inference.

## O9 — CLI scaffolding and build entry

`ssg build` runs the full pipeline.
`ssg new post "Title"` (and analogous scaffolds) produce files that pass validation and build without edits.
Scaffolds and builds go through the same compiler path.

## O10 — Transclusion safety (stretch)

`:::{.include path=...}` splices pandoc-parsed blocks from the referenced file.
Paths escaping `content/` are a build failure.

## O11 — Data-backed components

A `::: {.component type="T" ...}` fenced div is expanded by a pandoc Lua filter into HTML built from `content/_data/items.yaml` (passed to the filter as a JSON sidecar referenced by the `items_path` metadata field, so embedded card markdown is not mangled by pandoc's metadata parser).
All data-backed components reference their collection via a uniform `items="KEY"` attribute.
`type="feature-row"` renders a `.feature-row` grid of `.feature-card`s; each card's `excerpt` is rendered as markdown and `title` as inline markdown (so card titles may carry math); a card with empty `url` emits no link.
An unknown component type or a missing data key aborts the build (`BuildError kind=pandoc`). Implemented in `pandoc/filters/components.lua`; the `/writing/` (feature-row) migration is its stress test.
(Media grids are O23 `media-gallery`, which superseded the original `gallery`.)

## O12 — Internal link integrity (manifest-consuming)

A link checker consumes the built `dist/` plus the manifest and reports every broken site-internal link: any `href`/`src` beginning with `/` in rendered HTML that resolves to neither a manifest route url, a passthrough output, nor an existing file under `dist/`. External links (`http(s):`, `mailto:`, protocol-relative `//`), in-page fragments (`#…`), and empty hrefs are out of scope.
Reporting is non-fatal to `build`; `ssg check` exits nonzero when any internal link is broken (CI gate).
Each broken link is reported with its source page and target.

## O13 — Preview server

`ssg serve --out DIR [--port N]` serves a built `dist/` over HTTP: a request for `/p/` returns the bytes of `dir/p/index.html` with a `text/html` content-type, `/` returns `dir/index.html`, a real asset path returns its bytes with a sensible content-type, and an unknown path returns 404. The server is a thin static file server over the already-built tree; it neither compiles nor mutates `dist/`.

## O14 — Structural site validation

A manifest-driven validator (`src/validate.ts`) checks every rendered route's output HTML for issues a successful build does not catch: `missing-doctype`, `missing-main`, `empty-title`, `leftover-liquid` (`{% … %}` survived migration), `leftover-kramdown` (`{: … }` survived).
`ssg check` runs this alongside the O12 link check and exits nonzero if either reports anything, so a content repo's `just check` is a single strong gate before pushing/deploying.

## O15 — Browser-level verification

`ssg verify` builds, starts the preview server, and drives a headless Chromium (`src/verify.ts`, Playwright) over every manifest route, reporting runtime defects no static check catches: `http-error`, `missing-main`, `missing-nav`, `unresolved-markup` (Liquid/kramdown visible in the live DOM), `mathjax-error` (`<mjx-merror>` — e.g. an undefined macro), `console-error` (genuine JS errors; failed-subresource noise is filtered), `page-error` (uncaught exceptions).
Navigation uses `domcontentloaded` (real pages embed never-idle iframes) with a bounded settle only when math is present.
Playwright is an optional peer dependency (dynamic import → actionable BuildError if absent), so the lean kernel never forces a browser on consumers; a content repo adds playwright to use `verify`.

## O16 — Interactive blog-index island (Svelte/Vite)

A `::: {.component type="blog-index"}` fenced div is the first **interactive island**: a client-hydrated Svelte component, not static Lua-rendered HTML. The build, when (and only when) a page uses this component:

- emits `dist/blog/posts.json` enumerating every `blog-post.v1` page's metadata (`title`, `date`, `url`, `tags`), ordered newest-`date`-first;
- bundles the SSG-owned island source (`islands/blog-index/`) via Vite + the Svelte plugin into a stable, self-contained ES module at `dist/assets/islands/blog-index.js` (no content hash — the Lua filter emits a fixed script src);
- the Lua filter (`components.lua`, `type="blog-index"`) expands the placeholder into a mount point `<div id="blog-index" data-posts="/blog/posts.json">` plus `<script type="module" src="/assets/islands/blog-index.js">`.

The island fetches its `data-posts` URL and renders a post list with **client-side search plus tag and category filtering** (two distinct facets — the replacement for the dropped tag/year/category archive pages).
`blog-post.v1` carries optional `tags` and `categories` (string[] each); both flow into `posts.json` and become facets in the island.
Both generated files are recorded in a new manifest dimension `generated[]` so O6's bijection still holds (`dist == manifest.json ∪ routes ∪ passthrough ∪ generated`); O12 resolves their internal links as on-disk files.
Vite + svelte are **optional peer dependencies** (dynamic import, like Playwright for O15): a build that uses the component without them installed fails loudly with an actionable BuildError; a build that never uses the component never imports them.

## O17 — Embed components (attribute-driven, no data sidecar)

Some components carry their content inline as fenced-div attributes rather than keys into `_data/items.yaml`. `type="video"` with `provider` + `id` attributes expands (in `components.lua`) to a responsive iframe embed: `provider="youtube"` → `https://www.youtube.com/embed/<id>` inside a `.responsive-embed` wrapper.
An unknown `provider`, or a missing `id`, aborts the build (`BuildError kind=pandoc`) — fail loud, no silent skip.
This is the migration target for Jekyll's `{% include video id=… provider=… %}`.

## O18 — Theme asset emission

The site's visual identity lives in the generator's design layer, not content.
Every build copies the design layer's static theme tree (`<pandocDir>/assets/**` — the stylesheet `theme/site.css` and its self-hosted woff2 fonts) byte-identical into `dist/assets/**`, and records each emitted file in `manifest.generated` (kind `theme`) so O6's bijection still holds.
Every rendered page links the stylesheet (`<link rel="stylesheet" href="/assets/theme/site.css">`) via its template.
Emission is unconditional (every page needs the stylesheet), unlike the blog-index island (O16) which emits only when used.
The theme is grounded in measured computed styles from a reference mathematical-research site (serif body, geometric-sans headings, near-monochrome with one deep-navy link color, wide reading measure, whitespace over rules) — not in guessed values.

## O19 — Deploy (generate + mirror to a directory)

`ssg deploy DIR` runs the full build, then mirrors the built `dist/` into the target directory `DIR` with `rsync -a --delete`: every built file appears in `DIR` byte-identical, and any file in `DIR` that is not in the build is removed (no stale artifacts from prior deploys).
The deploy surface is exactly this — a local directory mirror; the tool does not configure web servers, remote hosts, or DNS (the user owns those).
rsync is a required external dependency; a missing rsync or a nonzero rsync exit fails loudly (`BuildError kind=deploy`), never a partial or silent copy.

## O20 — Filterable collection island

`::: {.component type="collection" items="KEY"}` is an interactive island that renders the `items.yaml` array under `KEY` as a **quiet filterable list** (the Notes index that folds Writing+Talks): client-side search + category facet + tag facet, rendered as a restrained list — each item is `{title, category, description, tags[], links[]{label,href}}`: the title is a plain label and each link renders as its own labeled anchor (e.g. PDF · HTML), preserving every artifact (format mirrors, multi-instructor note sets) — NOT cards/badges/tag-pills (per AESTHETIC-GUIDELINES). Item titles/descriptions may carry math; the island re-typesets its rendered DOM with the page's MathJax (the one math path) on hydration and after each filter change, since it mounts after MathJax's startup pass.
The build emits `dist/_collections/KEY.json` for each referenced key (unknown key → `BuildError kind=config`), bundles the shared `collection` Svelte island to `assets/islands/collection.js` (the generalized `buildIsland`, optional vite/svelte peer deps), and records both in `manifest.generated`. The Lua filter emits the mount + module script.
Shares the island machinery with the blog-index (O16).

## O21 — Timeline component (restrained dated list)

`::: {.component type="timeline" items="KEY"}` is a static (Lua-rendered) data-backed component for **teaching and activities**: it renders the `items.yaml` array under `KEY` as a **clean dated list**, NOT an icon/card visual timeline (per AESTHETIC-GUIDELINES and [[redesign-spike-reconciliation]]). The placeholder expands to a `<ul class="timeline">` of `<li class="timeline__entry">` items, one per data entry **in authored order** (the data is already ordered; the filter does not re-sort — the author owns chronology).
Each entry carries a `<span class="timeline__date">` (the entry's `date`, escaped plain text — the defining field) and a `<span class="timeline__title">` rendered as **inline markdown** (so titles may carry emphasis/math/links).
An optional `detail` renders as inline markdown in a `<span class="timeline__detail">`, emitted only when present (no empty span, no broken empty link).
An entry with an empty/missing `date` aborts the build (`BuildError kind=pandoc`) — a timeline without dates is a content error, fail loud.
An unknown items key aborts the build the same way, as with every data-backed component (O11). Shares the `_data/items.yaml` JSON-sidecar machinery with feature-row/gallery (O11).

## O22 — Papers component (bibliographic list, expandable abstracts)

`::: {.component type="papers" items="KEY"}` is a static (Lua-rendered) data-backed component for the publications page: it renders the `items.yaml` array under `KEY` as a **restrained bibliographic list, NOT cover-image cards** (per AESTHETIC-GUIDELINES §6 "program first, bibliography second", which wins on conflict — class names `paper`/`paper-title`/`paper-meta`/`abstract-toggle`/`abstract` come from that doctrine).
The placeholder expands to a `<ul class="papers">` of `<li class="paper">` items, one per entry **in authored order**. Each entry:

- `<span class="paper-title">` — the entry's `title`, rendered as **inline markdown** (math/emphasis capable).
  An empty/missing `title` aborts the build (`BuildError kind=pandoc`); a paper without a title is a content error.
- `<div class="paper-meta">` — the bibliographic line: the present fields among `authors`, `year`, `venue`, and the arXiv link, joined by `·`. Absent fields are skipped (no leading, trailing, or doubled separators).
  `arxiv` may be a bare id (`2312.03638` → link `https://arxiv.org/abs/2312.03638`, text `arXiv:2312.03638`) or a full URL (linked verbatim, text `arXiv`).
- `<details class="paper-abstract">` with a `<summary class="abstract-toggle">` and the `abstract` rendered as **block markdown** inside `<div class="abstract">` — a native JS-free expandable abstract, emitted **only when** `abstract` is present (an entry without one emits no `<details>`).

An unknown items key aborts the build the same way (O11). Shares the `_data/items.yaml` JSON-sidecar machinery with feature-row/timeline.

## O23 — Media-gallery component (static media grid; supersedes gallery)

`::: {.component type="media-gallery" items="KEY"}` is a static (Lua-rendered) data-backed component that **replaces the original `gallery`** (O11). It renders the `items.yaml` array under `KEY` as a restrained `<div class="media-gallery">` grid of `<figure class="media-gallery__item">`, one per item **in authored order**. Per the binding decision, it is a **static grid with no client-side filter** (filters are the wrong atmosphere for a math-research site, per AESTHETIC-GUIDELINES, which wins on conflict); each item's optional `tags` are emitted only as a `data-tags` attribute (space-joined) — carried as data, never an interactive filter, and no island bundle is referenced.
Each item has a `type`:

- `type="image"` → `<img class="media-gallery__image" src=… alt=…>`; an optional `href` wraps the image in a `<a class="media-gallery__link">` (no empty link when absent).
- `type="video"` → reuses the O17 YouTube embed (`provider` + `id` → a `.responsive-embed` iframe) inside the figure — one embedding path (OSOT).

An optional `caption` renders as inline markdown in a `<figcaption class="media-gallery__caption">`. An unknown (or missing) item `type`, or an unknown items key, aborts the build (`BuildError kind=pandoc`). `/talks/` migrates from `gallery` to `media-gallery` at the content-wiring step.

## O24 — Link-group component (curated external links)

`::: {.component type="link-group" items="KEY"}` is a static (Lua-rendered) data-backed component for curated **external** link lists (the Writing/Notes page).
Unlike the array-shaped data-backed components, `items[KEY]` is a **group object**: `{ title?, description?, links: [ { label, href, note? } ] }`. It renders a restrained `<section class="link-group">` (understated titled list, NOT cards/icon grids, per AESTHETIC-GUIDELINES): an optional `<h2 class="link-group__title">` (when `title` present), an optional `<p class="link-group__description">` (inline markdown), and a `<ul class="link-group__links">` with one `<li class="link-group__link">` per link **in authored order** — an `<a href>` around the `label` (inline markdown) and, when present, a `<span class="link-group__note">` (inline markdown) after an em-dash separator.
A link with an empty/missing `href` aborts the build (`BuildError kind=pandoc`) — a link group's purpose is working links, so a targetless link is a content error.
An unknown items key aborts the build the same way.

Linked: [requirements](requirements.md), [architecture](architecture.md).

## O26 — MathJax macros are extracted live, never vendored

The site-wide MathJax macro set is generated at every build from the author's canonical LaTeX macro sources — never stored in the SSG or content.
A declarative manifest (`~/.pandoc/styles/macros/mathjax-sources.txt`, the bundled CLI default for `--mathjax-macros`; overridable) declares *which* `.tex` files feed MathJax.
The SSG bundles a vendored extraction *script* (`pandoc/bin/extract_mathjax_macros.py`, PEP723/uv) that parses `\newcommand`/`\def`/`\DeclareMathOperator` and emits the MathJax 3 `tex.macros` map (string body, or `[body, nargs]` for arg-macros) to stdout.
`build.ts generateMathMacros` runs it each build and fails loudly on any error (missing uv/script/manifest/listed file, or malformed output) — no silent empty fallback.
The `~/.pandoc` recipe (`generate-mathjax-config.py`) reads the **same** manifest (no hard-coded filename tuple), so both consumers stay in lock-step.
**Why this obligation exists:** the live derived-AG page rendered the author's globals (`\GG`/`\et`/`\spec`/`\tensor`) as literal text because the build injected a vendored 12-macro `_data/math-macros.yaml`; the live source has 1476. The vendored yaml is deleted from both repos.

## O27 — Rendered-math QC gate; deploy refuses broken pages

Undefined macros do NOT raise `<mjx-merror>` in MathJax v3 — they render as a literal `\controlSequence` inside the container (61/154 on the live derived-AG page, all undetected by the prior merror-only check).
`verifySite` (O15) now scans every rendered `mjx-container`/`span.math` for a leftover `\[a-zA-Z]+` and reports an `undefined-macro` finding; correctly typeset math is glyph-only.
`ssg deploy` browser-verifies the built tree and **aborts (exit 1, nothing published)** on any verify finding — broken pages cannot reach the live web root.

Linked: [requirements](requirements.md), [architecture](architecture.md).

## O28 — tikzcd/tikzpicture diagrams render to inline SVG

q.uiver/tikz diagrams are authored as `\begin{tikzcd}...\end{tikzcd}` (and `\begin{tikzpicture}`) blocks.
Pandoc parses them as raw-LaTeX RawBlocks that the HTML writer silently drops, so the diagrams vanish.
The build runs the author's canonical `~/.pandoc/filters/tikzcd.lua` (added to the defaults filter chain after transclude, referenced live via `${HOME}`), which compiles each block (pdflatex → pdf2svg, hash-cached in `~/.pandoc/figures/rendered/`) and inlines the SVG (`<div><span class="tikzcd">…<svg>…</svg></span></div>`). `pandoc.ts` sets `PANDOC_DIR=~/.pandoc` in the pandoc subprocess so the filter finds its standalone template + TikZ styles.
Build dependency: `pdflatex` + `pdf2svg`. The filter got a one-line pandoc-3.6 compat fix (render the Doc from `template.apply` to a string).

Linked: [requirements](requirements.md), [architecture](architecture.md).
