import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { BuildError } from "./errors.ts";
import type { SiteConfig } from "./types.ts";

const defaultConfig: SiteConfig = {
  passthrough: [],
  dirTypes: [{ dir: "blog", type: "blog-post" }],
};

const configShape = z.object({
  passthrough: z.array(z.object({ path: z.string() })).optional(),
  dirTypes: z.array(z.object({ dir: z.string(), type: z.string() })).optional(),
});

/**
 * Load and validate content/_site.toml. A missing file yields the default
 * config (no passthrough, `blog` → `blog-post` inference). Malformed config
 * throws BuildError(kind="config").
 */
export async function loadSiteConfig(contentDir: string): Promise<SiteConfig> {
  const configPath = join(contentDir, "_site.toml");
  if (!(await Bun.file(configPath).exists())) {
    return defaultConfig;
  }
  const raw = await readFile(configPath, "utf8");
  return parseSiteConfig(raw);
}

/**
 * Parse and validate the `_site.toml` body. Malformed TOML or a shape
 * mismatch throws BuildError(kind="config"). Missing optional keys fall back
 * to the documented defaults (no passthrough, `blog` → `blog-post`).
 */
function parseSiteConfig(raw: string): SiteConfig {
  let table: unknown;
  try {
    table = parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new BuildError("config", ["_site.toml"], `malformed _site.toml: ${detail}`, err);
  }

  const parsed = configShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", ["_site.toml"], parsed.error.message);
  }
  const passthrough = parsed.data.passthrough === undefined ? [] : parsed.data.passthrough;
  const dirTypes =
    parsed.data.dirTypes === undefined ? defaultConfig.dirTypes : parsed.data.dirTypes;
  return { passthrough, dirTypes };
}
