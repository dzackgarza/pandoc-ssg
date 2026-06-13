import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const CONTENT = join(import.meta.dir, "..", "content");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

/**
 * Stress test: build the real authored content tree and assert the migrated
 * /writing/ page (the design's abstraction-exercising case: 11 data-backed
 * card collections, inline math in titles, raw-HTML icons, a notice block)
 * comes out fully expanded. Invariants are count-free so ordinary content
 * edits do not churn the test; they assert the migration left nothing
 * un-expanded and the kernel handled the real corpus.
 */
describe("stress test: real /writing/ page builds and fully expands", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-writing-"));
    await build({ contentDir: CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "writing", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("renders multiple data-backed card collections", () => {
    const rows = html.split('class="feature-row"').length - 1;
    const cards = html.split('class="feature-card"').length - 1;
    expect(rows).toBeGreaterThan(1);
    expect(cards).toBeGreaterThanOrEqual(rows);
  });

  test("no component placeholder survives un-expanded", () => {
    expect(html).not.toContain('type="feature-row"');
  });

  test("no Jekyll Liquid or kramdown attribute syntax leaks through", () => {
    expect(html).not.toContain("{%");
    expect(html).not.toContain("{:");
  });

  test("cards with empty url produce no broken empty-href links", () => {
    expect(html).not.toContain('href=""');
  });

  test("inline math is wrapped for MathJax and macros are configured", () => {
    expect(html).toContain('<span class="math inline">');
    // OO macro (\\mathcal{O}) used in the 'Category O' card title
    expect(html).toContain("\\mathcal{O}");
    expect(html.split("window.MathJax").length - 1).toBe(1);
  });

  test("the notice block became a semantic div, not literal text", () => {
    expect(html).toContain('class="notice--info"');
  });
});
