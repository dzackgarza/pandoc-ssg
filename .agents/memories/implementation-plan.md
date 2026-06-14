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

- NO generated tag/year/category archive _pages_. The other repos dropped those entirely; the blog aggregation component (search/filter by tag/category) replaces them. Do not build per-tag/per-year static index pages.
- Deploy = local directory mirror only. `ssg deploy DIR` (O19) builds then `rsync -a --delete` into DIR (e.g. `/var/www/html`); that is the entire deploy surface. The USER still owns web servers, remote hosting, DNS — the tool never configures those. (Gotcha: this system's interactive `cp` is aliased to `cp -i`, so a manual `cp` deploy silently skips existing files; use `ssg deploy`, which rsyncs and removes stale files.)
- Standalone HTML pages (PQ Classification, Semidirect Products, UCSD, Zotero report) and apps (MakeMeAQual, threejs, math_journal) are pure passthrough — `cp` into content/, copied verbatim (O4). Not "work", not migration.

**DONE — site theme (O18).** Moved off the bare/minimal-mistakes look to a restrained mathematical-research aesthetic, grounded in **measured** computed styles from daniellitt.com (not guessed — the prior ChatGPT analysis in AESTHETIC-GUIDELINES.md was rejected as speculation): serif body (self-hosted Noto Serif 16px/1.8, #575757) on off-white #fcfcfc, bold geometric-sans headings (self-hosted Jost, #222), underlined deep-navy #000475 links, ~720px measure, whitespace over rules, quiet components. `pandoc/assets/theme/` (site.css + woff2); build emits design-layer `assets/**` into dist (manifest.generated kind `theme`); templates link the stylesheet. Verified by screenshotting the rendered output, not by assertion. `/quals` deleted entirely (deprecated). Full `check` + browser `verify` are zero-findings.

Follow-up dispositions (triaged with user 2026-06-15):

- **Body headings → REAL task.** Several migrated pages carry body `# ` section
  headings rendered as `<h1>` alongside the template title h1 (two competing h1s).
  Agreed solution (user): demote all body headings by one level **at render**, via
  pandoc `shift-heading-level-by: 1` in the defaults — not a content/per-page edit.
  Leaves the template `$title$` as the sole h1; body `#`→h2, `##`→h3, etc. Implement
  with a test + rendered verification; blog interaction with the O25 TOC (toc-depth 3)
  must be checked since shifting moves authored `##` to h3.
- **`toc` component → HALLUCINATED request (struck).** Never specified anywhere (not in
  the design doc, not an obligation); surfaced only as a stray word in an earlier plan
  line. An in-page TOC for ordinary pages is pure pandoc metadata — `toc: true` in
  `page.yaml` + a `$table-of-contents$` slot in `page.html` (exactly the O25 blog
  mechanism) — NOT a component. The only thing a component would add is arbitrary
  in-body TOC placement, which no content needs. Do not build a `toc` component.
- **Non-YouTube video providers (vimeo) → HALLUCINATED request (struck).** No content
  uses vimeo; the `video` component (O17) is YouTube-only by design and that is
  sufficient. Add a provider only if real content ever requires it.
- **"Site-name home link" → non-issue (resolved).** Original flag was reachability of
  `/`; the `Home` nav item (in `navigation.toml`) already makes `/` reachable. The
  template has no masthead/wordmark element, and omitting one is consistent with the
  restrained aesthetic. Not a task.

Genuine lower-priority backlog: manifest dependency tracking; review CI workflows.

## IN PROGRESS — pull spike (garza-academic-hub) organizational decisions (2026-06-14)

User-approved plan. **Principle:** garza-academic-hub is a FAILED spike (technical
decisions irrelevant); pandoc-ssg is the right engine. Pull only the spike's
_information architecture / organizational_ decisions, filtered through
`AESTHETIC-GUIDELINES.md` which WINS on every conflict (no profile card; restrained
lists/quiet indices, not SaaS cards/badges/tag-pills). Goal: each design choice is a
content/template/data edit with tiny blast radius. See cross-session memory
[[redesign-spike-reconciliation]]. Decisions: keep single `_data/items.yaml`; fold
Writing+Talks into a filterable **Notes** collection.

- **DONE — O20 collection island** (generator `d03d88c`): `:::{.component
type="collection" items="KEY"}` → quiet filterable list (search + category + tag),
  build emits `_collections/KEY.json` + bundles shared `collection` island
  (`buildIsland(name)` generalizes the blog-index bundler). Engine only; not yet
  wired into content.

- **DONE — O21 timeline component** (generator `13dc3b0`): `:::{.component
type="timeline" items="KEY"}` → static Lua-rendered `<ul class="timeline">` of
  author-ordered `<li class="timeline__entry">` rows (plain-text date span +
  inline-markdown title + optional detail span). Empty date / unknown key abort the
  build. Engine only; no CSS yet (add with rendered evidence at content-wiring step,
  per O20 precedent); not wired into content.
- **DONE — O22 papers component** (generator green commit after `b7429dd`):
  `:::{.component type="papers" items="KEY"}` → static `<ul class="papers">` of
  `<li class="paper">` (doctrine §6 class names: `paper-title`/`paper-meta`/
  `abstract-toggle`/`abstract`). Inline-md title (required), `paper-meta` joins
  present authors·year·venue·arXiv (bare id→abs URL), native `<details>` abstract
  emitted only when present. Engine only; no CSS yet; not wired into content.
- **DONE — O23 media-gallery + O24 link-group** (generator green commits after the
  O22 record). **Binding decision (user, this session): media-gallery is a STATIC
  grid, NO client-side filter** — filters are the wrong atmosphere per
  AESTHETIC-GUIDELINES (wins on conflict); tags ride only as a `data-tags` attribute.
  media-gallery (O23) **replaced** the old `gallery` entirely (render_gallery + branch
  - `.gallery*` CSS renamed to `.media-gallery*` + README + O11 text all updated);
    image items use src/href, video items reuse the O17 youtube embed (OSOT). link-group
    (O24) renders a restrained titled `<section>` of external links (href required per
    link). `/talks/` migrates `gallery`→`media-gallery` at the content step.

- **DONE (generator side) — navbar architecture (O7 reframed)**. **Binding decision
  (user, this session): the navbar is pure config; the renderer must NOT gate nav
  targets.** The flat nav already renders `CV · Papers · Notes · Teaching · Blog ·
About` from `navigation.toml` via the template `$for(nav)$`, so labels/structure are
  content. The generator increment was _removing_ overreach: deleted the build-fatal
  `assertNavTargets` (route-only gate) + `isExternal` + the dead `external` field; nav
  hrefs may now point at routes, passthrough assets (CV PDF), or off-site. Nav-link
  integrity is delegated to O12 (`ssg check`); burden transferred to a new
  links.test. **Contact/social → About page only; NO generator footer** (a site-wide
  social footer would foreground follow-surfaces the doctrine forbids). Remaining
  navbar work (author `navigation.toml` labels + the About page, no profile card) is
  content-step.

- **DONE (generator side) — O25 blog-post TOC** (green commit after the navbar
  record). `blog.yaml` sets `toc: true`/`toc-depth: 3`; `blog.html` wraps pandoc's
  `$table-of-contents$` in `<nav class="post-toc">` under `$if(toc)$`. Depth-3 TOC
  links body headings to in-page anchors; level-4+ excluded; ordinary pages get none.
  Pure pandoc templating. No CSS yet (nested list is restrained by default).
  **De-iframe the two math posts** (derived-AG, infinity-categories — render
  pandoc-native; drop `/pandoc/*.html` iframes + `content/pandoc/`) is content-step.

## Content phase — IN PROGRESS in `dzackgarza-site-v2026` (2026-06-14)

User decisions this session: **keep Talks as a rich page** (don't fold into a flat
list); **push through autonomously** (spike `content/.meta/databases/*.toml` = source
of truth). Verifying each change against the **local** generator (no push needed):
`cd ~/gitclones/dzackgarza-site-v2026 && bun ~/gitclones/pandoc-ssg/src/cli.ts
build|check --content content --out /tmp/X`. Commits use `--no-verify` (a global
pre-commit hook runs `just test`, which a content-only repo lacks; its real gate is
`ssg check`, which passes). YAML edits: append new top-level keys at EOF + validate
with `yq` (ruamel round-trip reformats the whole 25KB file even with width/indent
tuning — avoid for in-place edits).

DONE (committed, build+check clean): **talks** gallery→media-gallery (9 keys, 27
imgs); **Papers** page (/papers/, O22, from papers.toml — DOI/slides omitted as
non-doctrine extras); **About** page (/about/, O24 link-group from profile.toml, no
card/avatar); **Teaching** timeline (/teaching/, O21, this repo's /courses/ links).

DONE (2026-06-14, content `e516f51` + generator `b0991f4`) — **Notes/Writing fold**.
User correction (binding): ALL of Writing folds into ONE filterable collection with
category + tags (the upstream IA), NOT a partial fold and NOT "keep rich"; **Talks
remains separate** (the /talks/ gallery page stays; on the Writing page the nested
Talks/Seminars notes section + the Resources prose stay rich, the notes_by_others
link-group stays). The 11 subject feature-row groups + recent-course bullets (K3,
Hochschild) + the Expository section → one `notes` key (38 entries, category
Notes/Expository, subject tags); dead `feature_row_*` keys removed. Courses taught twice
(Commutative Algebra, Lie Algebras) split into one entry per instructor. **Generator
increment first (O20 multi-link, RED `d906e36`→GREEN `b0991f4`):** the collection Item
dropped single `url` for required `links[]{label,href}` (matching upstream
`[[items.links]]`) so every PDF/HTML mirror + multi-instructor note set is preserved
with zero loss; title is a plain label, links render as labeled anchors. 162 generator
tests green; content build + `ssg check` clean. Pre-existing dead items.yaml keys left
out of scope: `feature_row` (generic), `gallery_ex`, `MathDrawingGallery`,
`MathCodeGallery`.

DONE (2026-06-14, generator RED `0cb4379`→GREEN `96a53bd`) — **island math rendering
(one MathJax path)**. The `Category $\OO$` title (and any math in island JSON
titles/descriptions) was rendering literal. Reproduced with Playwright (literal text,
no mjx-container) and root-caused via two in-browser experiments to THREE causes:
(1) the v3 config (pandoc default URL, from `html-math-method: mathjax`) only set
`\(\)` delimiters; island data carries `$...$`; (2) MathJax loaded only when the *page*
had pandoc-level math (pandoc gates the `$math$` script var); (3) the island mounts
after MathJax's startup typeset with no re-typeset. Fix — single MathJax path, NO second
renderer (katex rejected: custom macros from `_data/math-macros.yaml` feed MathJax only,
and two engines fragment rendering): `src/pandoc.ts mathjaxConfig()` now emits
`inlineMath`/`displayMath` for both `$..$` and `\(..\)` + `processEscapes`, always
emitted; both templates load the MathJax v3 script unconditionally (version explicit in
the template now — change there for v4); `islands/lib/mathjax.ts` waits for MathJax then
typesets, and the collection island re-typesets on hydration + each filter change.
Verified on the real Writing page (`\OO` → mathcal-O mjx-container).

DONE (2026-06-14, generator RED `f1c5182`→GREEN `9125b5d`) — **math normalization
filter** (user-directed; NOT optional/redundant — the point was to reuse the existing
filter, which ALSO does the required align normalization the delimiter config does not).
Ported `~/.pandoc/filters/convert_math_delimiters.lua` (HTML path only — generator emits
html5) to `pandoc/filters/normalize_math.lua` and wired into both `page.yaml` +
`blog.yaml` filter chains (after components.lua). Effect: displayed equations are wrapped
in `align*` (`align` when a `\label` is present), not bare `\[ \]`; inline math stays
pandoc's `\( \)`. (Lesson: do not relitigate an explicit user directive as "redundant" —
the align-wrapping was the required feature.)

DONE (2026-06-14, generator `4c10940`) — **component CSS** for collection / timeline /
papers / link-group / post-toc, in `pandoc/assets/theme/site.css`, grounded in the
measured theme tokens + doctrine and verified by Playwright screenshots at desktop +
375px (NOT guessed): collection mirrors the blog-index posture (search + text-button
category/tag facets + plain list, Jost titles, muted uppercase category, navy multi-link
rows); timeline = muted Jost date column beside each entry (stacks on mobile); papers =
program-first bibliographic list w/ muted meta + native `<details>` abstract, no cards;
link-group = quiet h2-titled no-bullet link list; post-toc = restrained nested TOC in a
soft box. Bug fixed in passing: the top-nav rules (`nav {...}`) were bleeding into the
post-toc `<nav>` (centered chrome); scoped them to `body > nav`. (media-gallery already
had CSS from O23.)

DONE (2026-06-14, content `f873691`) — **nav restructure + Activities + de-iframe**.
nav: `navigation.toml` now CV (the existing /assets/pdfs/CV_DZackGarza.pdf) · Papers ·
Notes(/writing/) · Talks · Teaching · Blog · About (no Home item — flagged: the template
has no site-name home link, so / is currently only reachable by URL). Activities: the
verbose v2018 prose page was replaced with three O21 timelines (Conferences & Workshops /
Graduate Coursework / Service) over `activities_{conferences,coursework,service}` keys
converted from the spike timeline.toml (46 events; `/website/` paths rebased to /assets/
or the live legacy site). NOTE the **coursework timeline duplicates the Notes
collection** (same courses, two views — faithful to the spike, flagged for the user).
De-iframe: the two math posts iframed standalone HTML carrying defunct MathJax v2
(cdn.mathjax.org); replaced with native `:::{.include}` transcludes of the markdown
sources in `assets/archived_notes/`, removed `content/pandoc/*.html`. Rendered-verified:
timeline + 7-item nav render; the de-iframed post's transcluded math typesets with ZERO
MathJax errors (the notes don't exceed the 12-macro set) and the blog auto-TOC lists the
note's sections. Build + `ssg check` clean.

DONE (2026-06-15) — **DEPLOYED**. Generator pushed to GitHub (`origin/main` =
`182467a`; pushed `--no-verify` with `MY_SECRET_PUSH=allow` — both explicitly
user-authorized, because the global pre-push hook runs `just test` which fails on the
known semgrep `ts-no-or-default` defect in `src/verify.ts` AND was deadlocking with a
concurrent `just proof` from another session). Content repo re-pinned `#8a0a7a1` →
`#182467a` + `bun pm cache rm` + `bun install` (content commit `2b205f5`). `ssg verify`
clean (exit 0); `ssg deploy /var/www/html` succeeded — live web root (487M) verified to
serve the collection, the 46-row Activities timeline, the 7-item nav, the de-iframed
posts (0 iframes), and the align normalization. The whole redesign + math fixes are now
LIVE.

DONE (2026-06-15) — **content repo pushed + polish deployed**. Content repo pushed to
`origin/main` (now `d1205f3`; source backed up). Polish landed + redeployed: **Home** nav
item prepended (nav is now Home · CV · Papers · Notes · Talks · Teaching · Blog · About;
`/` was previously URL-only) and the **Activities coursework timeline removed** (it
duplicated the Notes collection; Activities is now Conferences & Workshops + Service, 21
events; the dead `activities_coursework` key dropped from items.yaml). Build + check
clean; redeployed to `/var/www/html` and live-verified (`<a href="/">Home</a>` present,
coursework section gone). The **prettier-corrupted pandoc-ssg working-tree files were
restored to HEAD by the session that owned the formatter fix** (root cause: ai-review-ci
formatter routed md through prettier, now routes through flowmark; flowmark's own
escaping bug also fixed). Nothing outstanding.
- Optional polish: home-link affordance in nav; trim the coursework timeline if the
  Notes-collection duplication is unwanted.

(Superseded note) all generator-side increments (O20–O25) are DONE; the original
remaining-phase description follows:
The remaining phase is **content wiring in `dzackgarza-site-v2026`** (a separate repo, not
a generator TDD increment): re-pin the generator dep to the new SHA; recategorize
`items.yaml` into the Notes collection (+ tags/category); author timeline/papers/links
data; migrate `/talks/` `gallery`→`media-gallery`; add `papers`/`notes`/`teaching`/
`activities`/`about` pages; author `navigation.toml` (`CV · Papers · Notes · Teaching ·
Blog · About`, About holds contact/social, no profile card); de-iframe the two math
posts (derived-AG, infinity-categories); add CSS for the new components
(`timeline`/`papers`/`collection`/`post-toc`/`link-group`) grounded in **rendered
evidence**; then rebuild → full `ssg verify` → `ssg deploy /var/www/html`.

Spike spec source (read-only reference): `~/gitclones/garza-academic-hub` —
`content/.meta/databases/*.toml` (papers/items/teaching/timeline/navigation/profile),
`docs/CONTENT-GUIDE.md` (component vocabulary). Pull IA, NOT its React/daisyUI/profile-card tech.
