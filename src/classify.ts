import type { ClassifiedFile, SiteConfig } from "./types.ts";

/**
 * Classify every scanned file into exactly one FileClass (O1):
 * - "reserved": any path whose first segment starts with "_"
 * - "opaque":   inside a config-declared passthrough subtree (wins over page)
 * - "page":     a .md file whose YAML frontmatter has `site.page: true`
 * - "asset":    everything else, including non-opt-in markdown
 */
export async function classifyFiles(
  contentDir: string,
  relPaths: string[],
  config: SiteConfig,
): Promise<ClassifiedFile[]> {
  void contentDir;
  void relPaths;
  void config;
  throw new Error("not implemented");
}
