import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { checkLinks } from "../src/links.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

const LINKS_CONTENT = join(FIXTURES, "links", "content");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");
const ENCODED_CONTENT = join(FIXTURES, "links-encoded", "content");
const NAV_TARGETS_CONTENT = join(FIXTURES, "nav-targets", "content");

function freshOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-links-"));
}

describe("O12: internal link integrity", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({
      contentDir: LINKS_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("reports exactly the broken internal link, ignoring good and external", async () => {
    let broken = await checkLinks(outDir);
    // lychee reports the resolved path with the trailing slash normalized off.
    expect(broken).toEqual([{ sourcePage: "index.html", target: "/nope" }]);
  });
});

describe("nav is config-driven: the build does not gate nav targets; integrity is O12's job", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({
      contentDir: NAV_TARGETS_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("a nav target pointing at a passthrough asset (a CV PDF) does not fail the build", async () => {
    // build() resolving in beforeAll is the proof the nav-target gate is gone;
    // confirm the asset the nav points at really shipped.
    expect(await Bun.file(join(outDir, "assets", "cv.pdf")).exists()).toBe(true);
  });

  test("the link checker flags a genuinely broken nav target but not the asset or route targets", async () => {
    let broken = await checkLinks(outDir);
    let targets = broken.map((b) => b.target);
    expect(targets).toContain("/nope");
    expect(targets).not.toContain("/assets/cv.pdf");
    expect(targets).not.toContain("/");
  });
});

describe("O12: fully-valid site reports no broken links", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({
      contentDir: DEMO_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("demo site has no broken internal links", async () => {
    let broken = await checkLinks(outDir);
    expect(broken).toEqual([]);
  });
});

describe("O12: percent-encoded paths resolve against the real file", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({
      contentDir: ENCODED_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("a link with %20 to a file named with a space is not reported broken", async () => {
    // /assets/My%20File.html must resolve to dist/assets/My File.html, which exists
    let broken = await checkLinks(outDir);
    expect(broken).toEqual([]);
  });
});
