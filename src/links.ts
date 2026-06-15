import { resolve } from "node:path";

export interface BrokenLink {
  sourcePage: string;
  target: string;
}

interface LycheeReport {
  error_map: Record<string, Array<{ url: string }>>;
}

/**
 * Validate links in a built site with lychee — the link checker owns link
 * extraction, %-decoding, directory-index resolution, and checking. `--offline`
 * resolves root-relative links against the built tree (via --root-dir) without
 * the network, so the build-time check is deterministic; external links are
 * confirmed by the separate live-online pass (lychee against the deployed URL).
 *
 * Returns each broken internal link as { sourcePage (dist-relative HTML file),
 * target (the failing site path) }, sorted deterministically. lychee exits 2
 * when it finds broken links and 0 when clean; any other code is a tool failure.
 */
export async function checkLinks(distDir: string): Promise<BrokenLink[]> {
  let root = resolve(distDir);
  let proc = Bun.spawn(
    ["lychee", "--offline", "--format", "json", "--no-progress", "--root-dir", root, root],
    { stdout: "pipe", stderr: "pipe" },
  );
  let [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`lychee failed (exit ${exitCode}) on ${root}: ${err}`);
  }

  let report = JSON.parse(out) as LycheeReport;
  let filePrefix = `file://${root}/`;
  let broken: BrokenLink[] = [];
  for (const [file, links] of Object.entries(report.error_map)) {
    let sourcePage = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    for (const link of links) {
      let target = link.url.startsWith(filePrefix)
        ? `/${link.url.slice(filePrefix.length)}`
        : link.url;
      broken.push({ sourcePage, target });
    }
  }

  broken.sort((a, b) => {
    if (a.sourcePage !== b.sourcePage) {
      return a.sourcePage < b.sourcePage ? -1 : 1;
    }
    if (a.target === b.target) {
      return 0;
    }
    return a.target < b.target ? -1 : 1;
  });
  return broken;
}
