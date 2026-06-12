import type { SiteConfig } from "./types.ts";

/**
 * Load and validate content/_site.toml. A missing file yields the default
 * config (no passthrough, `blog` → `blog-post` inference). Malformed config
 * throws BuildError(kind="config").
 */
export async function loadSiteConfig(contentDir: string): Promise<SiteConfig> {
  void contentDir;
  throw new Error("not implemented");
}
