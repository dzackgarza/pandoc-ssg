import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import type { Manifest } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

const DEMO_CONTENT = join(FIXTURES, "demo", "content");
const BAD_NAV_CONTENT = join(FIXTURES, "bad-nav", "content");
const BAD_SCHEMA_CONTENT = join(FIXTURES, "bad-schema", "content");

async function freshOutDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "ssg-out-"));
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
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
  return out.sort();
}

describe("O4 + O5: demo build content-mirror fidelity and rendering", () => {
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

  // ---- O4: content-mirror fidelity ----

  test("O4: syllabus.md/.pdf/.jpg are byte-identical to sources", async () => {
    const srcDir = join(DEMO_CONTENT, "2026", "spring", "math2250");
    const dstDir = join(outDir, "2026", "spring", "math2250");
    for (const name of ["syllabus.md", "syllabus.pdf", "mypic.jpg"]) {
      const src = await readFile(join(srcDir, name));
      const dst = await readFile(join(dstDir, name));
      expect(Buffer.compare(src, dst)).toBe(0);
    }
  });

  test("O4: copied syllabus.md is literal source markdown, not HTML", async () => {
    const dst = await readFile(
      join(outDir, "2026", "spring", "math2250", "syllabus.md"),
      "utf8",
    );
    expect(dst.startsWith("# Syllabus (personal notes)")).toBe(true);
    expect(dst.includes("<html")).toBe(false);
    expect(dst.includes("<!DOCTYPE")).toBe(false);
  });

  test("O4: non-opt-in syllabus.md is NOT compiled to syllabus/index.html", async () => {
    const compiled = join(
      outDir,
      "2026",
      "spring",
      "math2250",
      "syllabus",
      "index.html",
    );
    expect(await exists(compiled)).toBe(false);
  });

  test("O4: opaque standalone-app copied verbatim", async () => {
    const srcDir = join(DEMO_CONTENT, "standalone-app");
    const dstDir = join(outDir, "standalone-app");
    for (const name of ["index.html", "app.js"]) {
      const src = await readFile(join(srcDir, name));
      const dst = await readFile(join(dstDir, name));
      expect(Buffer.compare(src, dst)).toBe(0);
    }
  });

  test("O4: no reserved (underscore) path leaks into dist", async () => {
    const files = await walk(outDir);
    for (const f of files) {
      const leaks = f.split("/").some((seg) => seg.startsWith("_"));
      expect(leaks).toBe(false);
    }
    expect(await exists(join(outDir, "_data"))).toBe(false);
    expect(await exists(join(outDir, "_site.toml"))).toBe(false);
  });

  // ---- O5: rendering contract ----

  test("O5: dist/about/index.html is standalone HTML with title and converted body", async () => {
    const html = await readFile(join(outDir, "about", "index.html"), "utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);

    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    expect(titleMatch).not.toBeNull();
    expect(titleMatch![1]).toContain("About");

    expect(html).toContain('<h2 id="section">Section</h2>');
    expect(html).toContain("<em>emphasis</em>");
  });

  test("O5: inline math is wrapped for MathJax", async () => {
    const html = await readFile(join(outDir, "about", "index.html"), "utf8");
    expect(html).toContain('<span class="math inline">');
    expect(html).toContain("\\(E = mc^2\\)");
  });

  test("O5: MathJax config present exactly once and carries a macro value", async () => {
    const html = await readFile(join(outDir, "about", "index.html"), "utf8");
    const occurrences = html.split("window.MathJax").length - 1;
    expect(occurrences).toBe(1);
    expect(html).toContain("\\mathbb{A}");
  });

  test("O5: home route and blog route render with their titles", async () => {
    expect(await exists(join(outDir, "index.html"))).toBe(true);

    const blogPath = join(outDir, "blog", "2026-06-12-hello", "index.html");
    expect(await exists(blogPath)).toBe(true);
    const blogHtml = await readFile(blogPath, "utf8");
    expect(blogHtml).toContain("Hello World");
  });

  // ---- O7: rendered nav anchors ----

  test("O7: rendered about page contains nav anchors with titles", async () => {
    const html = await readFile(join(outDir, "about", "index.html"), "utf8");
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about/"');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Home");
    expect(html).toContain("About");
    expect(html).toContain("Example");
  });
});

describe("O7: navigation integrity failure", () => {
  test("nav target with no matching route rejects with BuildError kind=nav", async () => {
    const outDir = await freshOutDir();
    await expect(
      build({ contentDir: BAD_NAV_CONTENT, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "nav" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("O3: fail-fast schema validation leaves no partial output", () => {
  test("broken page rejects with kind=schema naming the file, dist stays empty", async () => {
    const outDir = await freshOutDir();
    await expect(
      build({ contentDir: BAD_SCHEMA_CONTENT, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({
      name: "BuildError",
      kind: "schema",
      files: ["broken.md"],
    });

    const remaining = await walk(outDir);
    expect(remaining).toEqual([]);
    await rm(outDir, { recursive: true, force: true });
  });
});
