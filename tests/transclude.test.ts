import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

function freshOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-out-"));
}

type CapturedRejection = { rejected: true; error: unknown } | { rejected: false };

async function captureRejection(promise: Promise<unknown>): Promise<CapturedRejection> {
  let result: CapturedRejection;
  try {
    await promise;
    result = { rejected: false };
  } catch (error) {
    result = { rejected: true, error };
  }
  return result;
}

/**
 * O10: transclusion. `::: {.include path="..."}` splices the pandoc-parsed
 * blocks of the referenced file, resolved relative to the including file.
 * Paths escaping content/ are a build failure.
 */
describe("O10: transclusion splices parsed blocks", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({
      contentDir: join(FIXTURES, "transclude", "content"),
      pandocDir: PANDOC_DIR,
      outDir,
    });
    html = await readFile(join(outDir, "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("included content appears, parsed as markdown (not verbatim)", () => {
    expect(html).toContain("<em>transcluded</em>");
    expect(html).toContain('<span class="math inline">');
  });

  test("transcluded single-backslash math parses (matches the page reader)", () => {
    // Archived notes (the real transclusion targets) author display math as
    // \[...\] and inline as \(...\). transclude must parse the included file
    // with tex_math_single_backslash, or these mangle into literal prose
    // (the live derived-AG defect). Inline \(\theta_tr\) -> math-inline span.
    expect(html).toContain("\\(\\theta_{\\mathrm{tr}}\\)");
    // Display \[...\] -> math-display span (normalize wraps align*), not literal.
    expect(html).toContain('<span class="math display">');
    expect(html).toContain("\\omega_{\\mathrm{tr}} = \\theta_{\\mathrm{tr}}");
    expect(html).not.toContain("[\n\\omega");
  });

  test("the include placeholder div is consumed", () => {
    expect(html).not.toContain('class="include"');
    expect(html).not.toContain('path="_includes/abstract.md"');
  });

  test("host content around the include is preserved", () => {
    expect(html).toContain("Before the include.");
    expect(html).toContain("After the include.");
  });
});

describe("O10: transclusion rejects path escaping content/", () => {
  test("an include escaping the content root rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "transclude-escape", "content"),
          pandocDir: PANDOC_DIR,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: { name: "BuildError", kind: "pandoc" },
    });
    await rm(outDir, { recursive: true, force: true });
  });
});
