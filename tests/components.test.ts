import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const COMPONENTS_CONTENT = join(FIXTURES, "components", "content");

function freshOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-out-"));
}

/**
 * Component filter (data-backed fenced-div components). The `/writing/` page's
 * feature rows are the motivating case: a `::: {.component type="feature-row"
 * items="X"}` div must expand to a card grid built from _data/items.yaml,
 * with each card's markdown excerpt rendered to HTML.
 */
describe("component filter: feature-row expands from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a feature-row container, not an empty component div", () => {
    expect(html).toContain('class="feature-row"');
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="feature-row"');
  });

  test("renders one card per data entry with its title", () => {
    expect(html).toContain("Alpha Notes");
    expect(html).toContain("Beta Notes");
    expect(html).toContain('src="/img/a.png"');
    expect(html).toContain('alt="Alpha"');
  });

  test("card excerpt is rendered as markdown, not emitted verbatim", () => {
    // *Prof X, Fall 2020* must become emphasis, and the [PDF](url) a real link
    expect(html).toContain("<em>Prof X, Fall 2020</em>");
    expect(html).toContain('href="https://example.com/a.pdf"');
    expect(html).not.toContain("*Prof X, Fall 2020*");
  });

  test("a card with empty url produces no broken empty-href link", () => {
    expect(html).not.toContain('href=""');
  });
});

describe("component filter: gallery expands from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "gallery", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a gallery container, not an empty component div", () => {
    expect(html).toContain('class="gallery"');
    expect(html).not.toContain('type="gallery"');
  });

  test("renders one item per image with thumbnail src and full-image link", () => {
    const items = html.split('class="gallery__item"').length - 1;
    expect(items).toBe(2);
    expect(html).toContain('src="/img/thumb-a.png"');
    expect(html).toContain('href="/img/full-a.png"');
    expect(html).toContain('src="/img/thumb-b.png"');
    expect(html).toContain('href="/img/full-b.png"');
  });

  test("a caption is rendered when an item has a title", () => {
    expect(html).toContain("Slide A");
  });
});

describe("component filter: unknown component type fails the build", () => {
  test("an unregistered component type rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badContent = join(FIXTURES, "components", "bad-content");
    await expect(
      build({ contentDir: badContent, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});
