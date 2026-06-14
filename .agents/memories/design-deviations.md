# Deviations from the Original Design Rationale

`Static-Site-Generator-Design.md` is the original design *vision* (tool comparisons,
schema proposals, illustrative component syntax). The shipped system — recorded
concretely in [proof-obligations](proof-obligations.md) and [architecture](architecture.md)
— deviated from it in the following deliberate ways. This note exists because the design
doc was intentionally **not** rewritten to match the implementation; it is kept as the
original rationale, and the deltas live here.

## Components: rich declarative attributes → one `items="KEY"` data binding

- **Design** proposed per-component attribute vocabularies, e.g.
  `:::{.component type="collection" source="notes" tag="expository" layout="card-scroller" limit="12"}`
  and `:::{.component type="gallery-grid" gallery="teaching-photos" columns="3"}`.
- **Shipped**: every data-backed component uses the same minimal contract —
  `:::{.component type="TYPE" items="KEY"}` — pointing at one array under `KEY` in
  `_data/items.yaml` (the O11 JSON-sidecar pattern). No `source`/`tag`/`layout`/`limit`/
  `columns` attributes; filtering is a *client-side* concern of the island, not declared
  in the fence.
- **Why**: one uniform binding (O11) is far smaller surface than a bespoke attribute
  grammar per component, and the facets the design encoded as attributes (`tag`, `limit`)
  are runtime UI state, not authoring data.

## Card layouts → restrained quiet lists (AESTHETIC won)

- **Design** assumed card/scroller visuals (`layout="card-scroller"`,
  `data-island="card-scroller"`).
- **Shipped**: the collection (O20) and every component render as quiet lists — NO
  cards, badges, tag-pills, shadows, or scrollers.
- **Why**: `AESTHETIC-GUIDELINES.md` (a measured, daniellitt-grounded mathematical-research
  aesthetic) **wins on every conflict**. Cards/scrollers create a SaaS/portfolio
  atmosphere the doctrine forbids. See [[redesign-spike-reconciliation]] — the
  card-heavy spike (`garza-academic-hub`) was a failed spike; only its IA was pulled,
  filtered through the aesthetic.

## Schema layer: elaborate registry → one `page.v1`

- **Design** proposed Zod page-type schemas `page.v1`/`blog-post.v1`/`seminar.v1`/
  `collection-page.v1`/`passthrough.v1` plus generated `.generated/schemas/*.json`,
  `component-registry.json`, `content-reference.json`.
- **Shipped**: a single `page.v1` schema (O3); blog posts are pages with a date/route,
  not a distinct page-type; no `seminar`/`collection-page` page-types; no generated
  schema artifacts.
- **Why**: collections/galleries/timelines are *data-backed components inside pages*, not
  page-types, so the page-type proliferation and the generated-schema tooling were
  unneeded for the shipped scope.

## Pandoc filter chain + math: link checking moved to TS; one MathJax path added

- **Design** showed a `links.lua` filter in the chain and `metadata-files:
  site.yaml/mathjax.yaml`.
- **Shipped**: filter chain is `transclude → components → normalize_math` (no
  `links.lua`); link integrity is a TypeScript, manifest-consuming checker (O12) surfaced
  by `ssg check`, not a Lua filter. MathJax config is injected via the template
  (`mathjax_config`) built from `_data/math-macros.yaml`, not a metadata-file. Beyond the
  design's "macros merged/validated" note, the implementation added a single MathJax path
  (O5): MathJax always loads, its config reads both `$…$` and `\(…\)`, `normalize_math`
  wraps display math in `align*`, and islands re-typeset their own DOM (so island-authored
  math renders) — none of which the design specified.
- **Why**: link integrity needs the full route+passthrough+on-disk manifest (a TS concern,
  O12), not per-document Lua; the math-path work was forced by real content (island titles
  carrying `$…$`, display equations needing `align`) discovered during content migration.

## Nav: route-only gate → no gate (O7 reframe)

- **Design/early impl** gated nav `href`s to resolvable routes.
- **Shipped** (O7): the build validates only the nav config's *shape*; `href` may be a
  route, a passthrough asset (CV PDF), or an off-site URL. Nav-link integrity is delegated
  to the general link checker (O12).
- **Why**: real nav legitimately points at non-route targets (a CV PDF, external
  profiles); a route-only gate is wrong, and integrity is already covered by O12.
