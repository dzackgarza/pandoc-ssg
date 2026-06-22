import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { type RunningServer, startServer } from "../src/serve.ts";

const THEME_SRC = join(import.meta.dir, "..", "pandoc", "assets", "theme");

/**
 * The in-page post TOC lists the document's own section titles, so it must read
 * in the BODY SERIF face — not the geometric sans display face used for nav and
 * headings, which renders the entries as a grating sans block against the serif
 * paper. Serves the real vendored theme CSS with the post-toc markup the
 * template emits and reads the computed font of a TOC entry.
 */
describe("post TOC entries use the body serif, not the sans display font", () => {
  let outDir: string;
  let server: RunningServer;
  let entryFontFamily: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-toc-"));
    await cp(THEME_SRC, join(outDir, "assets", "theme"), { recursive: true });
    await writeFile(
      join(outDir, "index.html"),
      [
        "<!DOCTYPE html><html><head><meta charset=utf-8>",
        '<link rel="stylesheet" href="/assets/theme/tufte.min.css">',
        '<link rel="stylesheet" href="/assets/theme/site.css">',
        // mirror the real DOM: an <aside class=post-toc> inside <main>, NOT a
        // body-level <nav> (which would match the site-nav rule, not the TOC).
        '</head><body><main class="post post--with-toc"><aside class=post-toc><details open>',
        "<summary>Contents</summary>",
        '<ul><li><a id="entry" href="#m">Motivation</a></li></ul>',
        "</details></aside></main></body></html>",
      ].join("\n"),
      "utf8",
    );
    server = await startServer({ outDir });
    let browser = await chromium.launch({ headless: true });
    try {
      let page = await browser.newPage();
      await page.goto(`http://localhost:${server.port}/`, { waitUntil: "load" });
      entryFontFamily = (await page.evaluate(
        "getComputedStyle(document.getElementById('entry')).fontFamily",
      ));
      await page.close();
    } finally {
      await browser.close();
    }
  }, 60000);

  afterAll(async () => {
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("a TOC entry resolves to the et-book serif, never the system-ui sans stack", () => {
    expect(entryFontFamily.toLowerCase()).toContain("et-book");
    expect(entryFontFamily.toLowerCase()).not.toContain("system-ui");
  });
});
