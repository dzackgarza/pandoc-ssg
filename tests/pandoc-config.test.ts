import { afterAll, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${err}`);
  }
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

/** Run the real CLI with an isolated generator configuration and Git checkout. */
async function cliFixture() {
  const home = await setupPandocHome();
  const content = await tempContent();
  const xdg = await mkdtemp(join(tmpdir(), "pandoc-config-xdg-"));
  temps.push(xdg);
  const config = join(xdg, "pandoc-ssg");
  await mkdir(config);
  await writeFile(
    join(config, "config.toml"),
    `pandoc_home = "${home}"\nmathjax_macro_manifest = "${join(home, "f.txt")}"\n`,
  );
  const marker = knownGoodMarkerPath(content);
  await writeKnownGood(content, "v1.0.0");
  await commit(home, "two");
  return { home, content, xdg, marker };
}

async function runPandocConfigCli(sub: string, content: string, xdg: string) {
  const proc = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "pandoc-config",
      sub,
      "--content",
      content,
    ],
    {
      env: { ...process.env, XDG_CONFIG_HOME: xdg },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe("pandoc-config bump CLI", () => {
  test.each(["unstaged", "staged", "untracked"])(
    "refuses %s changes and preserves the previous marker byte-for-byte",
    async (kind) => {
      const { home, content, xdg, marker } = await cliFixture();
      const previous = await Bun.file(marker).text();
      if (kind === "untracked") {
        await writeFile(join(home, "extra.lua"), "-- uncommitted filter");
        // Even a repository configured to hide untracked files must reject them.
        await git(home, ["config", "status.showUntrackedFiles", "no"]);
      } else {
        await writeFile(join(home, "f.txt"), "uncommitted render input");
        if (kind === "staged") {
          await git(home, ["add", "f.txt"]);
        }
      }
      const result = await runPandocConfigCli("bump", content, xdg);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("commit");
      expect(await Bun.file(marker).text()).toBe(previous);
    },
  );

  test.each(["non-repository", "unborn HEAD"])(
    "refuses a %s and preserves the marker",
    async (kind) => {
      const { home, content, xdg, marker } = await cliFixture();
      const previous = await Bun.file(marker).text();
      await rm(join(home, ".git"), { recursive: true });
      if (kind === "unborn HEAD") {
        await rm(join(home, "f.txt"));
        await git(home, ["init", "-q", "-b", "main"]);
      }
      const result = await runPandocConfigCli("bump", content, xdg);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("cannot bump known-good");
      expect(await Bun.file(marker).text()).toBe(previous);
    },
  );

  test.each(["v1.0.0", "v1.0.0-dirty"])(
    "a clean bump replaces %s with a resolvable HEAD version which print can read",
    async (previous) => {
      const { home, content, xdg, marker } = await cliFixture();
      await writeKnownGood(content, previous);
      const expected = await git(home, ["describe", "--tags", "--always"]);
      const result = await runPandocConfigCli("bump", content, xdg);
      expect(result.exitCode).toBe(0);
      expect(await Bun.file(marker).text()).toBe(`${expected}\n`);
      expect(await git(home, ["rev-parse", `${expected}^{commit}`])).toBe(
        await git(home, ["rev-parse", "HEAD"]),
      );
      const printed = await runPandocConfigCli("print", content, xdg);
      expect(printed.exitCode).toBe(0);
      expect(printed.stderr).toBe("");
      expect(printed.stdout).toContain(`known-good:            ${expected}`);
      expect((await pandocConfigStatus(home, content)).drift).toEqual({ aheadBy: 0 });
    },
  );
});

async function buildFixture(change: "none" | "config" | "tracked" | "untracked") {
  const { home, content, xdg, marker } = await cliFixture();
  const configPath = join(xdg, "pandoc-ssg", "config.toml");
  const manifest = join(import.meta.dir, "fixtures", "macros", "manifest.txt");
  const other = await setupPandocHome();
  await git(other, ["tag", "-d", "v1.0.0"]);
  await git(other, ["tag", "other-version"]);
  const replacement = `pandoc_home = "${other}"\nmathjax_macro_manifest = "${manifest}"\n`;
  const writeLua = (path: string, value: string) =>
    `local f = assert(io.open(${JSON.stringify(path)}, "w"))
f:write(${JSON.stringify(value)})
f:close()`;
  const effect =
    change === "config"
      ? writeLua(configPath, replacement)
      : change === "tracked" || change === "untracked"
        ? writeLua(join(home, change === "tracked" ? "f.txt" : "untracked.txt"), "changed during rendering")
        : "";
  await mkdir(join(home, "filters"));
  await writeFile(
    join(home, "filters", "convert_amsthm_envs.lua"),
    `function Pandoc(doc)
${effect}
table.insert(doc.blocks, pandoc.Para{pandoc.Str("RenderedFromFirstCheckout")})
return doc
end`,
  );
  await writeFile(join(home, "filters", "tikzcd.lua"), "return {}\n");
  await git(home, ["add", "filters"]);
  await git(home, ["commit", "-m", "rendering filters"]);
  await git(home, ["tag", "first-version"]);
  if (change === "tracked" || change === "untracked") {
    // An already-dirty checkout must not hide a second modification.
    await writeFile(join(home, change === "tracked" ? "f.txt" : "untracked.txt"), "changed before rendering");
  }
  await writeKnownGood(content, "v1.0.0");
  await writeFile(configPath, `pandoc_home = "${home}"\nmathjax_macro_manifest = "${manifest}"\n`);
  await copyFile(
    join(import.meta.dir, "fixtures", "cli", "valid-site", "content", "_site.toml"),
    join(content, "_site.toml"),
  );
  await copyFile(
    join(import.meta.dir, "fixtures", "cli", "valid-site", "content", "index.md"),
    join(content, "index.md"),
  );
  return { home, content, xdg, marker, configPath, replacement, out: join(content, "..", "dist") };
}

async function runBuildCli(fixture: Awaited<ReturnType<typeof buildFixture>>) {
  const proc = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "../src/cli.ts"),
      "build",
      "--content",
      fixture.content,
      "--out",
      fixture.out,
    ],
    {
      env: { ...process.env, XDG_CONFIG_HOME: fixture.xdg },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

describe("build CLI provenance", () => {
  test.each(["none", "config"] as const)(
    "reports the checkout that supplied the actual Pandoc filters (change: %s)",
    async (change) => {
      const fixture = await buildFixture(change);
      const result = await runBuildCli(fixture);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      expect(result.exitCode).toBe(0);
      expect(await Bun.file(join(fixture.out, "index.html")).text()).toContain(
        "RenderedFromFirstCheckout",
      );
      expect(result.stdout).toContain("pandoc-config: built against first-version");
      expect(result.stdout).not.toContain("other-version");
      expect(result.stderr).toContain("advanced 2 commit(s)");
      if (change === "config") {
        expect(await Bun.file(fixture.configPath).text()).toBe(fixture.replacement);
      }
    },
    30000,
  );

  test.each(["tracked", "untracked"] as const)(
    "warns rather than certifying a checkout whose %s input changed during rendering",
    async (change) => {
      const fixture = await buildFixture(change);
      const result = await runBuildCli(fixture);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      expect(result.exitCode).toBe(0);
      expect(await Bun.file(join(fixture.out, "index.html")).text()).toContain(
        "RenderedFromFirstCheckout",
      );
      expect(
        await Bun.file(join(fixture.home, change === "tracked" ? "f.txt" : "untracked.txt")).text(),
      ).toBe("changed during rendering");
      expect(result.stdout).not.toContain("built against");
      expect(result.stderr).toContain("pandocHome changed during the build");
    },
    30000,
  );
});
