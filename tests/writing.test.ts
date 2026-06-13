import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const CONTENT = join(import.meta.dir, "..", "content");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

/**
 * Stress test: build the real authored content tree once and assert the
 * migrated pages come out fully expanded. /writing/ exercises feature-row
 * cards (inline math in titles, raw-HTML icons, a notice block); /talks/
 * exercises galleries and many notice blocks. Invariants are count-free so
 * ordinary content edits do not churn the test; they assert the migration
 * left nothing un-expanded and the kernel handled the real corpus.
 */
let outDir: string;
let writingHtml: string;
let talksHtml: string;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "ssg-content-"));
  await build({ contentDir: CONTENT, pandocDir: PANDOC_DIR, outDir });
  writingHtml = await readFile(join(outDir, "writing", "index.html"), "utf8");
  talksHtml = await readFile(join(outDir, "talks", "index.html"), "utf8");
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("real /writing/ page builds and fully expands", () => {
  test("renders multiple data-backed card collections", () => {
    const rows = writingHtml.split('class="feature-row"').length - 1;
    const cards = writingHtml.split('class="feature-card"').length - 1;
    expect(rows).toBeGreaterThan(1);
    expect(cards).toBeGreaterThanOrEqual(rows);
  });

  test("no component placeholder survives un-expanded", () => {
    expect(writingHtml).not.toContain('type="feature-row"');
  });

  test("no Jekyll Liquid or kramdown attribute syntax leaks through", () => {
    expect(writingHtml).not.toContain("{%");
    expect(writingHtml).not.toContain("{:");
  });

  test("cards with empty url produce no broken empty-href links", () => {
    expect(writingHtml).not.toContain('href=""');
  });

  test("inline math is wrapped for MathJax and macros are configured", () => {
    expect(writingHtml).toContain('<span class="math inline">');
    // OO macro (\\mathcal{O}) used in the 'Category O' card title
    expect(writingHtml).toContain("\\mathcal{O}");
    expect(writingHtml.split("window.MathJax").length - 1).toBe(1);
  });

  test("the notice block became a semantic div, not literal text", () => {
    expect(writingHtml).toContain('class="notice--info"');
  });
});

describe("real /talks/ page builds and fully expands", () => {
  test("renders multiple galleries with image items", () => {
    const galleries = talksHtml.split('class="gallery"').length - 1;
    const items = talksHtml.split('class="gallery__item"').length - 1;
    expect(galleries).toBeGreaterThan(1);
    expect(items).toBeGreaterThanOrEqual(galleries);
  });

  test("the many notice blocks all became semantic divs", () => {
    const notices = talksHtml.split('class="notice--info"').length - 1;
    expect(notices).toBeGreaterThan(1);
  });

  test("no Liquid include, kramdown attribute, or component placeholder leaks", () => {
    expect(talksHtml).not.toContain("{%");
    expect(talksHtml).not.toContain("{:");
    expect(talksHtml).not.toContain('type="gallery"');
  });
});

describe("real standalone apps pass through verbatim (O4, opaque)", () => {
  test("persistent_homology files are byte-identical and not compiled", async () => {
    for (const rel of ["persistent_homology/index.html", "persistent_homology/js/index.js"]) {
      const src = await readFile(join(CONTENT, rel));
      const dst = await readFile(join(outDir, rel));
      expect(Buffer.compare(src, dst)).toBe(0);
    }
    // a directory at the .html path would mean it was wrongly compiled to index.html
    const asPage = await stat(join(outDir, "persistent_homology", "index.html"));
    expect(asPage.isFile()).toBe(true);
  });

  test("a markdown-looking file inside an opaque app is copied, not rendered", async () => {
    // README.txt rides along verbatim; nothing in the opaque subtree is compiled
    const src = await readFile(join(CONTENT, "persistent_homology", "README.txt"), "utf8");
    const dst = await readFile(join(outDir, "persistent_homology", "README.txt"), "utf8");
    expect(dst).toBe(src);
    expect(dst).not.toContain("<!DOCTYPE html>");
  });
});
