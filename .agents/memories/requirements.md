# Core Requirements

Source contract: `Static-Site-Generator-Design.md` (repo root). These are the distilled, binding requirements.

- Pandoc-based SSG (pandoc owns parsing, metadata, templates, math, AST transforms via Lua filters). Kernel owns only: scanning, classification, validation, routing, pandoc invocation, copying, manifest emission, CLI ergonomics.
- "Set it and forget it": templates/schemas/filters configured once; ongoing authoring = creating markdown files in `content/` with minimal frontmatter.
- `content/` mirrors the deployed tree exactly, except reserved underscore paths (`_data/`, `_site.toml`, etc.).
- Markdown files must **opt in** to page status (`site.page: true`); non-opt-in markdown is served as a literal downloadable file, never compiled, never validated.
- Directory rules may infer page *type/template/route policy* (e.g. `content/blog/` → blog-post) but never page *status*.
- Fail-fast strict schema validation for opt-in pages: unknown schema, missing required fields, unknown fields → build failure naming the file.
- Deterministic routing: `content/about.md` → `dist/about/index.html`; `content/index.md` → `dist/index.html`; collisions are build failures.
- Opaque passthrough subtrees (standalone sites like MakeMeAQual) copied verbatim, declared in `content/_site.toml`.
- Navigation is content-owned data (`content/_data/navigation.toml`), validated against the route manifest.
- MathJax with a single site-wide macro source (`content/_data/math-macros.yaml`).
- `site-manifest.json` is the single contract consumed by everything downstream (sitemap, link checks, tests, preview).
- CLI for progressive disclosure: `build`, `new post`, etc. — scaffolds valid files, runs the same compiler path.
- Components via pandoc fenced divs + Lua filters; transclusion via Lua filter splicing parsed AST blocks.

See [proof-obligations](proof-obligations.md), [architecture](architecture.md), [implementation-plan](implementation-plan.md).
