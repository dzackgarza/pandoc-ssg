import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import type { Manifest } from "../src/types.ts";
import { validateSite } from "../src/validate.ts";

const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(import.meta.dir, "fixtures", "site", "demo", "content");

function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-validate-"));
}

function route(output: string): Manifest {
  return {
    schemaVersion: 1,
    routes: [{ source: "x.md", url: "/x/", output, type: "page", schema: "page.v1" }],
    passthrough: [],
    generated: [],
  };
}

async function writeOut(dir: string, output: string, html: string): Promise<void> {
  let full = join(dir, output);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, html, "utf8");
}

const GOOD_PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Real Title</title></head>",
  "<body><nav></nav><main><h1>Real Title</h1><p>body</p></main></body></html>",
].join("\n");

describe("O14: structural validation flags malformed/un-migrated pages", () => {
  test("a well-formed page yields no issues", async () => {
    let dir = await freshDir();
    await writeOut(dir, "x/index.html", GOOD_PAGE);
    let issues = await validateSite(dir, route("x/index.html"));
    expect(issues).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  test("leftover Jekyll Liquid is flagged", async () => {
    let dir = await freshDir();
    await writeOut(dir, "x/index.html", GOOD_PAGE.replace("<p>body</p>", "<p>{% include x %}</p>"));
    let issues = await validateSite(dir, route("x/index.html"));
    expect(issues).toContainEqual({ page: "x/index.html", issue: "leftover-liquid" });
    await rm(dir, { recursive: true, force: true });
  });

  test("leftover kramdown attribute list is flagged", async () => {
    let dir = await freshDir();
    await writeOut(
      dir,
      "x/index.html",
      GOOD_PAGE.replace("<p>body</p>", "<p>note</p>\n{: .notice}"),
    );
    let issues = await validateSite(dir, route("x/index.html"));
    expect(issues).toContainEqual({ page: "x/index.html", issue: "leftover-kramdown" });
    await rm(dir, { recursive: true, force: true });
  });

  test("a page with no <main> and an empty title is flagged on both", async () => {
    let dir = await freshDir();
    await writeOut(
      dir,
      "x/index.html",
      "<!DOCTYPE html>\n<html><head><title></title></head><body><p>no landmark</p></body></html>",
    );
    let issues = await validateSite(dir, route("x/index.html"));
    let codes = issues.map((i) => i.issue);
    expect(codes).toContain("missing-main");
    expect(codes).toContain("empty-title");
    await rm(dir, { recursive: true, force: true });
  });

  test("output not starting with a doctype is flagged", async () => {
    let dir = await freshDir();
    await writeOut(
      dir,
      "x/index.html",
      "<html><head><title>T</title></head><main>hi</main></html>",
    );
    let issues = await validateSite(dir, route("x/index.html"));
    expect(issues).toContainEqual({ page: "x/index.html", issue: "missing-doctype" });
    await rm(dir, { recursive: true, force: true });
  });
});

describe("O14: a real built site validates clean", () => {
  let dir: string;
  let manifest: Manifest;

  beforeAll(async () => {
    dir = await freshDir();
    manifest = await build({ contentDir: DEMO_CONTENT, pandocDir: PANDOC_DIR, outDir: dir });
    // The demo runs the tikzcd filter (LaTeX -> pdf2svg per figure) — inherently
    // ~5-6s, past bun's default 5000ms hook timeout. Give headroom.
  }, 30000);

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the demo site has no structural issues", async () => {
    let issues = await validateSite(dir, manifest);
    expect(issues).toEqual([]);
  });
});
