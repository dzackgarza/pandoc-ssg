import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knownGoodMarkerPath,
  pandocConfigStatus,
  resolvePandocConfigVersion,
  writeKnownGood,
} from "../src/pandoc-config.ts";

const temps: string[] = [];
afterAll(async () => {
  for (const t of temps) {
    await rm(t, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

async function commit(repo: string, msg: string): Promise<void> {
  await writeFile(join(repo, "f.txt"), msg);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", msg]);
}

/** A throwaway pandoc-config checkout: one commit tagged v1.0.0. */
async function setupPandocHome(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "pandoc-config-"));
  temps.push(repo);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "commit.gpgsign", "false"]);
  // Disable any globally-configured hooks (core.hooksPath) so commits in this
  // throwaway repo do not trigger the machine's pre-commit QC.
  await git(repo, ["config", "core.hooksPath", "/dev/null"]);
  await commit(repo, "one");
  await git(repo, ["tag", "v1.0.0"]);
  return repo;
}

async function tempContent(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "site-"));
  temps.push(root);
  const content = join(root, "content");
  await mkdir(content, { recursive: true });
  return content;
}

describe("pandoc-config provenance + drift", () => {
  test("version resolves to git describe (the tag)", async () => {
    const home = await setupPandocHome();
    expect(await resolvePandocConfigVersion(home)).toBe("v1.0.0");
  });

  test("non-git pandocHome yields a null version, not a throw", async () => {
    const notGit = await mkdtemp(join(tmpdir(), "notgit-"));
    temps.push(notGit);
    expect(await resolvePandocConfigVersion(notGit)).toBeNull();
  });

  test("no known-good marker means no drift to report", async () => {
    const status = await pandocConfigStatus(await setupPandocHome(), await tempContent());
    expect(status.knownGood).toBeNull();
    expect(status.drift).toBeNull();
  });

  test("known-good equal to HEAD is up to date (aheadBy 0)", async () => {
    const home = await setupPandocHome();
    const content = await tempContent();
    await writeKnownGood(content, "v1.0.0");
    const status = await pandocConfigStatus(home, content);
    expect(status.knownGood).toBe("v1.0.0");
    expect(status.drift).toEqual({ aheadBy: 0 });
  });

  test("pandoc-config advanced past known-good reports the commit count", async () => {
    const home = await setupPandocHome();
    const content = await tempContent();
    await writeKnownGood(content, "v1.0.0");
    await commit(home, "two");
    await commit(home, "three");
    expect((await pandocConfigStatus(home, content)).drift).toEqual({ aheadBy: 2 });
  });

  test("bump records the current version so drift clears", async () => {
    const home = await setupPandocHome();
    const content = await tempContent();
    await commit(home, "two");
    const version = await resolvePandocConfigVersion(home);
    if (version === null) {
      throw new Error("expected a resolvable version");
    }
    const written = await writeKnownGood(content, version);
    expect(written).toBe(knownGoodMarkerPath(content));
    expect((await pandocConfigStatus(home, content)).drift).toEqual({ aheadBy: 0 });
  });
});
