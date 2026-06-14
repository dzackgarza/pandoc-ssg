import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import * as YAML from "yaml";
import { BuildError } from "./errors.ts";
import type { NavItem, PageType } from "./types.ts";

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
  /** data backing components (e.g. feature-row collections), from _data/items.yaml */
  items: Record<string, unknown>;
  /** absolute content root; transclusion rejects includes resolving outside it */
  contentRoot: string;
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

/**
 * Render one page to standalone HTML (O5) by invoking the system pandoc
 * with the page type's defaults file and template. Pandoc failures throw
 * BuildError(kind="pandoc").
 */
export async function renderPage(input: RenderInput): Promise<string> {
  let defaultsName = `${basename(input.pageType.template, ".html")}.yaml`;
  let defaultsPath = join(input.pandocDir, "defaults", defaultsName);

  let metadata: Record<string, unknown> = {
    nav: input.nav.map((item) => ({ title: item.title, href: item.href })),
    content_root: resolve(input.contentRoot),
  };
  // Always emit the MathJax config: the delimiter set is site-wide policy,
  // needed wherever math can appear (including island data), independent of
  // whether any macros are defined.
  metadata.mathjax_config = mathjaxConfig(input.mathMacros);

  let metaDir = await mkdtemp(join(tmpdir(), "ssg-meta-"));
  let metaFile = join(metaDir, "meta.yaml");

  // Component data flows to the Lua filter as a JSON sidecar, referenced by a
  // plain filesystem path. Passing it through pandoc metadata directly would
  // let pandoc parse embedded markdown (card excerpts) prematurely; the path
  // string survives metadata round-tripping intact, the JSON does not.
  if (Object.keys(input.items).length > 0) {
    let itemsFile = join(metaDir, "items.json");
    await writeFile(itemsFile, JSON.stringify(input.items), "utf8");
    metadata.items_path = itemsFile;
  }

  await writeFile(metaFile, YAML.stringify(metadata), "utf8");

  try {
    let proc = Bun.spawn(
      [
        "pandoc",
        "--defaults",
        defaultsPath,
        "--metadata-file",
        metaFile,
        resolve(input.sourcePath),
      ],
      { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
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
    return stdout;
  } finally {
    await rm(metaDir, { recursive: true, force: true });
  }
}
