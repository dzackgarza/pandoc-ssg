import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { build } from "../src/build.ts";
import { type RunningServer, startServer } from "../src/serve.ts";
import type { Manifest } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const BLOG_CONTENT = join(FIXTURES, "blog-island", "content");

interface PostMeta {
  title: string;
  date: string;
  url: string;
  tags: string[];
  categories: string[];
}

/** All file paths (POSIX, dir-relative) under `root`, recursively. */
async function walk(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walk(join(root, e.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/**
 * O16 — the build-output contract for the interactive blog-index island.
 * Proves the kernel emits the post data, bundles the Svelte island to a stable
 * path, expands the placeholder into a hydration mount, and keeps the manifest
 * bijection (now including the generated dimension).
 */
describe("O16: blog-index island build output", () => {
  let outDir: string;
  let manifest: Manifest;
  let indexHtml: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-island-"));
    manifest = await build({ contentDir: BLOG_CONTENT, pandocDir: PANDOC_DIR, outDir });
    indexHtml = await readFile(join(outDir, "index.html"), "utf8");
  }, 60000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits dist/blog/posts.json with every post, newest date first", async () => {
    const raw = await readFile(join(outDir, "blog", "posts.json"), "utf8");
    const posts = JSON.parse(raw) as PostMeta[];
    expect(posts.map((p) => p.title)).toEqual(["Second Post", "First Post", "Old Post"]);
    expect(posts[0]).toEqual({
      title: "Second Post",
      date: "2026-03-15",
      url: "/blog/2026-03-15-second/",
      tags: ["algebra", "notes"],
      categories: ["Notes"],
    });
  });

  test("bundles the island to a stable, self-contained module", async () => {
    const bundle = await readFile(join(outDir, "assets", "islands", "blog-index.js"), "utf8");
    // A real Svelte bundle is non-trivial and references the mount id it hydrates.
    expect(bundle.length).toBeGreaterThan(2000);
    expect(bundle).toContain("blog-index");
  });

  test("expands the placeholder into a hydration mount + module script", () => {
    expect(indexHtml).toContain('id="blog-index"');
    expect(indexHtml).toContain('data-posts="/blog/posts.json"');
    expect(indexHtml).toContain('<script type="module" src="/assets/islands/blog-index.js">');
    // the raw component placeholder must have been consumed, not passed through
    expect(indexHtml).not.toContain('type="blog-index"');
  });

  test("records both generated island files in the manifest", () => {
    // theme assets (O18) are also in generated; scope to the island's own outputs
    const outputs = manifest.generated
      .filter((g) => g.kind === "island" || g.kind === "data")
      .map((g) => g.output)
      .sort();
    expect(outputs).toEqual(["assets/islands/blog-index.js", "blog/posts.json"]);
  });

  test("bijection: dist == manifest.json ∪ routes ∪ passthrough ∪ generated", async () => {
    const onDisk = (await walk(outDir)).sort();
    const expected = [
      "site-manifest.json",
      ...manifest.routes.map((r) => r.output),
      ...manifest.passthrough.map((p) => p.output),
      ...manifest.generated.map((g) => g.output),
    ].sort();
    expect(onDisk).toEqual(expected);
  });
});

/**
 * O16 — the island actually hydrates and filters client-side. This is the real
 * proof of the feature (the build-output test only proves wiring): a headless
 * browser loads the page, the island fetches posts.json and renders the list,
 * and search + tag filtering narrow it reactively.
 */
describe("O16: blog-index island hydrates and filters in the browser", () => {
  let outDir: string;
  let server: RunningServer;
  // biome-ignore lint/suspicious/noExplicitAny: playwright Page type via dynamic dep
  let page: any;
  // biome-ignore lint/suspicious/noExplicitAny: playwright Browser type via dynamic dep
  let browser: any;

  async function visibleTitles(): Promise<string[]> {
    // allInnerTexts avoids in-page DOM callbacks (no node-side DOM typing).
    return page.locator(".blog-index__item .blog-index__link").allInnerTexts();
  }

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-island-br-"));
    await build({ contentDir: BLOG_CONTENT, pandocDir: PANDOC_DIR, outDir });
    server = startServer({ outDir });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    await page.goto(`http://localhost:${server.port}/`, { waitUntil: "domcontentloaded" });
    // wait for the island to fetch posts.json and render the list
    await page.waitForSelector(".blog-index__item");
  }, 60000);

  afterAll(async () => {
    await browser.close();
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("renders all posts after hydration, newest first", async () => {
    expect(await visibleTitles()).toEqual(["Second Post", "First Post", "Old Post"]);
  });

  test("search narrows the list to matching titles", async () => {
    await page.fill(".blog-index__search", "first");
    // string body evaluates in-browser; no node-side DOM typing needed
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 1");
    expect(await visibleTitles()).toEqual(["First Post"]);
    await page.fill(".blog-index__search", "");
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 3");
  });

  test("a tag filter shows only posts carrying that tag", async () => {
    await page.getByRole("button", { name: "algebra", exact: true }).click();
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 2");
    expect(await visibleTitles()).toEqual(["Second Post", "Old Post"]);
    // reset the tag facet for the next test
    await page
      .locator(".blog-index__tags")
      .getByRole("button", { name: "All", exact: true })
      .click();
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 3");
  });

  test("a category filter is a distinct facet from tags", async () => {
    await page
      .locator(".blog-index__categories")
      .getByRole("button", { name: "Tutorials", exact: true })
      .click();
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 1");
    expect(await visibleTitles()).toEqual(["First Post"]);

    await page
      .locator(".blog-index__categories")
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await page.waitForFunction("document.querySelectorAll('.blog-index__item').length === 2");
    expect(await visibleTitles()).toEqual(["Second Post", "Old Post"]);
  });
});
