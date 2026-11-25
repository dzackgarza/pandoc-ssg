import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { BuildError } from "./errors.ts";

/**
 * Provenance + drift tracking for the central pandoc machinery.
 *
 * `pandocHome` (the XDG `pandoc_home`, i.e. ~/.pandoc) is the `dzackgarza/pandoc-config`
 * git checkout — the single shared source of truth for filters/templates/macros. We do not
 * pin it and we do not vendor a per-site copy; builds float on whatever it currently is.
 * To keep that float honest rather than silent, each site records the pandoc-config version
 * it was last *verified* against (the known-good marker), and a build whose pandoc-config has
 * advanced past that marker warns loudly so the site gets re-verified and the stamp bumped.
 *
 * The version handle is `git describe --tags`, so it reads as a release (`v1.4.0`) once
 * pandoc-config is tagged and degrades to a bare commit until then.
 */
export interface PandocConfigStatus {
  /** `git describe --tags --always --dirty` of pandocHome; null when it is not a git repo. */
  version: string | null;
  /** The site's last-verified version from the committed marker; null when unset. */
  knownGood: string | null;
  /**
   * Drift of the current pandoc-config against the site's known-good:
   * - null when there is nothing to compare (no version or no known-good);
   * - aheadBy n>0 — pandoc-config advanced n commits past known-good;
   * - aheadBy zero — current is exactly the known-good;
   * - aheadBy -1 — current is not a descendant of known-good (diverged/older).
   *   A git failure during the count yields null, never a false zero.
   */
  drift: { aheadBy: number } | null;
}

async function git(cwd: string, args: string[], raw = false): Promise<{ ok: boolean; out: string }> {
  // stderr inherits the parent's, so git's own diagnostics ("fatal: not a git
  // repository", "permission denied", …) are preserved and visible — never
  // piped-and-discarded. A missing git binary or bad cwd makes Bun.spawn throw,
  // which propagates (fail loud) rather than being swallowed into a result.
  let proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "inherit" });
  let out = await new Response(proc.stdout).text();
  let code = await proc.exited;
  return { ok: code === 0, out: raw ? out : out.trim() };
}

/** Committed per-site marker recording the pandoc-config version the site was last verified against. */
export function knownGoodMarkerPath(contentDir: string): string {
  return join(contentDir, "..", "pandoc-config.known-good");
}

/** `git describe` of the central pandoc-config checkout, or null when pandocHome is not a git repo. */
export async function resolvePandocConfigVersion(pandocHome: string): Promise<string | null> {
  let described = await git(pandocHome, ["describe", "--tags", "--always", "--dirty"]);
  if (!described.ok) {
    // describe exits non-zero when pandocHome is not a git repo — the expected
    // domain case. git's own stderr (inherited) explains any real failure
    // (corrupt repo, permissions) directly, so nothing is hidden here.
    return null;
  }
  return described.out;
}

/**
 * Resolve a version suitable for a known-good marker, not merely a build's
 * provenance. A dirty worktree cannot certify the committed render inputs.
 */
export async function resolveCleanPandocConfigVersion(pandocHome: string): Promise<string> {
  let status = await git(pandocHome, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  if (!status.ok) {
    throw new BuildError(
      "config",
      [],
      "cannot bump known-good: unable to inspect pandocHome Git status",
    );
  }
  if (status.out !== "") {
    throw new BuildError(
      "config",
      [],
      "cannot bump known-good: pandocHome has uncommitted changes; commit or remove them first",
    );
  }
  // Unlike build provenance, this describes a committed object explicitly;
  // Git must not append a synthetic "-dirty" suffix to the marker.
  let described = await git(pandocHome, ["describe", "--tags", "--always", "HEAD"]);
  if (!described.ok) {
    throw new BuildError(
      "config",
      [],
      "cannot bump known-good: pandocHome has no resolvable Git version",
    );
  }
  return described.out;
}

async function readKnownGood(contentDir: string): Promise<string | null> {
  let marker = Bun.file(knownGoodMarkerPath(contentDir));
  if (!(await marker.exists())) {
    return null;
  }
  let trimmed = (await marker.text()).trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed;
}

/** Write the current pandoc-config version into the committed marker; returns the marker path. */
export async function writeKnownGood(contentDir: string, version: string): Promise<string> {
  let path = knownGoodMarkerPath(contentDir);
  await Bun.write(path, `${version}\n`);
  return path;
}

async function driftAgainst(
  pandocHome: string,
  knownGood: string,
): Promise<{ aheadBy: number } | null> {
  let kg = await git(pandocHome, ["rev-parse", `${knownGood}^{commit}`]);
  if (!kg.ok) {
    return null;
  }
  let ancestor = await git(pandocHome, ["merge-base", "--is-ancestor", kg.out, "HEAD"]);
  if (!ancestor.ok) {
    return { aheadBy: -1 };
  }
  let count = await git(pandocHome, ["rev-list", "--count", `${kg.out}..HEAD`]);
  if (!count.ok) {
    // Drift indeterminate — do NOT report aheadBy:0, which would falsely read as
    // "exactly up to date" when the count simply could not be computed.
    return null;
  }
  return { aheadBy: Number(count.out) };
}

/** Resolve the current pandoc-config version, the site's known-good, and the drift between them. */
export async function pandocConfigStatus(
  pandocHome: string,
  contentDir: string,
): Promise<PandocConfigStatus> {
  let version = await resolvePandocConfigVersion(pandocHome);
  let knownGood = await readKnownGood(contentDir);
  let drift: { aheadBy: number } | null = null;
  if (version !== null && knownGood !== null) {
    drift = await driftAgainst(pandocHome, knownGood);
  }
  return { version, knownGood, drift };
}

/** Observe the Git checkout at either end of rendering, including already-dirty
 * tracked files and untracked files. This is a change detector, not a lock:
 * floating builds still use the live tree rather than a pinned checkout.
 */
export async function pandocConfigInputState(
  pandocHome: string,
): Promise<{ version: string; fingerprint: string } | null> {
  const version = await resolvePandocConfigVersion(pandocHome);
  if (version === null) {
    return null;
  }
  const [head, diff, status, untracked] = await Promise.all([
    git(pandocHome, ["rev-parse", "HEAD"]),
    git(pandocHome, ["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"], true),
    git(
      pandocHome,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
      true,
    ),
    git(pandocHome, ["ls-files", "--others", "--exclude-standard", "-z"], true),
  ]);
  if (!head.ok || !diff.ok || !status.ok || !untracked.ok) {
    return null;
  }
  const hash = createHash("sha256");
  hash.update(JSON.stringify([head.out, diff.out, status.out]));
  try {
    for (const name of untracked.out.split("\0").filter(Boolean)) {
      const path = join(pandocHome, name);
      const stat = await lstat(path);
      if (!stat.isSymbolicLink() && !stat.isFile()) {
        return null;
      }
      const content = stat.isSymbolicLink() ? await readlink(path) : await readFile(path);
      hash.update(JSON.stringify([name, stat.mode, createHash("sha256").update(content).digest("hex")]));
    }
  } catch (error) {
    // The tree may change or become unreadable while being inspected.
    process.stderr.write(`pandoc-config: cannot inspect untracked inputs: ${String(error)}\n`);
    return null;
  }
  return { version, fingerprint: hash.digest("hex") };
}
