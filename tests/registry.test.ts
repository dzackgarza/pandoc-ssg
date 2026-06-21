import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");

let createdDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

type CapturedRejection = { rejected: true; error: unknown } | { rejected: false };

async function captureRejection(promise: Promise<unknown>): Promise<CapturedRejection> {
  let result: CapturedRejection;
  try {
    await promise;
    result = { rejected: false };
  } catch (error) {
    result = { rejected: true, error };
  }
  return result;
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

  test("malformed content registry page types fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-bad-");
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "registry-malformed", "content"),
          pandocDir: PANDOC_DIR,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: {
        name: "BuildError",
        kind: "config",
        files: ["_site.toml"],
      },
    });
  });

  test("component handlers referencing unknown islands fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-bad-island-");
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "registry-unknown-island", "content"),
          pandocDir: PANDOC_DIR,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: {
        name: "BuildError",
        kind: "config",
        files: ["_site.toml"],
      },
    });
  });

  test("page schemas without required title fail before rendering", async () => {
    const outDir = await tempDir("ssg-registry-schema-no-title-");
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "registry-schema-no-title", "content"),
          pandocDir: PANDOC_DIR,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: {
        name: "BuildError",
        kind: "config",
        files: ["_site.toml"],
      },
    });
  });

  test("unknown page type declarations fail loudly at the page boundary", async () => {
    const outDir = await tempDir("ssg-registry-unknown-");
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "registry-unknown-type", "content"),
          pandocDir: PANDOC_DIR,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: {
        name: "BuildError",
        kind: "schema",
        files: ["index.md"],
      },
    });
  });

  test("missing bundled registry fails at the bundled registry path", async () => {
    const outDir = await tempDir("ssg-registry-missing-out-");
    const pandocDir = await tempDir("ssg-registry-missing-pandoc-");
    expect(
      await captureRejection(
        build({
          contentDir: join(FIXTURES, "registry-unknown-type", "content"),
          pandocDir,
          outDir,
        }),
      ),
    ).toMatchObject({
      rejected: true,
      error: {
        name: "BuildError",
        kind: "config",
        files: [join(pandocDir, "registry.toml")],
      },
    });
  });
});
