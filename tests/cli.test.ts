/**
 * RED spec for the CLI (O9). Invokes `bun src/cli.ts <args>` as a real
 * subprocess and asserts exit codes / scaffolded files / dist outputs.
 * No mocks, no try/catch, no assertions on error-message prose.
 */
import { describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";

const REPO = path.resolve(import.meta.dir, "..");
const CLI = path.join(REPO, "src", "cli.ts");
const FIXTURES = path.join(REPO, "tests", "fixtures", "cli");
const PANDOC_DIR = path.join(REPO, "pandoc");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

/** Fresh temp directory unique to each test. */
function freshTmp(label: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `pandoc-ssg-${label}-`));
}

/** Copy a committed fixture's content/ tree into a fresh temp content dir. */
async function stageContent(fixtureName: string): Promise<string> {
  const dst = path.join(await freshTmp(fixtureName), "content");
  await fs.cp(path.join(FIXTURES, fixtureName, "content"), dst, {
    recursive: true,
  });
  return dst;
}

/** Today's date as YYYY-MM-DD in local time (matches scaffold prefix). */
function todayPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Normalize a frontmatter date value (Date or string) to YYYY-MM-DD. */
function dateToYmd(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return String(value);
}

describe("CLI build (O9)", () => {
  test("build on a valid site exits 0 and populates dist/index.html", async () => {
    const contentDir = await stageContent("valid-site");
    const outDir = await freshTmp("valid-out");

    const r = await runCli([
      "build",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,
      "--out",
      outDir,
    ]);

    expect(r.exitCode).toBe(0);
    const indexHtml = path.join(outDir, "index.html");
    expect(await Bun.file(indexHtml).exists()).toBe(true);
  });

  test("build on an invalid site exits nonzero and names the offending file", async () => {
    const contentDir = await stageContent("invalid-site");
    const outDir = await freshTmp("invalid-out");

    const r = await runCli([
      "build",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,
      "--out",
      outDir,
    ]);

    expect(r.exitCode).not.toBe(0);
    // Offending content-relative path is structured contract data (O3).
    expect(r.stderr).toContain(path.join("blog", "bad.md"));
  });
});

describe("CLI new post (O9)", () => {
  test("scaffolds a dated, slugified blog post with valid frontmatter, exit 0", async () => {
    const contentDir = await stageContent("roundtrip-site");

    const r = await runCli(["new", "post", "My First Post", "--content", contentDir]);

    expect(r.exitCode).toBe(0);

    const prefix = todayPrefix();
    const expected = path.join(contentDir, "blog", `${prefix}-my-first-post.md`);
    expect(await Bun.file(expected).exists()).toBe(true);

    const parsed = matter(await Bun.file(expected).text());
    expect(parsed.data.title).toBe("My First Post");
    expect(parsed.data.site?.page).toBe(true);
    expect(dateToYmd(parsed.data.date)).toBe(prefix);
  });

  test("running new post twice for the same title fails the second time", async () => {
    const contentDir = await stageContent("roundtrip-site");
    const args = ["new", "post", "My First Post", "--content", contentDir];

    const first = await runCli(args);
    expect(first.exitCode).toBe(0);

    const second = await runCli(args);
    expect(second.exitCode).not.toBe(0);
  });

  test("new post with no title exits nonzero", async () => {
    const contentDir = await stageContent("roundtrip-site");
    const r = await runCli(["new", "post", "--content", contentDir]);
    expect(r.exitCode).not.toBe(0);
  });
});

describe("CLI argument errors (O9)", () => {
  test("unknown subcommand exits nonzero", async () => {
    const r = await runCli(["frobnicate"]);
    expect(r.exitCode).not.toBe(0);
  });
});

describe("CLI scaffold-then-build round trip (O9)", () => {
  test("new post then build emits dist/blog/<slug>/index.html", async () => {
    const contentDir = await stageContent("roundtrip-site");
    const outDir = await freshTmp("roundtrip-out");

    const scaffold = await runCli(["new", "post", "My First Post", "--content", contentDir]);
    expect(scaffold.exitCode).toBe(0);

    const prefix = todayPrefix();
    const slug = `${prefix}-my-first-post`;
    const scaffolded = path.join(contentDir, "blog", `${slug}.md`);
    expect(await Bun.file(scaffolded).exists()).toBe(true);

    const built = await runCli([
      "build",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,
      "--out",
      outDir,
    ]);
    expect(built.exitCode).toBe(0);

    const postHtml = path.join(outDir, "blog", slug, "index.html");
    expect(await Bun.file(postHtml).exists()).toBe(true);
  });
});
