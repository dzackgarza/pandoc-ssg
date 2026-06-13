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

## Still remaining

- **DECISION — asset migration**: `ssg check` reports the writing/talks pages' unresolved `/assets/*` links. The source `assets/` tree is **385M** and `_pages/math_journal` is **32M** — deliberately NOT vendored into this generator repo. Options for the user: (a) keep generator repo lean, treat content/ as a curated showcase; (b) vendor the full site; (c) point the SSG at an external content root (the website tree) instead of vendoring. `ssg check` is the ledger of what's unresolved.
- Remaining simple v2018 pages (teaching, advice, tutoring, GOATS [splash header], activities, grad_resources, etc.) + a homepage — bulk content migration, no new kernel features; available on request.
- Islands (typed interactive components / hydration) — not yet needed by migrated content.
- GitHub remote + code scanning for the installed review workflows — outward-facing; needs user go-ahead.
- Manifest dependency tracking for incremental rebuilds (transclusion deps).
