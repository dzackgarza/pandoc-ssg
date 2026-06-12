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
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return defaultConfig;
    }
    throw err;
  }

  let table: unknown;
  try {
    table = parse(raw);
  } catch (err) {
    throw new BuildError("config", ["_site.toml"], `malformed _site.toml: ${String(err)}`);
  }

  const parsed = configShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", ["_site.toml"], parsed.error.message);
  }
  return {
    passthrough: parsed.data.passthrough ?? [],
    dirTypes: parsed.data.dirTypes ?? defaultConfig.dirTypes,
  };
}
