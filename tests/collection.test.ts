import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { build } from "../src/build.ts";
import { type RunningServer, startServer } from "../src/serve.ts";
import type { Manifest } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const CONTENT = join(FIXTURES, "collection", "content");

interface CItem {
  title: string;
  category: string;
  description: string;
  links: { label: string; href: string }[];
  tags: string[];
}

/**
 * O20 — the collection component emits per-key data, bundles the island, and
 * expands the placeholder into a hydration mount.
 */
describe("O20: collection island build output", () => {
  let outDir: string;
  let manifest: Manifest;
  let indexHtml: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-coll-"));
    manifest = await build({ contentDir: CONTENT, pandocDir: PANDOC_DIR, outDir });
    indexHtml = await readFile(join(outDir, "index.html"), "utf8");
  }, 60000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits the referenced items key as _collections/<key>.json", async () => {
    const raw = await readFile(join(outDir, "_collections", "notes.json"), "utf8");
    const data = JSON.parse(raw) as CItem[];
    expect(data.map((i) => i.title)).toContain("A-infinity Categories and the Fukaya Category");
    expect([...new Set(data.map((i) => i.category))].sort()).toEqual([
      "Expository",
      "Notes",
      "Talks",
    ]);
    const fukaya = data.find((i) => i.title === "A-infinity Categories and the Fukaya Category");
    expect(fukaya?.links).toEqual([
      { label: "PDF", href: "/talks/fukaya/fukaya.pdf" },
      { label: "HTML", href: "/talks/fukaya/fukaya.html" },
    ]);
  });

  test("bundles the shared collection island", async () => {
    const bundle = await readFile(join(outDir, "assets", "islands", "collection.js"), "utf8");
    expect(bundle.length).toBeGreaterThan(2000);
    expect(bundle).toContain("collection");
  });

  test("expands the placeholder into a hydration mount + module script", () => {
    expect(indexHtml).toContain('class="collection"');
    expect(indexHtml).toContain('data-collection="/_collections/notes.json"');
    expect(indexHtml).toContain('<script type="module" src="/assets/islands/collection.js">');
    expect(indexHtml).not.toContain('type="collection"');
  });

  test("records the collection data + island in the manifest", () => {
    const outs = manifest.generated.map((g) => g.output);
    expect(outs).toContain("_collections/notes.json");
    expect(outs).toContain("assets/islands/collection.js");
  });
});

describe("O20: collection hydrates and filters by category/tag/search", () => {
  let outDir: string;
  let server: RunningServer;
  // biome-ignore lint/suspicious/noExplicitAny: playwright types via dynamic dep
  let page: any;
  // biome-ignore lint/suspicious/noExplicitAny: playwright types via dynamic dep
  let browser: any;

  async function titles(): Promise<string[]> {
    return page.locator(".collection__item .collection__title").allInnerTexts();
  }

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-coll-br-"));
    await build({ contentDir: CONTENT, pandocDir: PANDOC_DIR, outDir });
    server = startServer({ outDir });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".collection__item");
  }, 60000);

  afterAll(async () => {
    await browser.close();
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("renders all items after hydration", async () => {
    expect((await titles()).length).toBe(4);
  });

  test(
    "typesets math in an item title via the site MathJax + macros",
    async () => {
      // The "Sheaf cohomology of $\OO_X$" title uses the site-wide \OO macro
      // and is injected by the island after MathJax's startup pass. It must be
      // typeset by the same global MathJax (one math path), not left literal.
      const item = page.locator(".collection__item", { hasText: "Sheaf cohomology" });
      await item.locator(".collection__title mjx-container").waitFor({ timeout: 15000 });
      const titleText = await item.locator(".collection__title").innerText();
      expect(titleText).not.toContain("$");
      expect(await item.locator(".collection__title mjx-container").count()).toBe(1);
    },
    30000,
  );

  test("a category facet narrows to that category", async () => {
    await page
      .locator(".collection__categories")
      .getByRole("button", { name: "Talks", exact: true })
      .click();
    await page.waitForFunction("document.querySelectorAll('.collection__item').length === 1");
    expect(await titles()).toEqual(["A-infinity Categories and the Fukaya Category"]);
  });

  test("renders each of an item's links as a labeled anchor", async () => {
    const item = page.locator(".collection__item", {
      hasText: "A-infinity Categories and the Fukaya Category",
    });
    const links = item.locator(".collection__link");
    expect(await links.allInnerTexts()).toEqual(["PDF", "HTML"]);
    expect(await links.nth(0).getAttribute("href")).toBe("/talks/fukaya/fukaya.pdf");
    expect(await links.nth(1).getAttribute("href")).toBe("/talks/fukaya/fukaya.html");
  });
});
