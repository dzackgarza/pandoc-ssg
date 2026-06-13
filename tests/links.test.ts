import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { checkLinks } from "../src/links.ts";
import type { Manifest } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

const LINKS_CONTENT = join(FIXTURES, "links", "content");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

function freshOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-links-"));
}

describe("O12: internal link integrity", () => {
  let outDir: string;
  let manifest: Manifest;

  beforeAll(async () => {
    outDir = await freshOutDir();
    manifest = await build({
      contentDir: LINKS_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("reports exactly the broken internal link, ignoring good and external", async () => {
    let broken = await checkLinks(outDir, manifest);
    expect(broken).toEqual([{ sourcePage: "index.html", target: "/nope/" }]);
  });
});

describe("O12: fully-valid site reports no broken links", () => {
  let outDir: string;
  let manifest: Manifest;

  beforeAll(async () => {
    outDir = await freshOutDir();
    manifest = await build({
      contentDir: DEMO_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("demo site has no broken internal links", async () => {
    let broken = await checkLinks(outDir, manifest);
    expect(broken).toEqual([]);
  });
});
