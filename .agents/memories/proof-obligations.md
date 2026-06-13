# Proof Obligations

Permanent, abstract obligations the app must fulfill. The test suite exists to prove exactly these; every test must trace to one obligation. Tests use real content fixtures and real pandoc — no mocks, no skips (see global test-guidelines).

## O1 — Classification totality and exclusivity

Every file under `content/` is classified into exactly one of: `reserved` (underscore-prefixed control paths), `page` (markdown with `site.page: true` frontmatter), `asset` (everything else, including non-opt-in markdown), `opaque` (files inside declared passthrough subtrees). Non-opt-in markdown is never compiled. Files inside opaque subtrees are never compiled even if they carry the page marker.

## O2 — Deterministic, injective routing

- `content/index.md` → `dist/index.html`
- `content/foo.md` → `dist/foo/index.html`
- `content/a/b/index.md` → `dist/a/b/index.html`
- A page may override its route only via a validated `site.route` field.
- Two sources claiming one output path = build failure (page/page and page/asset collisions both detected), with both sources named.

## O3 — Fail-fast schema validation

Opt-in pages declare `site.schema`. Unknown schema id, missing required fields, or unknown fields → build fails naming the file and the violation. Non-opt-in markdown is never validated. A failing page fails the whole build (no partial output).

## O4 — Content-mirror fidelity

Every non-reserved asset file appears byte-identical in `dist/` at the same relative path. Opaque subtrees are copied verbatim with structure preserved. No reserved file leaks into `dist/`.

## O5 — Rendering contract

Each page renders to standalone HTML through pandoc using its type's template: title present, body markdown converted (headers, emphasis, links), TeX math wrapped for MathJax, site-wide math macros from `content/_data/math-macros.yaml` injected into the page head exactly once.

## O6 — Manifest as single contract

Build emits `site-manifest.json` enumerating every route (source, url, output, type, schema) and every passthrough copy. Manifest ↔ `dist/` is a bijection: every emitted file is accounted for, every manifest entry exists on disk.

## O7 — Navigation integrity

Nav comes from `content/_data/navigation.toml`. Every internal nav target must resolve to a manifest route (or be declared external) or the build fails. Rendered pages contain the nav links.

## O8 — Directory-inferred defaults

`content/_site.toml` maps directory globs to page types (template + schema). A page in a mapped directory needs only `site.page: true` plus the schema's required fields; type/template are inferred. Explicit frontmatter beats inference.

## O9 — CLI scaffolding and build entry

`ssg build` runs the full pipeline. `ssg new post "Title"` (and analogous scaffolds) produce files that pass validation and build without edits. Scaffolds and builds go through the same compiler path.

## O10 — Transclusion safety (stretch)

`:::{.include path=...}` splices pandoc-parsed blocks from the referenced file. Paths escaping `content/` are a build failure.

## O11 — Data-backed components

A `::: {.component type="T" ...}` fenced div is expanded by a pandoc Lua filter into HTML built from `content/_data/items.yaml` (passed to the filter as a JSON sidecar referenced by the `items_path` metadata field, so embedded card markdown is not mangled by pandoc's metadata parser). All data-backed components reference their collection via a uniform `items="KEY"` attribute. `type="feature-row"` renders a `.feature-row` grid of `.feature-card`s; each card's `excerpt` is rendered as markdown and `title` as inline markdown (so card titles may carry math); a card with empty `url` emits no link. `type="gallery"` renders a `.gallery` of `.gallery__item` figures, each an `image_path` thumbnail linking to its full `url`, with an optional `title` figcaption. An unknown component type or a missing data key aborts the build (`BuildError kind=pandoc`). Implemented in `pandoc/filters/components.lua`; the `/writing/` (feature-row) and `/talks/` (gallery) migrations are its stress tests.

## O12 — Internal link integrity (manifest-consuming)

A link checker consumes the built `dist/` plus the manifest and reports every
broken site-internal link: any `href`/`src` beginning with `/` in rendered
HTML that resolves to neither a manifest route url, a passthrough output, nor
an existing file under `dist/`. External links (`http(s):`, `mailto:`,
protocol-relative `//`), in-page fragments (`#…`), and empty hrefs are out of
scope. Reporting is non-fatal to `build`; `ssg check` exits nonzero when any
internal link is broken (CI gate). Each broken link is reported with its
source page and target.

## O13 — Preview server

`ssg serve --out DIR [--port N]` serves a built `dist/` over HTTP: a request
for `/p/` returns the bytes of `dir/p/index.html` with a `text/html`
content-type, `/` returns `dir/index.html`, a real asset path returns its
bytes with a sensible content-type, and an unknown path returns 404. The
server is a thin static file server over the already-built tree; it neither
compiles nor mutates `dist/`.

## O14 — Structural site validation

A manifest-driven validator (`src/validate.ts`) checks every rendered route's
output HTML for issues a successful build does not catch: `missing-doctype`,
`missing-main`, `empty-title`, `leftover-liquid` (`{% … %}` survived
migration), `leftover-kramdown` (`{: … }` survived). `ssg check` runs this
alongside the O12 link check and exits nonzero if either reports anything, so a
content repo's `just check` is a single strong gate before pushing/deploying.

## O15 — Browser-level verification

`ssg verify` builds, starts the preview server, and drives a headless Chromium
(`src/verify.ts`, Playwright) over every manifest route, reporting runtime
defects no static check catches: `http-error`, `missing-main`, `missing-nav`,
`unresolved-markup` (Liquid/kramdown visible in the live DOM), `mathjax-error`
(`<mjx-merror>` — e.g. an undefined macro), `console-error` (genuine JS errors;
failed-subresource noise is filtered), `page-error` (uncaught exceptions).
Navigation uses `domcontentloaded` (real pages embed never-idle iframes) with a
bounded settle only when math is present. Playwright is an optional peer
dependency (dynamic import → actionable BuildError if absent), so the lean
kernel never forces a browser on consumers; a content repo adds playwright to
use `verify`.

## O16 — Interactive blog-index island (Svelte/Vite)

A `::: {.component type="blog-index"}` fenced div is the first **interactive
island**: a client-hydrated Svelte component, not static Lua-rendered HTML. The
build, when (and only when) a page uses this component:

- emits `dist/blog/posts.json` enumerating every `blog-post.v1` page's metadata
  (`title`, `date`, `url`, `tags`), ordered newest-`date`-first;
- bundles the SSG-owned island source (`islands/blog-index/`) via Vite + the
  Svelte plugin into a stable, self-contained ES module at
  `dist/assets/islands/blog-index.js` (no content hash — the Lua filter emits a
  fixed script src);
- the Lua filter (`components.lua`, `type="blog-index"`) expands the placeholder
  into a mount point `<div id="blog-index" data-posts="/blog/posts.json">` plus
  `<script type="module" src="/assets/islands/blog-index.js">`.

The island fetches its `data-posts` URL and renders a post list with
**client-side search plus tag and category filtering** (two distinct facets —
the replacement for the dropped tag/year/category archive pages). `blog-post.v1`
carries optional `tags` and `categories` (string[] each); both flow into
`posts.json` and become facets in the island. Both generated files are recorded in a new
manifest dimension `generated[]` so O6's bijection still holds
(`dist == manifest.json ∪ routes ∪ passthrough ∪ generated`); O12 resolves their
internal links as on-disk files. Vite + svelte are **optional peer
dependencies** (dynamic import, like Playwright for O15): a build that uses the
component without them installed fails loudly with an actionable BuildError; a
build that never uses the component never imports them.

Linked: [requirements](requirements.md), [architecture](architecture.md).
