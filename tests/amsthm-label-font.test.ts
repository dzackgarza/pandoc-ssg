import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { type RunningServer, startServer } from "../src/serve.ts";

const THEME_SRC = join(import.meta.dir, "..", "pandoc", "assets", "theme");

/**
 * amsthm run-in labels (the `<span class="thmlabel">` the amsthm_label filter
 * injects, e.g. "Example 1.1.") must read like a standard math paper: bold, in
 * the BODY SERIF face, at body size — not the geometric sans display face used
 * for headings/nav, which renders as a larger, grating bold against the serif
 * prose. This serves the real vendored theme CSS with a label span in prose
 * context and reads its computed font.
 */
describe("amsthm label uses the body serif, not the sans display font", () => {
  let outDir: string;
  let server: RunningServer;
  let labelFontFamily: string;
  let labelFontSize: string;
  let proseFontSize: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-thmlabel-"));
    await cp(THEME_SRC, join(outDir, "assets", "theme"), { recursive: true });
    await writeFile(
      join(outDir, "index.html"),
      [
        "<!DOCTYPE html><html><head><meta charset=utf-8>",
        '<link rel="stylesheet" href="/assets/theme/tufte.min.css">',
        '<link rel="stylesheet" href="/assets/theme/site.css">',
        "</head><body><article><section>",
        '<p id="env"><span class="thmlabel">Example 1.1.</span> Algebraic schemes/spaces.</p>',
        "</section></article></body></html>",
      ].join("\n"),
      "utf8",
    );
    server = await startServer({ outDir });
    let browser = await chromium.launch({ headless: true });
    try {
      let page = await browser.newPage();
      await page.goto(`http://localhost:${server.port}/`, { waitUntil: "load" });
      // String-form evaluate (runs in the page) to keep DOM globals out of the
      // node-side type context, matching the other browser tests.
      let m = (await page.evaluate(
        "(() => { const lab = document.querySelector('.thmlabel'); const p = document.getElementById('env'); const lcs = getComputedStyle(lab); return { ff: lcs.fontFamily, lsize: lcs.fontSize, psize: getComputedStyle(p).fontSize }; })()",
      )) as { ff: string; lsize: string; psize: string };
      labelFontFamily = m.ff;
      labelFontSize = m.lsize;
      proseFontSize = m.psize;
      await page.close();
    } finally {
      await browser.close();
    }
  }, 60000);

  afterAll(async () => {
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("label resolves to the et-book serif body face, never the sans display stack", () => {
    expect(labelFontFamily.toLowerCase()).toContain("et-book");
    expect(labelFontFamily.toLowerCase()).not.toContain("system-ui");
  });

  test("label is the same size as its surrounding prose, not enlarged", () => {
    expect(labelFontSize).toBe(proseFontSize);
  });
});
