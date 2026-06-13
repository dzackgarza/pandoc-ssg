import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import type { Manifest } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

/**
 * O18 — the build emits the design layer's theme assets (stylesheet + self-hosted
 * fonts) into dist and every page links the stylesheet. The theme is part of the
 * generator, so it must reach dist even though the design layer (pandoc/) is not
 * otherwise copied.
 */
describe("O18: theme assets are emitted and linked", () => {
  let outDir: string;
  let manifest: Manifest;
  let indexHtml: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-theme-"));
    manifest = await build({ contentDir: DEMO_CONTENT, pandocDir: PANDOC_DIR, outDir });
    indexHtml = await readFile(join(outDir, "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits the stylesheet into dist/assets/theme/", async () => {
    const css = await readFile(join(outDir, "assets", "theme", "site.css"), "utf8");
    expect(css).toContain("@font-face");
    expect(css).toContain(".blog-index");
  });

  test("emits the self-hosted fonts byte-identical", async () => {
    const src = join(PANDOC_DIR, "assets", "theme", "fonts", "noto-serif-latin-400-normal.woff2");
    const dest = join(outDir, "assets", "theme", "fonts", "noto-serif-latin-400-normal.woff2");
    const [a, b] = await Promise.all([readFile(src), readFile(dest)]);
    expect(b.equals(a)).toBe(true);
  });

  test("records emitted theme assets in the manifest with kind 'theme'", () => {
    const theme = manifest.generated.filter((g) => g.kind === "theme").map((g) => g.output);
    expect(theme).toContain("assets/theme/site.css");
    expect(theme).toContain("assets/theme/fonts/noto-serif-latin-400-normal.woff2");
  });

  test("every page links the stylesheet", () => {
    expect(indexHtml).toContain('<link rel="stylesheet" href="/assets/theme/site.css">');
  });

  test("every emitted theme file exists on disk (manifest bijection holds)", async () => {
    for (const g of manifest.generated.filter((x) => x.kind === "theme")) {
      expect((await stat(join(outDir, g.output))).isFile()).toBe(true);
    }
  });
});
