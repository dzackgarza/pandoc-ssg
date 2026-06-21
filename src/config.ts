import { readFile } from "node:fs/promises";
import { join } from "node:path";
import envPaths from "env-paths";
import { parse } from "smol-toml";
import { z } from "zod";
import { BuildError } from "./errors.ts";
import type { PageType, SiteConfig } from "./types.ts";

const dirTypeShape = z.object({ dir: z.string(), type: z.string() }).strict();
const pageTypeShape = z
  .object({
    schema: z.string().min(1),
    template: z.string().min(1),
    defaults: z.string().min(1),
  })
  .strict();
const schemaFieldShape = z
  .object({
    name: z.string().min(1),
    type: z.enum(["string", "date", "string[]"]),
    required: z.boolean(),
  })
  .strict();
const schemaShape = z.object({ fields: z.array(schemaFieldShape).min(1) }).strict();
const componentHandlerShape = z
  .object({
    handler: z.string().min(1),
    island: z.string().min(1).optional(),
  })
  .strict();
const islandShape = z.object({ entry: z.string().min(1), output: z.string().min(1) }).strict();
const generatedArtifactShape = z
  .object({
    kind: z.enum(["data", "island", "theme"]),
    source: z.string().min(1).optional(),
    output: z.string().min(1),
  })
  .strict();

const bundledRegistryShape = z
  .object({
    pageTypes: z.record(pageTypeShape),
    schemas: z.record(schemaShape),
    dirTypes: z.array(dirTypeShape),
    componentHandlers: z.record(componentHandlerShape),
    islands: z.record(islandShape),
    generatedArtifacts: z.array(generatedArtifactShape),
  })
  .strict();

const contentConfigShape = z
  .object({
    passthrough: z.array(z.object({ path: z.string() }).strict()).optional(),
    dirTypes: z.array(dirTypeShape).optional(),
    pageTypes: z.record(pageTypeShape).optional(),
    schemas: z.record(schemaShape).optional(),
    componentHandlers: z.record(componentHandlerShape).optional(),
    islands: z.record(islandShape).optional(),
    generatedArtifacts: z.array(generatedArtifactShape).optional(),
  })
  .strict();

/**
 * Load and validate the required bundled registry plus content/_site.toml.
 * The bundled registry owns built-ins; content config may explicitly extend or
 * override declarations. Malformed registry data throws BuildError(kind="config").
 */
export async function loadSiteConfig(contentDir: string, pandocDir: string): Promise<SiteConfig> {
  const bundled = await loadBundledRegistry(pandocDir);
  const configPath = join(contentDir, "_site.toml");
  if (!(await Bun.file(configPath).exists())) {
    return validateRegistry({ ...bundled, passthrough: [] }, join(pandocDir, "registry.toml"));
  }
  const raw = await readFile(configPath, "utf8");
  return mergeContentConfig(bundled, parseSiteConfig(raw));
}

async function loadBundledRegistry(pandocDir: string): Promise<Omit<SiteConfig, "passthrough">> {
  const path = join(pandocDir, "registry.toml");
  if (!(await Bun.file(path).exists())) {
    throw new BuildError("config", [path], `bundled registry not found: ${path}`);
  }
  const table = parseToml(await readFile(path, "utf8"), path, "bundled registry");
  const parsed = bundledRegistryShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", [path], parsed.error.message);
  }
  return {
    ...parsed.data,
    pageTypes: namePageTypes(parsed.data.pageTypes),
  };
}

function parseSiteConfig(raw: string): Partial<SiteConfig> {
  const table = parseToml(raw, "_site.toml", "_site.toml");
  const parsed = contentConfigShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", ["_site.toml"], parsed.error.message);
  }
  let content: Partial<SiteConfig> = {};
  if (parsed.data.passthrough !== undefined) {
    content.passthrough = parsed.data.passthrough;
  }
  if (parsed.data.dirTypes !== undefined) {
    content.dirTypes = parsed.data.dirTypes;
  }
  if (parsed.data.pageTypes !== undefined) {
    content.pageTypes = namePageTypes(parsed.data.pageTypes);
  }
  if (parsed.data.schemas !== undefined) {
    content.schemas = parsed.data.schemas;
  }
  if (parsed.data.componentHandlers !== undefined) {
    content.componentHandlers = parsed.data.componentHandlers;
  }
  if (parsed.data.islands !== undefined) {
    content.islands = parsed.data.islands;
  }
  if (parsed.data.generatedArtifacts !== undefined) {
    content.generatedArtifacts = parsed.data.generatedArtifacts;
  }
  return content;
}

function parseToml(raw: string, file: string, label: string): unknown {
  let table: unknown = {};
  try {
    table = parse(raw);
  } catch (err) {
    let detail = err instanceof Error ? err.message : String(err);
    throw new BuildError("config", [file], `malformed ${label}: ${detail}`, err);
  }
  return table;
}

function namePageTypes(pageTypes: Record<string, Omit<PageType, "name">>): Record<string, PageType> {
  return Object.fromEntries(
    Object.entries(pageTypes).map(([name, value]) => [name, { name, ...value }]),
  );
}

function mergeContentConfig(
  bundled: Omit<SiteConfig, "passthrough">,
  content: Partial<SiteConfig>,
): SiteConfig {
  const merged: SiteConfig = {
    passthrough: contentPassthrough(content),
    dirTypes: mergeDirTypes(bundled.dirTypes, contentDirTypes(content)),
    pageTypes: { ...bundled.pageTypes, ...contentPageTypes(content) },
    schemas: { ...bundled.schemas, ...content.schemas },
    componentHandlers: { ...bundled.componentHandlers, ...content.componentHandlers },
    islands: { ...bundled.islands, ...content.islands },
    generatedArtifacts: generatedArtifacts(bundled, content),
  };
  return validateRegistry(merged, "_site.toml");
}

function contentPassthrough(content: Partial<SiteConfig>): SiteConfig["passthrough"] {
  if (content.passthrough === undefined) {
    return [];
  }
  return content.passthrough;
}

function contentDirTypes(content: Partial<SiteConfig>): SiteConfig["dirTypes"] {
  if (content.dirTypes === undefined) {
    return [];
  }
  return content.dirTypes;
}

function contentPageTypes(content: Partial<SiteConfig>): SiteConfig["pageTypes"] {
  if (content.pageTypes === undefined) {
    return {};
  }
  return content.pageTypes;
}

function generatedArtifacts(
  bundled: Omit<SiteConfig, "passthrough">,
  content: Partial<SiteConfig>,
): SiteConfig["generatedArtifacts"] {
  if (content.generatedArtifacts === undefined) {
    return bundled.generatedArtifacts;
  }
  return [...bundled.generatedArtifacts, ...content.generatedArtifacts];
}

function mergeDirTypes(
  bundled: { dir: string; type: string }[],
  content: { dir: string; type: string }[],
): { dir: string; type: string }[] {
  const byDir = new Map<string, { dir: string; type: string }>();
  bundled.forEach((entry) => {
    byDir.set(entry.dir, entry);
    return true;
  });
  content.forEach((entry) => {
    byDir.set(entry.dir, entry);
    return true;
  });
  return [...byDir.values()];
}

function validateRegistry(config: SiteConfig, file: string): SiteConfig {
  if (typeof config.pageTypes.page === "undefined") {
    throw new BuildError("config", [file], 'registry must declare pageTypes.page');
  }
  Object.entries(config.pageTypes).forEach(([name, pageType]) => {
    let schema = config.schemas[pageType.schema];
    if (typeof schema === "undefined") {
      throw new BuildError(
        "config",
        [file],
        `page type ${name} references unknown schema ${pageType.schema}`,
      );
    }
    assertRenderableSchema(schema, pageType.schema, file);
    return true;
  });
  config.dirTypes.forEach(({ dir, type }) => {
    if (typeof config.pageTypes[type] === "undefined") {
      throw new BuildError(
        "config",
        [file],
        `dirTypes entry ${dir} references unknown page type ${type}`,
      );
    }
    return true;
  });
  Object.entries(config.componentHandlers).forEach(([name, handler]) => {
    if (handler.island && typeof config.islands[handler.island] === "undefined") {
      throw new BuildError(
        "config",
        [file],
        `component handler ${name} references unknown island ${handler.island}`,
      );
    }
    return true;
  });
  return config;
}

function assertRenderableSchema(
  schema: SiteConfig["schemas"][string],
  schemaId: string,
  file: string,
): boolean {
  let hasTitle = false;
  schema.fields.forEach((field) => {
    if (field.name === "site") {
      throw new BuildError("config", [file], `schema ${schemaId} cannot redefine reserved field site`);
    }
    if (field.name === "title" && field.type === "string" && field.required) {
      hasTitle = true;
    }
    return true;
  });
  if (!hasTitle) {
    throw new BuildError(
      "config",
      [file],
      `schema ${schemaId} must declare required string field title`,
    );
  }
  return true;
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

/**
 * Absolute path to the generator's XDG config file. env-paths owns the XDG Base
 * Directory spec (reading XDG_CONFIG_HOME at call time); suffix:"" keeps the dir
 * a plain "pandoc-ssg", not the default "-nodejs"-suffixed name.
 */
function appConfigPath(): string {
  return join(envPaths("pandoc-ssg", { suffix: "" }).config, "config.toml");
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
  const table = parseToml(await readFile(path, "utf8"), path, "generator config");
  const parsed = appConfigShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", [path], parsed.error.message);
  }
  return {
    pandocHome: parsed.data.pandoc_home,
    mathjaxMacroManifest: parsed.data.mathjax_macro_manifest,
  };
}
