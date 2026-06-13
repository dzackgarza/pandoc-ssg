import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { deploySite } from "../src/deploy.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

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
 * O19 — deploy mirrors a fresh build into a target directory with rsync --delete:
 * built files land byte-identical and stale files from a prior deploy are removed.
 */
describe("O19: deploy mirrors the build into a target directory", () => {
  let outDir: string;
  let deployDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-deploy-out-"));
    deployDir = await mkdtemp(join(tmpdir(), "ssg-deploy-tgt-"));
    // a stale artifact from a "previous deploy" that must be removed
    await mkdir(join(deployDir, "old"), { recursive: true });
    await writeFile(join(deployDir, "old", "stale.html"), "stale", "utf8");
    await build({ contentDir: DEMO_CONTENT, pandocDir: PANDOC_DIR, outDir });
    await deploySite(outDir, deployDir);
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
    await rm(deployDir, { recursive: true, force: true });
  });

  test("the target mirrors the build exactly (same file set)", async () => {
    const [built, deployed] = await Promise.all([walk(outDir), walk(deployDir)]);
    expect(deployed.sort()).toEqual(built.sort());
  });

  test("stale files from a prior deploy are removed", async () => {
    expect(await Bun.file(join(deployDir, "old", "stale.html")).exists()).toBe(false);
  });

  test("a deployed file is byte-identical to the build", async () => {
    const [a, b] = await Promise.all([
      readFile(join(outDir, "index.html")),
      readFile(join(deployDir, "index.html")),
    ]);
    expect(b.equals(a)).toBe(true);
  });
});
