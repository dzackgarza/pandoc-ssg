# Architecture

Four layers with hard boundaries (from design doc):

1. `content/` — authoring surface.
   Pages, literal files, static assets, `_data/` control files, opaque sub-sites.
   Mirrors `dist/` except reserved underscore paths.
2. `pandoc/` — design surface: `defaults/*.yaml`, `templates/*.html`, `partials/`, `filters/*.lua`. Owns layout, math config, component transforms.
   Defaults files use `${.}`-relative paths only (no machine-local paths).
3. `src/` — the kernel (Bun + TypeScript).
   Small, boring compiler: scan → classify → validate → route → pandoc invoke → copy → manifest.
   Modules: `config.ts`, `scan.ts`, `classify.ts`, `schemas.ts` (zod registry, single source of validation truth), `routes.ts`, `pandoc.ts`, `copy.ts`, `manifest.ts`, `build.ts`, `cli.ts`.
4. Islands (optional JS) — not in scope for the core; component filter may emit island placeholders.

## Tech decisions

- Bun + TypeScript; `bun test` as runner (QC `_coverage` uses it).
- `zod` for the schema registry (one authoritative validation layer).
- `gray-matter` for frontmatter extraction; `smol-toml` for TOML; `yaml` for YAML data files.
- pandoc 3.6 (system binary, `+lua`) invoked via `Bun.spawn` with per-type defaults files.
- Tests run real pandoc on real fixture trees under `tests/fixtures/` — no mocks.
- QC delegates to `~/ai-review-ci/justfiles/bun.just` via repo `justfile` (`just test`).

## Boundary rules

- Kernel never embeds HTML or layout knowledge; templates own the shell.
- Lua filters transform already-validated structures; they are not a validation layer.
- Everything downstream consumes `site-manifest.json`, never re-derives routes.

Linked: [proof-obligations](proof-obligations.md), [requirements](requirements.md).
