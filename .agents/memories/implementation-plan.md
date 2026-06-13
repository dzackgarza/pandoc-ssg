# Implementation Plan (2026-06-13)

TDD against [proof-obligations](proof-obligations.md). Red tests committed before implementations (separate red/green commits).

## Phase 0 — bootstrap (done by coordinator)

- git init, ai-review-ci QC scaffold (bun) + CI trigger workflows installed.
- package.json / tsconfig / directory skeleton / iwe memories.

## Phase 1 — red tests (Opus subagents, parallel; disjoint test files)

- Suite A: `tests/classify.test.ts`, `tests/routes.test.ts`, `tests/schemas.test.ts` (O1, O2, O3, O8) — pure-kernel obligations against fixture trees.
- Suite B: `tests/build.test.ts`, `tests/manifest.test.ts` (O4, O5, O6, O7) — end-to-end builds with real pandoc on fixtures.
- Suite C: `tests/cli.test.ts` (O9) — CLI behavior via real process invocation.
- Coordinator verifies each test fails for the right reason (missing feature), commits red.

## Phase 2 — green implementations (Opus subagents, sequential per dependency order)

1. Kernel core: config/scan/classify/schemas/routes (makes Suite A green).
2. Pipeline: pandoc invocation, templates/defaults, copy, manifest, nav (makes Suite B green). Includes authoring `pandoc/` defaults+templates+base partials.
3. CLI (makes Suite C green).

## Phase 3 — QC green + commit cadence

- `just test` (delegates to global bun QC chain) green where reasonable; bootstrap/red commits use `--no-verify` (user-authorized) since global hooks gate on QC.

## Phase 4 — done 2026-06-13 (component stress test + outstanding features)

- O11 data-backed component filter (`pandoc/filters/components.lua`): `feature-row` cards from `_data/items.yaml` via JSON sidecar.
- `/writing/` migrated from v2018 Jekyll as the stress test (11 card collections / 30 cards, math macros, notice fenced div); `tests/writing.test.ts` guards it.
- O10 transclusion filter (`pandoc/filters/transclude.lua`): `:::{.include path=...}`, content-root containment enforced.
- O12 link checker (`src/links.ts`) + `ssg check`; O13 preview server (`src/serve.ts`) + `ssg serve`. (O12/O13 implemented by Opus subagents, CLI wired by coordinator.)

Filter order in defaults: transclude → components.

Also done: `/talks/` migrated (gallery component, 9 galleries / 27 images, 16 notice divs); `gallery` component type added (O11). Standalone apps `persistent_homology` + `square_topologies` migrated as opaque passthrough via `content/_site.toml` (design step 6); real-content O4 guards in `tests/writing.test.ts`.

Resolved: generator/content split shipped — generator is content-free (pushed `dzackgarza/pandoc-ssg`), content lives in `dzackgarza-site-v2026` (full 385M assets via Git LFS, pinned generator dep). Homepage `/` migrated. O14 static validation + O15 browser verify added (see proof-obligations).

## The two real targets (per user, 2026-06-13)

1. **DONE** — Standalone markdown-backed (Jekyll-processed) pages migrated into `dzackgarza-site-v2026`: 15 `_pages` markdown pages (commit `de94911`) + 7 course landing pages declaring permalink routes + full `content/courses/` materials tree (commit `e6c0fd4`). Mechanical migration: Jekyll frontmatter → `site.page`/schema, `{% include %}` → components, `{: .notice}` → fenced divs, math macros, permalink → `site.route`. One residual broken link `/quals` left as a user content decision (create the page or repoint the link); not touched unprompted.
2. **DONE** — Blog creation + generation + aggregation. `ssg new post` scaffolds (O9). The aggregation is a **Svelte/Vite interactive island** (user chose this over a static list): O16 — build emits `blog/posts.json`, bundles `islands/blog-index/` to `assets/islands/blog-index.js`, Lua filter emits the hydration mount; client-side **search + tag + category** facets (replaces the dropped archives). O17 — `type="video"` embed component for `{% include video %}`. All 14 `_posts` migrated into `dzackgarza-site-v2026` (commit `c263e68`); full `ssg verify` is zero-findings across the whole site. Two generator bugs found+fixed during migration via TDD: O13 serve 404'd every route under a relative `--out ./dist` (normalize outDir); O15 unresolved-markup false-flagged `{%` inside code blocks (scan prose only). vite/svelte are optional peer deps. Only residual broken link sitewide is the pre-existing `/quals`.

**Scope corrections (do not reintroduce):**
- NO generated tag/year/category archive *pages*. The other repos dropped those entirely; the blog aggregation component (search/filter by tag/category) replaces them. Do not build per-tag/per-year static index pages.
- "Deploy" is NOT this tool's job. The tool produces a static `dist/`; a CLI command / just recipe pointed at that directory is the whole deploy surface. The USER handles web servers, remote hosting, DNS. Do not build deployment infra.
- Standalone HTML pages (PQ Classification, Semidirect Products, UCSD, Zotero report) and apps (MakeMeAQual, threejs, math_journal) are pure passthrough — `cp` into content/, copied verbatim (O4). Not "work", not migration.

**DONE — site theme (O18).** Moved off the bare/minimal-mistakes look to a restrained mathematical-research aesthetic, grounded in **measured** computed styles from daniellitt.com (not guessed — the prior ChatGPT analysis in AESTHETIC-GUIDELINES.md was rejected as speculation): serif body (self-hosted Noto Serif 16px/1.8, #575757) on off-white #fcfcfc, bold geometric-sans headings (self-hosted Jost, #222), underlined deep-navy #000475 links, ~720px measure, whitespace over rules, quiet components. `pandoc/assets/theme/` (site.css + woff2); build emits design-layer `assets/**` into dist (manifest.generated kind `theme`); templates link the stylesheet. Verified by screenshotting the rendered output, not by assertion. `/quals` deleted entirely (deprecated). Full `check` + browser `verify` are zero-findings.

Known follow-ups (not defects): several migrated pages carry multiple body `# ` section headings rendered as `<h1>` alongside the template title h1 — legitimate content structure, but a future content/template pass could demote body sections to `<h2>` for cleaner hierarchy. Lower priority: `toc` component and non-youtube video providers (vimeo) when content needs them; manifest dependency tracking; review CI workflows.
