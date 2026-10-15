import { parse } from "node:path/posix";
import { BuildError } from "../errors.ts";
import type { PassthroughEntry, RouteEntry } from "../types.ts";

/**
 * Deterministic routing (O2):
 *   index.md            maps to "/"
 *   foo.md              maps to "/foo/"
 *   a/b/index.md        maps to "/a/b/"
 *   a/b/c.md            maps to "/a/b/c/"
 * A validated `site.route` override replaces the inferred URL. node:path/posix
 * owns splitting the dir from the extension-stripped name.
 */
export function routeForPage(relPath: string, routeOverride: string | false = false): string {
  if (routeOverride) {
    return routeOverride;
  }
  let { dir, name } = parse(relPath);
  if (name === "index") {
    return dir === "" ? "/" : `/${dir}/`;
  }
  return dir === "" ? `/${name}/` : `/${dir}/${name}/`;
}

/** "/" maps to "index.html"; "/a/b/" maps to "a/b/index.html" (outDir-relative). */
export function outputPathForRoute(url: string): string {
  let inner = url.slice(1, -1);
  return inner === "" ? "index.html" : `${inner}/index.html`;
}

/**
 * Injectivity check (O2): page routes and passthrough copies must not share
 * one output path. Collisions throw BuildError(kind="route-collision") with
 * both sources in `files`.
 */
export function assertNoCollisions(routes: RouteEntry[], passthrough: PassthroughEntry[]): boolean {
  let seen = new Map<string, string>();
  let entries: { output: string; source: string }[] = [
    ...routes.map((r) => ({ output: r.output, source: r.source })),
    ...passthrough.map((p) => ({ output: p.output, source: p.source })),
  ];
  entries.forEach(({ output, source }) => {
    let prior = seen.get(output);
    if (prior) {
      throw new BuildError(
        "route-collision",
        [prior, source],
        `output path collision at ${output}: ${prior} and ${source}`,
      );
    }
    seen.set(output, source);
    return true;
  });
  return true;
}
