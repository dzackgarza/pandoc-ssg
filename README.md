# pandoc-ssg

A small pandoc-centered static site generator: a thin Bun/TypeScript kernel
(scan → classify → validate → route → render → copy → manifest) around
pandoc 3.6, which owns documents, metadata, templates, math, and AST transforms.

**This repository ships no content.** Like Jekyll, it is a dependency: your
site lives in its own repository, which depends on this one and points the CLI
at its `content/` directory. See `Static-Site-Generator-Design.md` for the full
design.

## Using it from a content repo

A content repo is the editable surface — pages, `_data`, assets, standalone
apps — plus a `justfile` of CMS-style recipes that invoke this tool:

```justfile
SSG := "bunx github:dzackgarza/pandoc-ssg"

build:   ; {{SSG}} build          # content/ -> dist/
serve:   ; {{SSG}} serve          # preview dist/ over HTTP
check:   ; {{SSG}} check          # build, then fail on broken internal links
new TITLE: ; {{SSG}} new post "{{TITLE}}"
```

## CLI

```
pandoc-ssg build  [--content DIR] [--pandoc DIR] [--out DIR]
pandoc-ssg check  [--content DIR] [--pandoc DIR] [--out DIR]
pandoc-ssg serve  [--out DIR] [--port N]
pandoc-ssg new post "Title" [--content DIR]
```

Defaults: `--content ./content`, `--out ./dist`, and `--pandoc` resolves to the
design layer bundled with this package. A content repo may override `--pandoc`
to supply its own templates/filters/defaults.

## Content layout

```
content/
  index.md                 # a page: needs `site.page: true` frontmatter
  writing.md               # site.route override, components, math
  _data/
    navigation.toml        # nav (targets must resolve to routes)
    math-macros.yaml        # site-wide MathJax macros
    items.yaml             # data backing components (feature-row, gallery)
  _site.toml               # passthrough subtrees, directory→type inference
  some-app/                # opaque passthrough: copied verbatim
```

A Markdown file is compiled only if its frontmatter opts in with
`site.page: true`; everything else is copied byte-for-byte. The build writes
`dist/site-manifest.json` as the single contract every downstream tool consumes.

## Components and transclusion

Fenced-div components expand from `_data/items.yaml`:

```markdown
::: {.component type="feature-row" items="my-cards"}
:::

::: {.component type="gallery" items="my-photos"}
:::

::: {.include path="./_partials/abstract.md"}
:::
```

## Development

```
bun install
bun test          # 88 tests, real pandoc, no mocks
bun run types     # tsc --noEmit
```
