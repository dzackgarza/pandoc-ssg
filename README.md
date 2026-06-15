# pandoc-ssg

A small pandoc-centered static site generator: a thin Bun/TypeScript kernel
(scan → classify → validate → route → render → copy → manifest) around
pandoc 3.6, which owns documents, metadata, templates, math, and AST transforms.

**This repository ships no content.** Like Jekyll, it is a dependency: your
site lives in its own repository, which depends on this one and points the CLI
at its `content/` directory. See `Static-Site-Generator-Design.md` for the full
design.

## Requirements

The build shells out to system tools and reads the author's canonical math and
figure assets live (so they are never vendored and always current):

| Tool | Used for | Needed by |
| --- | --- | --- |
| **Bun** | runs the CLI (`bunx github:dzackgarza/pandoc-ssg`) | always |
| **pandoc 3.6+** | document rendering, templates, math, AST filters | always |
| **uv** | runs the bundled MathJax macro extractor (`pandoc/bin/extract_mathjax_macros.py`) | always (any page) |
| **pdflatex** + **pdf2svg** | compile `\begin{tikzcd}` / `\begin{tikzpicture}` blocks to inline SVG | pages with TikZ diagrams |
| **playwright** + chromium | `verify` / the `deploy` gate (browser checks) | `verify`, `deploy` |
| **vite** + **svelte** | bundle interactive islands (blog-index, collection) | pages using those components |

`playwright`, `vite`, and `svelte` are optional peer deps of the content repo
(install with `bun add -d playwright && bunx playwright install chromium`, etc.).

### Configuration (`~/.config/pandoc-ssg/config.toml`)

The macro and diagram sources are **static config, not flags**. The build reads
`$XDG_CONFIG_HOME/pandoc-ssg/config.toml` (default `~/.config/pandoc-ssg/config.toml`)
and fails loudly if it is missing or incomplete — there is no runtime default:

```toml
pandoc_home = "/home/you/.pandoc"
mathjax_macro_manifest = "/home/you/.pandoc/styles/macros/mathjax-sources.txt"
```

### The `~/.pandoc` tree (live, not vendored)

Macros and diagrams are regenerated from the author's pandoc tree (`pandoc_home`)
on every build — there is no stored copy. That tree must provide:

- **MathJax macros** — the manifest at `mathjax_macro_manifest` (declares which
  `.tex` files feed MathJax) plus the `.tex` files it lists. The build extracts
  the macro set from these each run.
- **TikZ diagrams** — `filters/tikzcd.lua`, `templates/standalone-tikz.tex`, and
  the TikZ styles under `styles/`. The build sets `PANDOC_DIR=pandoc_home` so the
  filter resolves them; rendered SVGs are hash-cached in `figures/rendered/`.

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
pandoc-ssg verify [--content DIR] [--pandoc DIR] [--out DIR]   # build, then browser-verify every page
pandoc-ssg serve  [--out DIR] [--port N]
pandoc-ssg deploy DIR [--content DIR] [--pandoc DIR] [--out DIR]  # build, then rsync -a --delete into DIR
pandoc-ssg new post "Title" [--content DIR]
```

Defaults: `--content ./content`, `--out ./dist`, and `--pandoc` resolves to the
design layer bundled with this package. A content repo may override `--pandoc`
to supply its own templates/filters/defaults. The MathJax macro manifest and the
pandoc tree are read from the static config (see Requirements), not flags.
`deploy` browser-verifies the built tree and refuses to publish if any page has a
rendering defect.

## Content layout

```
content/
  index.md                 # a page: needs `site.page: true` frontmatter
  writing.md               # site.route override, components, math
  _data/
    navigation.toml        # nav config; hrefs may be routes, passthrough assets, or off-site (link integrity via `check`)
    math-macros.yaml        # site-wide MathJax macros
    items.yaml             # data backing components (feature-row, media-gallery, timeline, papers, collection, link-group)
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

::: {.component type="media-gallery" items="my-media"}
:::

::: {.include path="./_partials/abstract.md"}
:::
```

## Development

```
bun install
bun test          # 164 tests, real pandoc + Playwright, no mocks
bun run types     # tsc --noEmit
```
