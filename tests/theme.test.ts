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

  test("emits the override stylesheet into dist/assets/theme/", async () => {
    // site.css is now a thin override on top of Tufte CSS (linked in the
    // template); it carries the bespoke island/amsthm layer, not base type.
    const css = await readFile(join(outDir, "assets", "theme", "site.css"), "utf8");
    expect(css).toContain(".blog-index");
    expect(css).toContain(".thmlabel");
  });

  test("records the emitted theme stylesheet in the manifest with kind 'theme'", () => {
    const theme = manifest.generated.filter((g) => g.kind === "theme").map((g) => g.output);
    expect(theme).toContain("assets/theme/site.css");
  });

  test("theme manifest entries point back to their source assets", () => {
    const siteCss = manifest.generated.find((g) => g.output === "assets/theme/site.css");
    expect(siteCss?.dependencies).toEqual([
      { kind: "theme-asset", path: "assets/theme/site.css", origin: "pandoc" },
    ]);
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
