import { mkdir } from "node:fs/promises";
import { BuildError } from "./errors.ts";

/**
 * Mirror a built tree into a deploy directory with `rsync -a --delete` (O19):
 * every built file is copied byte-identical and any file in `deployDir` absent
 * from `outDir` is removed, so no stale artifacts from a prior deploy survive.
 * The trailing slashes make rsync mirror the *contents* of outDir into deployDir.
 * rsync is a required dependency; a missing binary or nonzero exit fails loudly.
 */
export async function deploySite(outDir: string, deployDir: string): Promise<boolean> {
  await mkdir(deployDir, { recursive: true });
  let proc = Bun.spawn(["rsync", "-a", "--delete", `${outDir}/`, `${deployDir}/`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) {
    throw new BuildError(
      "deploy",
      [],
      `rsync exited ${exitCode} deploying to ${deployDir}: ${stderr}`,
    );
  }
  return true;
}
