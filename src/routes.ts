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
  void relPath;
  void routeOverride;
  throw new Error("not implemented");
}

/** "/" → "index.html"; "/a/b/" → "a/b/index.html" (outDir-relative). */
export function outputPathForRoute(url: string): string {
  void url;
  throw new Error("not implemented");
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
  void routes;
  void passthrough;
  throw new Error("not implemented");
}
