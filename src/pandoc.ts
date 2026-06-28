import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as YAML from "yaml";
import { BuildError } from "./errors.ts";
import type { ComponentHandler, IslandEntry, NavItem, PageType, RegistryFile } from "./types.ts";

export interface RenderInput {
  /** absolute path of the source markdown file */
  sourcePath: string;
  /** content-relative path of the source, used in BuildError reporting */
  relPath: string;
  /** absolute path to the pandoc/ design root */
  pandocDir: string;
  pageType: PageType;
  nav: NavItem[];
  /**
   * Site-wide MathJax macro map, extracted live from the canonical macro
   * manifest. A zero-arg macro is a string body; an N-arg macro is
   * [body, argCount] (MathJax 3 tex.macros form).
   */
  mathMacros: Record<string, string | [string, number]>;
  /** data exposed to component filters; filters own the field contracts */
  items: Record<string, unknown>;
  /** registry-declared component handlers, passed to the Lua component dispatcher */
  componentHandlers: Record<string, ComponentHandler>;
  /** registry-declared island entries, passed to handlers that emit mounts */
  islands: Record<string, IslandEntry>;
  /** absolute content root; transclusion rejects includes resolving outside it */
  contentRoot: string;
  /** the author's pandoc tree (PANDOC_DIR); resolves the tikzcd filter's template + styles */
  pandocHome: string;
  /** site-wide Lua filters declared by content/_site.toml or bundled registry */
  siteFilters?: RegistryFile[];
  /**
   * Extra template metadata merged into the pandoc metadata (e.g. a blog post's
   * friendly `date_long`, `prev`/`next` neighbours, tag/category chips). The
   * single seam for per-page template data the build computes.
   */
  extraMeta?: Record<string, unknown>;
}

/**
 * Build the single MathJax configuration script fragment carrying the
 * site-wide macros. Emitted verbatim into the page head exactly once.
 */
function mathjaxConfig(macros: Record<string, string | [string, number]>): string {
  // JSON.stringify renders a string body as "body" and an [body, n] arg-macro
  // as ["body",n] — both valid MathJax 3 tex.macros entries.
  let entries = Object.entries(macros).map(
    ([name, tex]) => `      ${JSON.stringify(name)}: ${JSON.stringify(tex)}`,
  );
  let macroLines =
    entries.length > 0 ? ["    macros: {", entries.join(",\n"), "    },"] : ["    macros: {},"];
  return [
    "<script>",
    "window.MathJax = {",
    "  tex: {",
    // Recognize both $…$ and \(…\) inline (and $$…$$ / \[…\] display) so math
    // authored in data (island JSON titles/descriptions) typesets the same way
    // as pandoc-rendered page math — one math path, one set of delimiters.
    '    inlineMath: [["$", "$"], ["\\\\(", "\\\\)"]],',
    '    displayMath: [["$$", "$$"], ["\\\\[", "\\\\]"]],',
    "    processEscapes: true,",
    ...macroLines,
    "  }",
    "};",
    "</script>",
  ].join("\n");
}

/** Map nav items (with optional href + nested children) to plain template metadata. */
function navToMeta(items: NavItem[]): Record<string, unknown>[] {
  return items.map((item) => {
    let m: Record<string, unknown> = { title: item.title };
    if (item.href) {
      m.href = item.href;
    }
    if (item.children) {
      m.children = navToMeta(item.children);
    }
    return m;
  });
}

/**
 * Render one page to standalone HTML (O5) by invoking the system pandoc
 * with the page type's defaults file and template. Pandoc failures throw
 * BuildError(kind="pandoc").
 */
export async function renderPage(input: RenderInput): Promise<string> {
  let defaultsPath = registryPath(
    { path: input.pageType.defaults, source: input.pageType.source },
    input.contentRoot,
    input.pandocDir,
  );
  let templatePath = registryPath(
    { path: input.pageType.template, source: input.pageType.source },
    input.contentRoot,
    input.pandocDir,
  );
  let filters = [...(input.siteFilters ?? []), ...(input.pageType.filters ?? [])].flatMap((filter) => [
    "--lua-filter",
    registryPath(filter, input.contentRoot, input.pandocDir),
  ]);

  let metadata: Record<string, unknown> = {
    nav: navToMeta(input.nav),
    content_root: resolve(input.contentRoot),
  };
  if (input.extraMeta) {
    metadata = { ...metadata, ...input.extraMeta };
  }
  // Always emit the MathJax config: the delimiter set is site-wide policy,
  // needed wherever math can appear (including island data), independent of
  // whether any macros are defined.
  metadata.mathjax_config = mathjaxConfig(input.mathMacros);

  let metaDir = await mkdtemp(join(tmpdir(), "ssg-meta-"));
  let metaFile = join(metaDir, "meta.yaml");

  // Data flows to Lua filters as a JSON sidecar, referenced by a
  // plain filesystem path. Passing it through pandoc metadata directly would
  // let pandoc parse embedded markdown prematurely; the path string survives
  // metadata round-tripping intact, the JSON does not.
  if (Object.keys(input.items).length > 0) {
    let dataFile = join(metaDir, "data.json");
    await writeFile(dataFile, JSON.stringify(input.items), "utf8");
    metadata.data_path = dataFile;
  }

  let componentsRegistryFile = join(metaDir, "components-registry.json");
  await writeFile(componentsRegistryFile, JSON.stringify(componentRegistry(input)), "utf8");
  metadata.components_registry_path = componentsRegistryFile;

  await writeFile(metaFile, YAML.stringify(metadata), "utf8");

  let rendered = "";
  try {
    let proc = Bun.spawn(
      [
        "pandoc",
        "--defaults",
        defaultsPath,
        "--template",
        templatePath,
        ...filters,
        "--metadata-file",
        metaFile,
        resolve(input.sourcePath),
      ],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        // The tikzcd filter resolves its standalone template + TikZ styles from
        // PANDOC_DIR; the defaults reference ${PANDOC_DIR}/filters/tikzcd.lua.
        env: { ...process.env, PANDOC_DIR: input.pandocHome },
      },
    );

    let [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new BuildError(
        "pandoc",
        [input.relPath],
        `pandoc exited ${exitCode} on ${input.relPath}: ${stderr.trim()}`,
      );
    }
    rendered = stdout;
  } finally {
    await rm(metaDir, { recursive: true, force: true });
  }
  return rendered;
}

function registryPath(file: RegistryFile, contentRoot: string, pandocDir: string): string {
  if (file.source !== "content" && file.path.startsWith("islands/")) {
    return join(pandocDir, "..", file.path);
  }
  if (file.source !== "content" && file.path.endsWith(".html") && !file.path.includes("/")) {
    return join(pandocDir, "templates", file.path);
  }
  return join(file.source === "content" ? contentRoot : pandocDir, file.path);
}

function componentRegistry(input: RenderInput): Record<string, unknown> {
  return {
    contentRoot: resolve(input.contentRoot),
    handlers: Object.fromEntries(
      Object.entries(input.componentHandlers).map(([name, handler]) => [
        name,
        {
          handler: handler.handler,
          island: handler.island,
          module: handler.module
            ? registryPath(handler.module, input.contentRoot, input.pandocDir)
            : undefined,
        },
      ]),
    ),
    islands: Object.fromEntries(
      Object.entries(input.islands).map(([name, island]) => [
        name,
        {
          entry: registryPath({ path: island.entry, source: island.source }, input.contentRoot, input.pandocDir),
          output: island.output,
          dataOutput: island.dataOutput,
          dataSource: island.dataSource,
          mount: island.mount,
        },
      ]),
    ),
  };
}
