import type { Manifest, NavItem } from "./types.ts";

/**
 * Load content/_data/navigation.toml ([[main]] entries). Missing file means
 * an empty nav. Malformed entries throw BuildError(kind="nav").
 */
export async function loadNavigation(contentDir: string): Promise<NavItem[]> {
  void contentDir;
  throw new Error("not implemented");
}

/**
 * O7: every non-external nav href must equal a manifest route url, else
 * BuildError(kind="nav").
 */
export function assertNavTargets(nav: NavItem[], manifest: Manifest): void {
  void nav;
  void manifest;
  throw new Error("not implemented");
}
