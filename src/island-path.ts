import { join } from "node:path";
import type { IslandEntry } from "./types.ts";

/**
 * Single source of truth for resolving an island's registry `entry` to an
 * absolute path.
 *
 * This is the generator↔content contract that broke once already: the registry
 * validator (config.ts) and the island bundler (islands.ts) each resolved island
 * entries independently and drifted, so a content repo whose island entries point
 * at `node_modules/pandoc-ssg/islands/…` validated against one rule but bundled
 * against another. Both call sites now route through this function, so they cannot
 * disagree by construction.
 *
 * Contract:
 * - `source: "content"` — a content repo's own island, resolved under contentDir.
 * - otherwise — project-root-relative (pandocDir/..). This covers both a content
 *   repo's `islands/…` tree and the installed generator's
 *   `node_modules/pandoc-ssg/islands/…`, since both sit at the project root next
 *   to the `pandoc/` bundle dir.
 */
export function resolveIslandEntry(
  island: Pick<IslandEntry, "entry" | "source">,
  roots: { contentDir: string; pandocDir: string },
): string {
  return island.source === "content"
    ? join(roots.contentDir, island.entry)
    : join(roots.pandocDir, "..", island.entry);
}
