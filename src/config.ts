import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
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

/**
 * Resolved generator-level config: where the author's pandoc tree (PANDOC_DIR /
 * tikzcd toolchain) and the MathJax macro manifest live. Read from a static XDG
 * config, never from CLI flags.
 */
export interface AppConfig {
  pandocHome: string;
  mathjaxMacroManifest: string;
}

const appConfigShape = z.object({
  pandoc_home: z.string(),
  mathjax_macro_manifest: z.string(),
});

/** Absolute path to the generator's XDG config file. */
function appConfigPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME === undefined || process.env.XDG_CONFIG_HOME === ""
      ? join(homedir(), ".config")
      : process.env.XDG_CONFIG_HOME;
  return join(base, "pandoc-ssg", "config.toml");
}

/**
 * Load the static generator config from `$XDG_CONFIG_HOME/pandoc-ssg/config.toml`
 * (default `~/.config/pandoc-ssg/config.toml`). It declares `pandoc_home` (the
 * author's pandoc tree, used for PANDOC_DIR and the tikzcd filter) and
 * `mathjax_macro_manifest` (the MathJax macro source). No flag, no fallback: a
 * missing or incomplete config fails the build loudly.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  const path = appConfigPath();
  if (!(await Bun.file(path).exists())) {
    throw new BuildError("config", [path], `generator config not found: ${path}`);
  }
  let table: unknown;
  try {
    table = parse(await readFile(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new BuildError("config", [path], `malformed generator config: ${detail}`, err);
  }
  const parsed = appConfigShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", [path], parsed.error.message);
  }
  return {
    pandocHome: parsed.data.pandoc_home,
    mathjaxMacroManifest: parsed.data.mathjax_macro_manifest,
  };
}
