import { join } from "node:path";

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
   * - { aheadBy: n } n>0 — pandoc-config advanced n commits past known-good;
   * - { aheadBy: 0 } — current is exactly the known-good;
   * - { aheadBy: -1 } — current is not a descendant of known-good (diverged/older).
   */
  drift: { aheadBy: number } | null;
}

async function git(cwd: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  let proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  // Drain BOTH streams: leaving stderr unconsumed can deadlock on a full pipe
  // buffer, and discarding it would lose the real git diagnostic. A missing git
  // binary or bad cwd makes Bun.spawn throw, which propagates (fail loud) rather
  // than being swallowed into a generic result.
  let [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  let code = await proc.exited;
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

/** Committed per-site marker recording the pandoc-config version the site was last verified against. */
export function knownGoodMarkerPath(contentDir: string): string {
  return join(contentDir, "..", "pandoc-config.known-good");
}

/** `git describe` of the central pandoc-config checkout, or null when pandocHome is not a git repo. */
export async function resolvePandocConfigVersion(pandocHome: string): Promise<string | null> {
  let described = await git(pandocHome, ["describe", "--tags", "--always", "--dirty"]);
  if (!described.ok) {
    // A non-git pandocHome is the expected domain case; surface git's own
    // diagnostic so a real failure (corrupt repo, permissions) is not hidden
    // behind the generic "provenance unavailable" message.
    if (described.err !== "") {
      process.stderr.write(`pandoc-config: cannot resolve version in ${pandocHome}: ${described.err}\n`);
    }
    return null;
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

async function driftAgainst(pandocHome: string, knownGood: string): Promise<{ aheadBy: number } | null> {
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
