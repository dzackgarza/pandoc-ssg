import { resolve } from "node:path";
import type { Manifest } from "./types.ts";

export interface BrokenLink {
  sourcePage: string;
  target: string;
}

interface LycheeReport {
  error_map: Record<string, Array<{ url: string }>>;
}

/** Deterministic order: by source page, then target. */
function sortBroken(broken: BrokenLink[]): BrokenLink[] {
  return broken.sort((a, b) => {
    if (a.sourcePage !== b.sourcePage) {
      return a.sourcePage < b.sourcePage ? -1 : 1;
    }
    if (a.target === b.target) {
      return 0;
    }
    return a.target < b.target ? -1 : 1;
  });
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

  return sortBroken(broken);
}

/**
 * Validate links against a *live* served site — the deploy preflight. lychee
 * fetches each route's page over HTTP from the running preview server and
 * checks every link: internal links against the server, and external links
 * against the real internet, so a dead external URL is caught before the site
 * is published. Online by definition — requires network. Returns the same
 * BrokenLink shape with server-relative paths.
 */
export async function checkServedLinks(baseUrl: string, manifest: Manifest): Promise<BrokenLink[]> {
  let inputs = manifest.routes.map((r) => `${baseUrl}${r.url}`);
  if (inputs.length === 0) {
    return [];
  }
  let proc = Bun.spawn(["lychee", "--format", "json", "--no-progress", ...inputs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0 && exitCode !== 2) {
    throw new Error(`lychee failed (exit ${exitCode}) on ${baseUrl}: ${err}`);
  }

  let report = JSON.parse(out) as LycheeReport;
  let broken: BrokenLink[] = [];
  for (const [page, links] of Object.entries(report.error_map)) {
    let sourcePage = page.startsWith(baseUrl) ? page.slice(baseUrl.length) : page;
    for (const link of links) {
      let target = link.url.startsWith(baseUrl) ? link.url.slice(baseUrl.length) : link.url;
      broken.push({ sourcePage, target });
    }
  }
  return sortBroken(broken);
}
