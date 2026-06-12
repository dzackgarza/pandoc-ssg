import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
  /** site-wide MathJax macro map (name → TeX), from _data/math-macros.yaml */
  mathMacros: Record<string, string>;
}

/**
 * Build the single MathJax configuration script fragment carrying the
 * site-wide macros. Emitted verbatim into the page head exactly once.
 */
function mathjaxConfig(macros: Record<string, string>): string {
  let entries = Object.entries(macros).map(
    ([name, tex]) => `      ${JSON.stringify(name)}: ${JSON.stringify(tex)}`,
  );
  let macroBlock = entries.join(",\n");
  return [
    "<script>",
    "window.MathJax = {",
    "  tex: {",
    "    macros: {",
    macroBlock,
    "    }",
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
  };
  if (Object.keys(input.mathMacros).length > 0) {
    metadata.mathjax_config = mathjaxConfig(input.mathMacros);
  }

  let metaDir = await mkdtemp(join(tmpdir(), "ssg-meta-"));
  let metaFile = join(metaDir, "meta.yaml");
  await writeFile(metaFile, YAML.stringify(metadata), "utf8");

  try {
    let proc = Bun.spawn(
      ["pandoc", "--defaults", defaultsPath, "--metadata-file", metaFile, input.sourcePath],
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
