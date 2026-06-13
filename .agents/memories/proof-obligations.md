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

A `::: {.component type="T" ...}` fenced div is expanded by a pandoc Lua filter into HTML built from `content/_data/items.yaml` (passed to the filter as a JSON sidecar referenced by the `items_path` metadata field, so embedded card markdown is not mangled by pandoc's metadata parser). `type="feature-row" items="KEY"` renders the named card collection as a `.feature-row` grid of `.feature-card`s; each card's `excerpt` is rendered as markdown and `title` as inline markdown (so card titles may carry math). A card with empty `url` emits no link. An unknown component type or a missing data key aborts the build (`BuildError kind=pandoc`). Implemented in `pandoc/filters/components.lua`; the writing-page migration is its stress test.

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

Linked: [requirements](requirements.md), [architecture](architecture.md).
