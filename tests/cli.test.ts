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

describe("CLI dispatch", () => {
  test("running without a subcommand reports the missing command", async () => {
    const r = await runCli([]);

    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("missing subcommand");
    expect(r.stderr).not.toContain("undefined");
  });
});

describe("CLI build (O9)", () => {
  test("build on a valid site exits 0 and populates dist/index.html", async () => {
    const contentDir = await stageContent("valid-site");
    const outDir = await freshTmp("valid-out");

    const r = await runCli([
      "build",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,      "--out",
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
      PANDOC_DIR,      "--out",
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

  test("new post remains the built-in blog-post scaffold alias", async () => {
    const contentDir = await stageContent("roundtrip-site");

    const r = await runCli(["new", "post", "Alias Preserved", "--content", contentDir]);

    expect(r.exitCode).toBe(0);
    const prefix = todayPrefix();
    const expected = path.join(contentDir, "blog", `${prefix}-alias-preserved.md`);
    const parsed = matter(await Bun.file(expected).text());
    expect(parsed.data.site?.type).toBe("blog-post");
    expect(dateToYmd(parsed.data.date)).toBe(prefix);
  });

  test("new <type> scaffolds a registered custom page type", async () => {
    const contentDir = await stageContent("custom-scaffold-site");

    const r = await runCli(["new", "note", "Spectral Sequence", "--content", contentDir]);

    expect(r.exitCode).toBe(0);
    const expected = path.join(contentDir, "notes", "spectral-sequence.md");
    const parsed = matter(await Bun.file(expected).text());
    expect(parsed.data.title).toBe("Spectral Sequence");
    expect(parsed.data.summary).toBe("Draft note");
    expect(parsed.data.site).toEqual({ page: true, type: "note" });
  });

  test("new <type> --dir writes a registered scaffold into an explicit directory", async () => {
    const contentDir = await stageContent("custom-scaffold-site");

    const r = await runCli([
      "new",
      "note",
      "Filtered Complex",
      "--content",
      contentDir,
      "--dir",
      "drafts",
    ]);

    expect(r.exitCode).toBe(0);
    expect(await Bun.file(path.join(contentDir, "drafts", "filtered-complex.md")).exists()).toBe(true);
  });
});

describe("CLI check (O12)", () => {
  test("check on a site with a broken internal link exits nonzero and names the target", async () => {
    const contentDir = await stageContent("broken-links-site");
    const outDir = await freshTmp("check-broken-out");

    const r = await runCli([
      "check",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,      "--out",
      outDir,
    ]);

    expect(r.exitCode).not.toBe(0);
    // The broken target is structured contract data (O12); lychee reports the
    // resolved path with the trailing slash normalized off.
    expect(r.stdout + r.stderr).toContain("/missing/page");
  });

  test("check on a clean site exits 0", async () => {
    const contentDir = await stageContent("valid-site");
    const outDir = await freshTmp("check-clean-out");

    const r = await runCli([
      "check",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,      "--out",
      outDir,
    ]);

    expect(r.exitCode).toBe(0);
  });
});

describe("CLI serve (O13)", () => {
  test("serve starts a server over a built tree and answers a request", async () => {
    const contentDir = await stageContent("valid-site");
    const outDir = await freshTmp("serve-out");
    const built = await runCli([
      "build",
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,      "--out",
      outDir,
    ]);
    expect(built.exitCode).toBe(0);

    const proc = Bun.spawn(["bun", CLI, "serve", "--out", outDir, "--port", "0"], {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    });

    // The server announces "http://localhost:<port>/" on stdout once bound.
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let banner = "";
    let port = 0;
    while (port === 0) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      banner += decoder.decode(value);
      const m = banner.match(/http:\/\/localhost:(\d+)\//);
      if (m) {
        port = Number(m[1]);
      }
    }
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);

    await reader.cancel();
    proc.kill();
    await proc.exited;
    await fs.rm(outDir, { recursive: true, force: true });
  });
});

describe("CLI deploy gate (O15)", () => {
  test("deploy refuses to publish a site with a verification finding", async () => {
    const contentDir = await stageContent("deploy-gate-site");
    const outDir = await freshTmp("deploy-gate-out");
    const target = path.join(await freshTmp("deploy-gate-target"), "live");

    const r = await runCli([
      "deploy",
      target,
      "--content",
      contentDir,
      "--pandoc",
      PANDOC_DIR,      "--out",
      outDir,
    ]);

    expect(r.exitCode).not.toBe(0);
    // The page leaks un-migrated Liquid; verify reports it (structured contract).
    expect(r.stderr).toContain("unresolved-markup");
    // The gate aborted before publishing: nothing reached the live target.
    expect(await Bun.file(path.join(target, "index.html")).exists()).toBe(false);
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
      PANDOC_DIR,      "--out",
      outDir,
    ]);
    expect(built.exitCode).toBe(0);

    const postHtml = path.join(outDir, "blog", slug, "index.html");
    expect(await Bun.file(postHtml).exists()).toBe(true);
  });
});
