import { BuildError } from "./errors.ts";
import type { PassthroughEntry, RouteEntry } from "./types.ts";

/**
 * Deterministic routing (O2):
 *   index.md            → "/"
 *   foo.md              → "/foo/"
 *   a/b/index.md        → "/a/b/"
 *   a/b/c.md            → "/a/b/c/"
 * A validated `site.route` override replaces the inferred URL.
 */
export function routeForPage(relPath: string, routeOverride?: string): string {
  if (routeOverride !== undefined) {
    return routeOverride;
  }
  const withoutExt = relPath.replace(/\.md$/, "");
  if (withoutExt === "index") {
    return "/";
  }
  if (withoutExt.endsWith("/index")) {
    return `/${withoutExt.slice(0, -"/index".length)}/`;
  }
  return `/${withoutExt}/`;
}

/** "/" → "index.html"; "/a/b/" → "a/b/index.html" (outDir-relative). */
export function outputPathForRoute(url: string): string {
  const inner = url.slice(1, -1);
  return inner === "" ? "index.html" : `${inner}/index.html`;
}

/**
 * Injectivity check (O2): any two entries (page routes or passthrough
 * copies) sharing one output path throw BuildError(kind="route-collision")
 * with both sources in `files`.
 */
export function assertNoCollisions(
  routes: RouteEntry[],
  passthrough: PassthroughEntry[],
): void {
  const seen = new Map<string, string>();
  const entries: { output: string; source: string }[] = [
    ...routes.map((r) => ({ output: r.output, source: r.source })),
    ...passthrough.map((p) => ({ output: p.output, source: p.source })),
  ];
  for (const { output, source } of entries) {
    const prior = seen.get(output);
    if (prior !== undefined) {
      throw new BuildError(
        "route-collision",
        [prior, source],
        `output path collision at ${output}: ${prior} and ${source}`,
      );
    }
    seen.set(output, source);
  }
}
