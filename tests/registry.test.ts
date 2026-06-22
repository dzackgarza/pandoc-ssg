import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { BuildError } from "../src/errors.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

let createdDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

async function expectBuildError(
  promise: Promise<unknown>,
  expected: { kind: string; files: string[] },
): Promise<void> {
  await expect(promise).rejects.toThrow(BuildError);
  await expect(promise).rejects.toMatchObject({ name: "BuildError", ...expected });
}

afterEach(async () => {
  const dirs = createdDirs;
  createdDirs = [];
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("C1: registry foundation", () => {
  test("content _site.toml extends the bundled registry with an explicit page type", async () => {
    const outDir = await tempDir("ssg-registry-override-");
    const manifest = await build({
      contentDir: join(FIXTURES, "registry-override", "content"),
      pandocDir: PANDOC_DIR,
      outDir,
    });

    expect(manifest.routes).toContainEqual({
      source: "essays/sample.md",
      url: "/essays/sample/",
      output: "essays/sample/index.html",
      type: "essay",
      schema: "essay.v1",
    });

    const html = await readFile(join(outDir, "essays", "sample", "index.html"), "utf8");
    expect(html).toContain("<title>Registry Essay</title>");
    expect(html).toContain('<h2 id="registry-controlled-heading">Registry Controlled Heading</h2>');
  });

  test("content registry owns custom page files when source is omitted", async () => {
    const outDir = await tempDir("ssg-registry-render-");
    const manifest = await build({
      contentDir: join(FIXTURES, "registry-render", "content"),
      pandocDir: PANDOC_DIR,
      outDir,
    });

    expect(manifest.routes).toContainEqual({
      source: "essays/sample.md",
      url: "/essays/sample/",
      output: "essays/sample/index.html",
      type: "essay",
      schema: "essay.v1",
    });

    const html = await readFile(join(outDir, "essays", "sample", "index.html"), "utf8");
    expect(html).toContain('data-template="essay"');
    expect(html).toContain('<p class="subtitle">Custom template and filter</p>');
    expect(html).toContain('<p class="registry-filter">filtered-by-content</p>');
  });

  test("malformed content registry page types fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-bad-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-malformed", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "config", files: ["_site.toml"] },
    );
  });

  test("unknown registry filter paths fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-missing-filter-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-missing-filter", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "config", files: ["_site.toml"] },
    );
  });

  test("component handlers referencing unknown islands fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-bad-island-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-unknown-island", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "config", files: ["_site.toml"] },
    );
  });

  test("component handlers referencing missing Lua modules fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-missing-handler-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-missing-component-handler", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "config", files: ["_site.toml"] },
    );
  });

  test("page schemas without required title fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-schema-no-title-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-schema-no-title", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "config", files: ["_site.toml"] },
    );
  });

  test("unknown page type declarations fail loudly at the page boundary", async () => {
    const outDir = await tempDir("ssg-registry-unknown-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-unknown-type", "content"),
        pandocDir: PANDOC_DIR,
        outDir,
      }),
      { kind: "schema", files: ["index.md"] },
    );
  });

  test("missing bundled registry fails at the bundled registry path", async () => {
    const outDir = await tempDir("ssg-registry-missing-out-");
    const pandocDir = await tempDir("ssg-registry-missing-pandoc-");
    await expectBuildError(
      build({
        contentDir: join(FIXTURES, "registry-unknown-type", "content"),
        pandocDir,
        outDir,
      }),
      { kind: "config", files: [join(pandocDir, "registry.toml")] },
    );
  });
});
