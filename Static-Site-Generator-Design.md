> From: https://chatgpt.com/c/6a2c4366-3a68-83e8-9dac-d759e99cec49

# you asked

message time: 2026-06-13 01:35:33

Determine the easiest way to make a reasonably fully-featured static site generator that is fundamentally based upon pandoc, as opposed to standard markdown.
It should be similar in functionality to jekyll or astro.
Instead of templating languages, you rely heavily on pandoc's variables, metadata, and templating system, as well as a shipped set of custom filters to handle nontrivial transformations.
It should have a "Set it and forget it" design philosophy: you set up your basic components first (e.g. headers, footers, various page types like "main", "secondary", "blog post", etc) as templates, heavily leveraging semantically parsed transclusions (e.g. with a minimal filter or an extremely minimal intermediate parser that foists the heavy lifting onto a templating language like jinja) in order to define your building blocks, but then managing the actual structure and content of the site through a content subdirectory, in which you never have to worry about actual SSG internals whatsoever.
This means that you should not have to decorate every single new page with elaborate metadata, but rather declare it to be one of your existing page types (or e.g. infer it automatically based on declared configs, e.g. all files in content/blog -> blog type page) and simply focus on writing the content in a standard markdown editor.
The CMS is literally just pointing your favourite editor at the content directory and creating new files with minimal fuss.
So e.g. you should be able to easily change which pages appear on your main navigation as a content concern, not a SSG-internal or templating concern necessarily.
Aesthetic and content-level changes should have minimal blast radii.
The architecture should be modular and simple to navigate and understand.
You can have a "management" CLI which handles commands and subcommands for progressive disclosure of common operations, e.g. a shortcut to scaffold a new blog post.
It's a STATIC site generator, which means that whatever it produces can be dumped into a directory and served with literally any web server.
This it needs to create the actual navigable tree, likely handle converting e.g. content/about.md to mysite/about/index.html or whatever the standard might be.
It needs to be able to handle the fact that the content directory is EXACTLY what is intended to end up on the site at the various relative paths -- e.g. if one makes a directory content/2026/spring/math2250 and puts index.md for the page definition there and mypic.jpg, one expects mysite/2026/spring/math2250/index.html to exist as well as mysite/2026/spring/math2250/index.jpg.
One needs to be careful, because one MIGHT want to store NON-page markdown in these directories, e.g. content/2026/spring/math2250/syllabus.md, which is just a personal file that is accompanied by content/2026/spring/math2250/syllabus.pdf, both of which should resolve online as literal downloadable md and pdf files.
This means that markdown files need to "opt in" to being regarded as pages.
The generator should of course fail fast, enforcing a strict, non-optional schema for all pages that opt-in, so that pages using a deprecated schema after changes or updates can quickly be triaged.
One of course doesn't validate markdown files that do NOT opt-in to being considered a page.

The ultimate goal is to reproduce:

https://dzackgarza.com/

Derived from:

https://github.com/dzackgarza/dzackgarza.comv2018/tree/master/_pages

So note in particular that one expects to be able to drop in completely standalone websites, like https://github.com/dzackgarza/dzackgarza.comv2018/tree/master/_pages/MakeMeAQual And have them served up as-is.
Another example being

https://github.com/dzackgarza/dzackgarza.comv2018/tree/master/_pages/persistent_homology

But one should also support creating new leaf pages on the fly, e.g. for one-off seminars or conferences, e.g.

https://github.com/dzackgarza/dzackgarza.comv2018/blob/master/_pages/GOATS_2020.md

One also wants a very principled way of being able to modularly develop and insert components in the website.
This may typically involve defining a custom div in pandoc, with a custom filter, which transforms data to populate live components.
Examples would include photo galleries backed by e.g. some kind of custom pandoc block or yaml metadata that contains all image data and tells the filter which component to populate with what.
Another example would be a component that defines an (independently constructed and debugged) scrolling gallery of cards, each of which houses a note, e.g. https://dzackgarza.com/writing/

Ultimately, the goal must be that trivial expository content (which includes extensive mathematics -- so note that you must be very careful about how you integrate mathjax and expose a config that can be easily updated to include custom macros and definitions) should be trivial to create and edit, e.g. using the entrypoint CLI (or even justfile recipes that abstract or chain some such commands).
Changing e.g. site layout might be a bit more complicated, but still mostly involve editing templates, which can be handled narrowly by a web-designer agent, meaning that this part of the app can own whatever visual/UI framework is enforced.
New dynamic components, e.g. a newly defined image gallery, should be doable mostly with filter and template work, again not touching the core SSG code.
And finally, the pipeline itself should be mostly locked in, and ongoing content work should almost never have to modify the core itself.

So we need a design model that incorporates all of these invariants, making this app own as little surface as possible by delegating to larger depenencies, tools, and frameworks and gluing them together.
An alternate approach might also be simple taking an existing solution and forking it to repurpose it for this pandoc-specific design.
Research various solutions and approaches and deliver a plan forward.

* * *

# chatgpt response

I’ll compare Pandoc-centered SSG options and adjacent build strategies against your constraints, inspect the referenced site structure, and produce a concrete architecture plus migration plan.

* * *

# chatgpt response

I’m narrowing the recommendation toward a thin Pandoc orchestrator: Quarto is closest, but its content model conflicts with literal output-tree and opt-in page requirements.

* * *

# chatgpt response

## Recommendation

The easiest path is to **continue from / fork the current `dzackgarza/garza-academic-hub` direction, but harden it into a small “Pandoc site kernel” rather than a general web app**. It already has the intended shape: `content/` is compiled through Pandoc defaults, templates, and Lua filters into generated HTML, then bundled/served as static output; the README explicitly describes the pipeline as `content/` → Pandoc filters/templates/defaults → `.generated/` → Vite → `dist/`, with the app shell owning no page content, headings, routes, nav, profile, or blog chrome.
([GitHub](https://github.com/dzackgarza/garza-academic-hub)) The repo’s own goals also match your stated invariants: minimal app logic, Pandoc-owned structure, Lua filters for extensions/transclusions/components, a manifest as the single contract, and fail-fast compilation on malformed frontmatter, duplicate routes, invalid templates, bad islands, missing data, or schema violations.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/GOALS.md))

I would **not** start by forking Quarto, Hakyll, Astro, Jekyll, or Soupault.
They are useful reference points, but your desired model is unusual enough that the smallest long-term system is a custom orchestrator around Pandoc, not a repurposed full framework.

The core principle should be:

> Pandoc owns documents, metadata, templates, math, citations, and AST-level transformations.\
> The custom SSG owns only scanning, validation, routing, copying, manifest generation, and command ergonomics.\
> Optional JavaScript owns only genuinely interactive islands.

Pandoc is a good foundation because it parses enhanced Markdown into a real document AST, supports rich metadata, templates, math, citations, and custom filters, and its Lua filters are built into Pandoc without requiring an external JSON-filter process.
([Pandoc](https://pandoc.org/MANUAL.html))

## Why not an existing SSG?

Quarto is the closest off-the-shelf system.
It is Pandoc-based, supports websites, blogs, books, equations, citations, cross-references, callouts, layouts, and project-level rendering.
([Quarto](https://quarto.org/)) It is the best choice only if you are willing to adopt Quarto’s project model.
Your requirements are stricter and more idiosyncratic: the `content/` tree should almost literally mirror the deployed tree; Markdown files must opt in to page compilation so that adjacent `.md` files can remain downloadable source files; standalone sub-sites must be droppable as opaque trees; and component semantics should be defined by your own Pandoc filters and schemas.
Quarto can probably be bent toward this, but doing so makes you fight the tool.

Hakyll is Pandoc-native and powerful.
It has explicit route, compiler, template, context, and Pandoc compiler abstractions.
([JasperVDJ](https://jaspervdj.be/hakyll/tutorials/a-guide-to-the-hakyll-module-zoo.html)) It is a good intellectual model, but the customization layer is a Haskell DSL. That increases the amount of specialized knowledge required for ongoing maintenance, especially if the desired workflow includes web-designer agents editing templates/components without touching core code.

Soupault can call Pandoc as a preprocessor and manipulate HTML trees after conversion.
([Soupault](https://soupault.net/)) It is useful as an HTML postprocessor, but it makes Pandoc’s AST less central.
Your desired component system wants semantically parsed blocks, metadata, transclusions, galleries, and cards to be transformed before final HTML, which points to Pandoc Lua filters rather than HTML rewriting.

Jekyll and Astro are better as design references than as foundations.
Jekyll’s YAML-frontmatter convention is relevant because it processes files with frontmatter and treats files without frontmatter as static files in collections.
([Jekyll](https://jekyllrb.com/docs/front-matter/?utm_source=chatgpt.com)) Astro’s content collections and islands model are relevant for typed content and selective interactivity, but Astro is not fundamentally Pandoc-centered.
([Astro Docs](https://docs.astro.build/en/reference/modules/astro-content/?utm_source=chatgpt.com))

So the best plan is: **use Jekyll’s opt-in/static-file distinction, Astro’s schema/island discipline, Quarto’s Pandoc-first ambition, and Hakyll’s route/compiler separation — but implement only the narrow kernel you actually need.**

## Target architecture

Use this separation:

```text
content/
  _data/
    navigation.toml
    profile.toml
    galleries.toml
    collections.toml
    math-macros.yaml
  _redirects.toml
  _site.toml

  index.md
  about.md
  writing.md

  blog/
    2026-06-12-example-post.md

  2026/spring/math2250/
    index.md
    syllabus.md
    syllabus.pdf
    mypic.jpg

  MakeMeAQual/
    index.html
    assets/
    ...

pandoc/
  defaults/
    page.yaml
    blog.yaml
    standalone-page.yaml
  templates/
    base.html
    page.html
    blog.html
    writing.html
    seminar.html
  filters/
    components.lua
    transclude.lua
    math-policy.lua
    links.lua
  partials/
    header.html
    footer.html
    nav.html

kernel/
  cli.ts
  scan.ts
  classify.ts
  validate.ts
  routes.ts
  pandoc.ts
  copy.ts
  manifest.ts
  components.ts
  schemas.ts

islands/
  gallery/
  card-scroller/
  search/
  makemeaqual-wrapper/

.generated/
dist/
```

The exact names are negotiable, but the boundary is not.
`content/` is the authoring surface.
`pandoc/` is the design/document-transformation surface.
`kernel/` is the small, boring compiler.
`islands/` is optional interactivity.
`dist/` is disposable output.

I would keep `content/_data` as a reserved non-public content-control directory.
That is the only exception to “content mirrors output.”
Everything outside reserved underscore paths should either become a page, be copied literally, or be an opaque passthrough subtree.

## Page opt-in model

Do not compile every Markdown file.
A Markdown file becomes a page only if it explicitly opts in.

Example minimal page:

```yaml
---
site:
  page: true
  schema: page.v1
title: About
---
```

Example blog post:

```yaml
---
site:
  page: true
  schema: blog-post.v1
title: 'Example post'
date: 2026-06-12
tags: [algebraic-geometry, teaching]
---
```

The directory can infer defaults, but not page status.
For example, `content/blog/foo.md` may infer `type = blog-post`, `template = blog`, and route policy, but it should still require `site.page: true`. That preserves your requirement that non-page Markdown files can live beside generated pages.

So:

```text
content/2026/spring/math2250/index.md
```

with `site.page: true` compiles to:

```text
dist/2026/spring/math2250/index.html
```

while:

```text
content/2026/spring/math2250/syllabus.md
content/2026/spring/math2250/syllabus.pdf
content/2026/spring/math2250/mypic.jpg
```

are copied literally to:

```text
dist/2026/spring/math2250/syllabus.md
dist/2026/spring/math2250/syllabus.pdf
dist/2026/spring/math2250/mypic.jpg
```

This is the key divergence from the current `garza-academic-hub` guide, which says every Markdown file in `content/blog` becomes a blog post.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/content/CONTENT-GUIDE.md)) That should be changed.
Directory defaults should reduce metadata, but they should not remove the opt-in page marker.

## Routing rules

Use simple deterministic routing.

```text
content/index.md                         -> dist/index.html
content/about.md                         -> dist/about/index.html
content/writing.md                       -> dist/writing/index.html
content/blog/foo.md                      -> dist/blog/foo/index.html
content/2026/spring/math2250/index.md    -> dist/2026/spring/math2250/index.html
```

A page may override the route only through a validated field:

```yaml
---
site:
  page: true
  schema: page.v1
  route: /activities/goats-2020/
title: GOATS 2020
---
```

The compiler must fail on:

```text
two sources claiming the same output route
a page route colliding with a copied static file
an inferred route differing from a legacy redirect without declaration
a non-page .md that would be overwritten by generated HTML
a page with an unknown schema version
a page with unknown top-level metadata
a page using a deprecated schema
```

The route manifest should be the source of truth:

```json
{
  "schemaVersion": 1,
  "routes": [
    {
      "source": "content/about.md",
      "url": "/about/",
      "output": "dist/about/index.html",
      "type": "page",
      "template": "page",
      "schema": "page.v1",
      "assets": [],
      "islands": []
    }
  ],
  "passthrough": [
    {
      "source": "content/2026/spring/math2250/syllabus.pdf",
      "output": "dist/2026/spring/math2250/syllabus.pdf"
    }
  ],
  "redirects": []
}
```

Everything else — sitemap, link checking, tests, search index, preview server, deployment — should consume this manifest rather than re-deriving routes.

## Schema discipline

Use one canonical schema layer.
Since the current project already uses a TypeScript/Vite/Bun ecosystem and includes Zod, Zod is the natural choice.
Zod is a TypeScript-first schema validation library, and current Zod supports JSON Schema conversion, which is useful for sharing contracts with tests, docs, and possibly filters.
([Zod](https://zod.dev/?utm_source=chatgpt.com))

The current repo analysis already identifies a major risk: validation is split across compiler code, Lua filters, content guide prose, and React registries.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md)) Fix that by making the TypeScript schema registry authoritative.

Example schema registry:

```ts
export const pageSchemas = {
  'page.v1': PageSchema,
  'blog-post.v1': BlogPostSchema,
  'seminar.v1': SeminarSchema,
  'collection-page.v1': CollectionPageSchema,
  'passthrough.v1': PassthroughSchema,
} as const;
```

Then generate:

```text
.generated/schemas/page.v1.json
.generated/schemas/blog-post.v1.json
.generated/component-registry.json
.generated/content-reference.json
```

The compiler validates frontmatter and component declarations before running final Pandoc conversion.
Lua filters should transform already validated structures.
They should not be the only place where correctness is enforced.

## Pandoc layer

Pandoc defaults files should define command surfaces per page type.
Pandoc supports defaults files, and `${.}` in defaults resolves relative to the defaults file’s directory; use that to eliminate machine-local paths.
([Pandoc](https://pandoc.org/MANUAL.html)) This matters because the current repo analysis notes defaults pointing to `/home/dzack/.pandoc/filters`, which violates repo portability.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md))

Example `pandoc/defaults/blog.yaml`:

```yaml
from: markdown+yaml_metadata_block+fenced_divs+tex_math_dollars
to: html5
standalone: true
template: ../templates/blog.html
lua-filter:
  - ../filters/transclude.lua
  - ../filters/components.lua
  - ../filters/links.lua
metadata-files:
  - ../metadata/site.yaml
  - ../metadata/mathjax.yaml
html-math-method:
  method: mathjax
```

Pandoc templates should own the page shell.
Pandoc templates use variables supplied through metadata or command-line options, and `--standalone` uses a template for full documents.
([Pandoc](https://pandoc.org/MANUAL.html)) So headers, footers, nav, page-type wrappers, blog chrome, and MathJax setup belong in templates and partials, not React application code.

Pandoc fenced divs should be the component syntax.
Pandoc parses fenced divs into native `Div` nodes with attributes, which is exactly the right substrate for semantic components.
([Pandoc](https://pandoc.org/MANUAL.html))

Example content component:

```markdown
:::{.component type="gallery-grid" gallery="teaching-photos" columns="3"}
:::
```

Example collection component:

```markdown
:::{.component type="collection" source="notes" tag="expository" layout="card-scroller" limit="12"}
:::
```

The component filter should either produce static HTML or an island placeholder:

```html
<div data-island="card-scroller" data-props-id="island-17"></div>
<script type="application/json" id="island-17">
  ...
</script>
```

The island bundler then hydrates only that component.
The rest of the page remains ordinary static HTML.

## Transclusions

Use a Pandoc Lua filter for transclusion, not a general templating language in Markdown.

A reasonable syntax:

```markdown
:::{.include path="./abstract.md"}
:::
```

or:

```markdown
{{< include ./abstract.md >}}
```

The filter should:

1. resolve the path relative to the including file;
2. reject paths escaping allowed roots;
3. parse the included file with Pandoc into AST blocks;
4. splice the blocks into the document;
5. track dependencies in the manifest for incremental rebuilds.

This keeps transcluded content semantically parsed as Pandoc Markdown.
It avoids turning the content layer into string templating.
Jinja may still be useful for generating repetitive HTML partials inside the design layer, but it should not be necessary for ordinary content authoring.

## MathJax and macros

Use MathJax through Pandoc’s HTML math method.
Pandoc’s manual says HTML math is basic by default and that `--mathjax` causes TeX math to be wrapped for MathJax rendering.
([Pandoc](https://pandoc.org/MANUAL.html))

Use one macro source, for example:

```yaml
# content/_data/math-macros.yaml
macros:
  AA: "\\mathbb{A}"
  PP: "\\mathbb{P}"
  Spec: "\\operatorname{Spec}"
  Hom: "\\operatorname{Hom}"
```

The compiler generates a template fragment:

```html
<script>
  window.MathJax = {
    tex: {
      macros: {
        AA: '\\mathbb{A}',
        PP: '\\mathbb{P}',
        Spec: '\\operatorname{Spec}',
        Hom: '\\operatorname{Hom}',
      },
    },
  };
</script>
```

Then the base template includes that before loading MathJax.

Do not scatter macro definitions across pages unless a page schema explicitly allows local extensions:

```yaml
math:
  macros:
    Foo: "\\operatorname{Foo}"
```

Even then, local macros should be merged and validated during compilation so that broken macros fail before deployment.

For pages with heavy mathematics, add browser tests that wait for MathJax completion and fail on MathJax errors.
This is more reliable than only checking generated HTML.

## Standalone sub-sites

A directory such as `MakeMeAQual/` or `persistent_homology/` should be supported in two modes.

First, opaque passthrough:

```toml
# content/_site.toml
[[passthrough]]
path = "MakeMeAQual"
mode = "opaque"

[[passthrough]]
path = "persistent_homology"
mode = "opaque"
```

Then:

```text
content/MakeMeAQual/index.html
content/MakeMeAQual/assets/app.js
```

becomes:

```text
dist/MakeMeAQual/index.html
dist/MakeMeAQual/assets/app.js
```

with no Pandoc processing.
This matches the observed current `MakeMeAQual` page, which is a standalone interactive tool with its own controls and behavior.
([D. Zack Garza](https://dzackgarza.com/makemeaqual/))

Second, wrapped passthrough:

```toml
[[passthrough]]
path = "MakeMeAQual"
mode = "iframe-or-shell"
title = "Make Me a Qual"
nav = true
```

This generates an outer site page that links to or embeds the standalone app, while still copying the app as-is.
Use this only when desired.
The default should be zero interference.

## Content data and navigation

Navigation should be content-owned, not template-owned.

Example:

```toml
# content/_data/navigation.toml

[[main]]
title = "Teaching"
href = "/teaching/"
weight = 10

[[main]]
title = "Activities"
href = "/activities/"
weight = 20

[[main]]
title = "Resources"
href = "/resources/"
weight = 30

[[main]]
title = "Writing"
href = "/writing/"
weight = 40

[[main]]
title = "Gallery"
href = "/gallery/"
weight = 50

[[main]]
title = "Blog"
href = "/blog/"
weight = 60
```

This matches the current public site’s visible navigation categories: Teaching, Activities, Resources, Writing, Gallery, and Blog.
([D. Zack Garza](https://dzackgarza.com/))

The compiler should validate that every nav target exists in the manifest or is explicitly external.
This prevents stale navigation links.

The `/writing/` page is a good first stress test because it is list-heavy and card-heavy, with many categorized notes and links.
([D. Zack Garza](https://dzackgarza.com/writing/)) It should be generated from content data plus Pandoc component declarations, not hand-maintained HTML.

## CLI surface

The CLI should be small and mostly ergonomic.

```text
site init
site build
site preview content/about.md
site serve
site new page about --type page
site new post "Title of post"
site new seminar GOATS_2020 --date 2020-05-30
site doctor
site check-links
site inspect-route /writing/
site migrate-legacy legacy/_pages --dry-run
site component new gallery-grid
```

The CLI should not hide the model.
It should just scaffold valid files and run the same compiler path every time.

A `justfile` can wrap common workflows:

```text
just build
just preview content/about.md
just new-post "Some title"
just test
just deploy-local
```

The current repo already has this general workflow: `just preview <file>`, `just build`, and a proof loop around compile/build/tests.
([GitHub](https://github.com/dzackgarza/garza-academic-hub)) Keep that, but make the underlying contracts stricter.

## Build pipeline

Use this exact pipeline:

1. Load global config and schemas.
2. Walk `content/`.
3. Classify every file:
   - reserved control file under `_data`, `_site`, `_drafts`, etc.;
   - opt-in page Markdown;
   - literal Markdown asset;
   - static asset;
   - opaque passthrough subtree.
4. Parse frontmatter only for opt-in pages.
5. Validate page metadata against the declared schema.
6. Infer page type/template/route from config.
7. Validate route uniqueness and asset-copy collisions.
8. Validate content references: galleries, collections, nav targets, redirects, image paths, downloadable files.
9. Run Pandoc with the page type’s defaults file.
10. Run Lua filters for transclusions, components, link normalization, and math policy.
11. Write generated HTML to the output tree.
12. Copy static/literal files.
13. Emit `site-manifest.json`.
14. Bundle only required JS islands.
15. Run post-build checks:
    - no unresolved component divs;
    - no raw local filesystem paths;
    - no missing assets;
    - no duplicate IDs;
    - no broken internal links;
    - no forbidden raw HTML unless explicitly allowed;
    - MathJax smoke tests on math-heavy pages;
    - Playwright route smoke tests from the manifest.

The current repo goals already call for real rendered verification using real Markdown, Pandoc output, generated manifests, and browser-rendered pages.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/GOALS.md)) That should be promoted from aspiration to non-negotiable CI.

## Handling raw HTML

Forbid raw HTML in ordinary content by default.
Pandoc Markdown can pass raw HTML through to HTML output, which is powerful but dangerous for long-term maintainability.
([Pandoc](https://pandoc.org/MANUAL.html))

Instead of this:

```html
<script src="..."></script>
<div class="custom-gallery">...</div>
```

use this:

```markdown
:::{.component type="gallery-grid" gallery="conference-2024"}
:::
```

or:

```markdown
:::{.component type="external-embed" provider="youtube" id="..."}
:::
```

The current repo analysis notes a raw-script exception and recommends converting that kind of case into a component/filter.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md)) That is exactly right.

## Migration plan for `dzackgarza.com`

The older GitHub `_pages` links were not accessible during inspection, but the current public site and the newer `garza-academic-hub` repo are accessible.
The newer repo appears purpose-built for this migration.
([GitHub](https://github.com/dzackgarza/garza-academic-hub))

Use this order.

First, freeze a route inventory.
Crawl the current site and record every public URL, title, status, canonical path, and legacy redirect.
Include top-level pages, writing pages, blog pages, old conference pages, and standalone apps.

Second, harden the kernel before migrating more content.
Implement opt-in page classification, route collision checks, schema validation, passthrough copying, Pandoc invocation, and manifest generation.

Third, migrate global content data: navigation, profile card, footer links, social links, bibliography links, and MathJax macros.
The current homepage has structured sections for profile, research, slides, talks, and notes; these should become data-backed components rather than hardcoded React or hand-written HTML. ([D. Zack Garza](https://dzackgarza.com/))

Fourth, migrate `/writing/`. This page exercises the important abstractions: categorized notes, external links, downloadable PDFs, HTML versions, cards, and list sections.
([D. Zack Garza](https://dzackgarza.com/writing/)) Build it from `content/_data/items.toml` plus Pandoc component declarations.

Fifth, migrate one-off leaf pages such as GOATS 2020. The visible page is structurally simple: title, conference info, links, schedule, participation notes, and organizers.
([D. Zack Garza](https://dzackgarza.com/GOATS/2020/July/)) It should be a `seminar.v1` or `event.v1` page with minimal metadata and normal Markdown body.

Sixth, migrate standalone apps such as `MakeMeAQual` and `persistent_homology` as opaque passthrough directories first.
Do not attempt to convert them to Pandoc pages initially.
Preserve public URLs and behavior.
Later, optionally add wrapper pages or shared navigation.

Seventh, migrate blog posts and teaching pages.
Use CLI scaffolds so each new post has the page marker and schema version but no repetitive boilerplate.

Eighth, add redirects for legacy URLs.
Every old route should be classified as:

```text
same route
new route with redirect
standalone passthrough
intentionally removed
```

Ninth, reduce the app layer.
The current repo analysis flags SPA routing and weakly typed island boundaries as risks.
([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md)) The final site should be static HTML files plus optional islands, not a React app interpreting the site.

## Concrete changes to make in `garza-academic-hub`

The current repo is close enough that I would refactor it, not replace it.

Make these changes first:

1. **Move all non-content compiler assets out of public content semantics.** Keep author-owned data in `content/_data`, but put Pandoc defaults, filters, and templates under `pandoc/` or another clearly non-public root.
   The current `content/` tree includes defaults, filters, templates, pages, blog, public, and databases.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub/tree/main/content)) That is workable, but it blurs the “content mirrors output” invariant.

2. **Replace directory-implied page compilation with explicit page opt-in.** Current behavior says every Markdown file in `content/blog` becomes a post.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/content/CONTENT-GUIDE.md)) Change that to: every Markdown file with `site.page: true` becomes a page; directory rules only infer type and defaults.

3. **Create one schema registry.** The repo analysis already identifies split validation across compiler code, Lua filters, docs, and React registries.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md)) Define schemas once in TypeScript/Zod, export JSON Schema, generate docs, and validate all page metadata and component declarations from that source.

4. **Vendor filters and make Pandoc defaults project-relative.** Remove references to machine-local Pandoc filter paths.
   Pandoc defaults support relative resolution through `${.}`, so the build can be portable.
   ([Pandoc](https://pandoc.org/MANUAL.html))

5. **Make the manifest the only contract between compiler and runtime.** Routes, page types, templates, islands, sitemap entries, redirects, and copied assets should all be in `.generated/site-manifest.json`.

6. **Turn raw HTML exceptions into components.** The current analysis already flags raw script exceptions as a content-purity problem.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/ANALYSIS.md)) Replace those with fenced-div components.

7. **Demote React to islands only.** The app should not own route structure, navigation, page chrome, or content layout.
   The current README already says the app should own no content, headings, routes, nav, profile, or blog chrome.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub)) Enforce that mechanically.

8. **Delete unused UI dependencies after island boundaries are clear.** The current package has a large React/Radix/shadcn-style dependency surface.
   ([GitHub](https://github.com/dzackgarza/garza-academic-hub/blob/main/package.json)) Keep only what is needed for real interactive islands.

9. **Add manifest-driven browser tests.** Generate every route, visit it with Playwright, fail on console errors, missing nav, missing main landmark, unresolved components, broken internal links, and MathJax failures.

## Final design model

The system should be understood as four layers.

The first layer is **content**. It contains pages, literal downloadable files, static assets, data files, and standalone sub-sites.
Authors live here.

The second layer is **Pandoc design**. It contains defaults, templates, partials, Lua filters, and MathJax configuration.
Site layout and semantic transformations live here.

The third layer is the **kernel**. It scans, validates, routes, invokes Pandoc, copies assets, writes the manifest, and fails fast.
It should be small enough to read in one sitting.

The fourth layer is **optional interactivity**. It contains typed islands such as galleries, card scrollers, search, or standalone app wrappers.
It should never be required for ordinary pages.

This gives the desired “set it and forget it” workflow: after the templates, schemas, filters, and data-backed components are established, ordinary content creation is just creating Markdown files and nearby assets in `content/`. Changing the nav is editing `content/_data/navigation.toml`. Changing layout is editing Pandoc templates.
Adding a new component is adding a schema, a Pandoc component transform, and optionally an island.
The compiler core should rarely change.
