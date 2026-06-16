import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { type RunningServer, startServer } from "../src/serve.ts";

const THEME_SRC = join(import.meta.dir, "..", "pandoc", "assets", "theme");

/**
 * O18: the site is light-only by design (a paper-style research aesthetic). The
 * vendored Tufte CSS ships an `@media (prefers-color-scheme: dark)` block that
 * repaints `body` to `#151515`; on a dark-OS visitor that silently turns the
 * whole site dark. This proves the rendered page ignores the OS dark setting by
 * loading the REAL vendored theme CSS the way the page template links it and
 * reading the computed body background under an emulated dark color-scheme.
 */
describe("O18: theme stays light under prefers-color-scheme: dark", () => {
  let outDir: string;
  let server: RunningServer;
  let bodyBgUnderDark: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-colorscheme-"));
    await cp(THEME_SRC, join(outDir, "assets", "theme"), { recursive: true });
    // Minimal page that links the theme exactly like page.html/blog.html:
    // tufte.min.css first, then site.css.
    await writeFile(
      join(outDir, "index.html"),
      [
        "<!DOCTYPE html><html><head><meta charset=utf-8>",
        '<link rel="stylesheet" href="/assets/theme/tufte.min.css">',
        '<link rel="stylesheet" href="/assets/theme/site.css">',
        "</head><body><main><h1>x</h1><p>x</p></main></body></html>",
      ].join("\n"),
      "utf8",
    );
    server = await startServer({ outDir });
    let browser = await chromium.launch({ headless: true });
    try {
      let page = await browser.newPage({ colorScheme: "dark" });
      await page.goto(`http://localhost:${server.port}/`, { waitUntil: "load" });
      bodyBgUnderDark = (await page.evaluate(
        "getComputedStyle(document.body).backgroundColor",
      )) as string;
      await page.close();
    } finally {
      await browser.close();
    }
  }, 60000);

  afterAll(async () => {
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("body background is the light paper color, not Tufte's dark #151515", () => {
    // #fffff8 -> rgb(255, 255, 248). The dark regression repaints to
    // #151515 -> rgb(21, 21, 21).
    expect(bodyBgUnderDark).toBe("rgb(255, 255, 248)");
  });
});
