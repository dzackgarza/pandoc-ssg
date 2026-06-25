import { readFile } from "node:fs/promises";
import { join } from "node:path";
import envPaths from "env-paths";
import { parse } from "smol-toml";
import { z } from "zod";
import { BuildError } from "./errors.ts";
import type {
  ComponentHandler,
  IslandEntry,
  PageType,
  RegistryFile,
  RegistrySource,
  SiteConfig,
} from "./types.ts";

const dirTypeShape = z.object({ dir: z.string(), type: z.string() }).strict();
const pageTypeShape = z
  .object({
    schema: z.string().min(1),
    template: z.string().min(1),
    defaults: z.string().min(1),
    filters: z.array(z.string().min(1)).optional(),
    feed: z.literal("blog").optional(),
    source: z.enum(["pandoc", "content"]).optional(),
    scaffold: z
      .object({
        alias: z.string().min(1).optional(),
        dir: z.string().min(1),
        filename: z.string().min(1),
        fields: z.record(z.string()).optional(),
      })
      .strict()
      .optional(),
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
    module: z.string().min(1).optional(),
    source: z.enum(["pandoc", "content"]).optional(),
    island: z.string().min(1).optional(),
  })
  .strict();
const islandShape = z
  .object({
    entry: z.string().min(1),
    output: z.string().min(1),
    source: z.enum(["pandoc", "content"]).optional(),
    dataOutput: z.string().min(1).optional(),
    dataSource: z.enum(["blog-posts", "items"]).optional(),
    mount: z.string().min(1).optional(),
  })
  .strict();
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
    filters: z.array(z.string().min(1)).optional(),
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
    filters: z.array(z.string().min(1)).optional(),
  })
  .strict();

type ContentConfigExtension = {
  passthrough: SiteConfig["passthrough"];
  dirTypes: SiteConfig["dirTypes"];
  pageTypes: SiteConfig["pageTypes"];
  schemas: SiteConfig["schemas"];
  componentHandlers: SiteConfig["componentHandlers"];
  islands: SiteConfig["islands"];
  generatedArtifacts: SiteConfig["generatedArtifacts"];
  filters: RegistryFile[];
};

type RawPageType = z.infer<typeof pageTypeShape>;
type RawComponentHandler = z.infer<typeof componentHandlerShape>;
type RawIslandEntry = z.infer<typeof islandShape>;

/**
 * Load and validate the required bundled registry plus content/_site.toml.
 * The bundled registry owns built-ins; content config may explicitly extend or
 * override declarations. Malformed registry data throws BuildError(kind="config").
 */
export async function loadSiteConfig(contentDir: string, pandocDir: string): Promise<SiteConfig> {
  const bundled = await loadBundledRegistry(pandocDir);
  const configPath = join(contentDir, "_site.toml");
  if (!(await Bun.file(configPath).exists())) {
    const config = validateRegistry({ ...bundled, passthrough: [] }, join(pandocDir, "registry.toml"));
    await validateRegistryFiles(config, contentDir, pandocDir, join(pandocDir, "registry.toml"));
    return config;
  }
  const raw = await readFile(configPath, "utf8");
  const config = mergeContentConfig(bundled, parseSiteConfig(raw));
  await validateRegistryFiles(config, contentDir, pandocDir, "_site.toml");
  return config;
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
    pageTypes: namePageTypes(parsed.data.pageTypes, "pandoc"),
    componentHandlers: nameComponentHandlers(parsed.data.componentHandlers, "pandoc"),
    islands: nameIslands(parsed.data.islands, "pandoc"),
    filters: registryFiles(parsed.data.filters ?? [], "pandoc"),
  };
}

function parseSiteConfig(raw: string): ContentConfigExtension {
  const table = parseToml(raw, "_site.toml", "_site.toml");
  const parsed = contentConfigShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("config", ["_site.toml"], parsed.error.message);
  }
  return contentConfig(parsed.data);
}

function contentConfig(data: z.infer<typeof contentConfigShape>): ContentConfigExtension {
  const content: ContentConfigExtension = {
    passthrough: [],
    dirTypes: [],
    pageTypes: {},
    schemas: {},
    componentHandlers: {},
    islands: {},
    generatedArtifacts: [],
    filters: [],
  };
  if (data.passthrough !== undefined) {
    content.passthrough = data.passthrough;
  }
  if (data.dirTypes !== undefined) {
    content.dirTypes = data.dirTypes;
  }
  if (data.pageTypes !== undefined) {
    content.pageTypes = namePageTypes(data.pageTypes, "pandoc");
  }
  if (data.schemas !== undefined) {
    content.schemas = data.schemas;
  }
  if (data.componentHandlers !== undefined) {
    content.componentHandlers = nameComponentHandlers(data.componentHandlers, "content");
  }
  if (data.islands !== undefined) {
    content.islands = nameIslands(data.islands, "content");
  }
  if (data.generatedArtifacts !== undefined) {
    content.generatedArtifacts = data.generatedArtifacts;
  }
  if (data.filters !== undefined) {
    content.filters = registryFiles(data.filters, "content");
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

function namePageTypes(
  pageTypes: Record<string, RawPageType>,
  source: RegistrySource,
): Record<string, PageType> {
  return Object.fromEntries(
    Object.entries(pageTypes).map(([name, value]) => [
      name,
      {
        ...value,
        name,
        source: value.source ?? source,
        filters: registryFiles(value.filters ?? [], value.source ?? source),
      },
    ]),
  );
}

function registryFiles(paths: string[], source: RegistrySource): RegistryFile[] {
  return paths.map((path) => ({ path, source }));
}

function nameComponentHandlers(
  handlers: Record<string, RawComponentHandler>,
  source: RegistrySource,
): Record<string, ComponentHandler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, value]) => {
      const handler: ComponentHandler = { handler: value.handler };
      if (value.island) {
        handler.island = value.island;
      }
      if (value.module) {
        handler.module = registryFile(value.module, value.source ?? source);
      }
      return [name, handler];
    }),
  );
}

function nameIslands(
  islands: Record<string, RawIslandEntry>,
  source: RegistrySource,
): Record<string, IslandEntry> {
  return Object.fromEntries(
    Object.entries(islands).map(([name, value]) => [
      name,
      {
        entry: value.entry,
        output: value.output,
        source: value.source ?? source,
        dataOutput: value.dataOutput,
        dataSource: value.dataSource,
        mount: value.mount,
      },
    ]),
  );
}

function mergeContentConfig(
  bundled: Omit<SiteConfig, "passthrough">,
  content: ContentConfigExtension,
): SiteConfig {
  const merged: SiteConfig = {
    passthrough: content.passthrough,
    dirTypes: mergeDirTypes(bundled.dirTypes, content.dirTypes),
    pageTypes: { ...bundled.pageTypes, ...content.pageTypes },
    schemas: { ...bundled.schemas, ...content.schemas },
    componentHandlers: { ...bundled.componentHandlers, ...content.componentHandlers },
    islands: { ...bundled.islands, ...content.islands },
    generatedArtifacts: generatedArtifacts(bundled, content),
    filters: [...(bundled.filters ?? []), ...content.filters],
  };
  return validateRegistry(merged, "_site.toml");
}

function generatedArtifacts(
  bundled: Omit<SiteConfig, "passthrough">,
  content: ContentConfigExtension,
): SiteConfig["generatedArtifacts"] {
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

async function validateRegistryFiles(
  config: SiteConfig,
  contentDir: string,
  pandocDir: string,
  file: string,
): Promise<boolean> {
  let files: RegistryFile[] = [];
  Object.values(config.pageTypes).forEach((pageType) => {
    files.push(registryFile(pageType.defaults, pageType.source));
    files.push(registryFile(pageType.template, pageType.source));
    files.push(...(pageType.filters ?? []));
    return true;
  });
  Object.values(config.componentHandlers).forEach((handler) => {
    if (handler.module) {
      files.push(handler.module);
    }
    return true;
  });
  Object.values(config.islands).forEach((island) => {
    files.push(registryFile(island.entry, island.source));
    return true;
  });
  files.push(...(config.filters ?? []));
  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    let entry = files[fileIndex];
    if (!entry) {
      throw new Error(`registry file missing at index ${fileIndex}`);
    }
    let resolved = registryPath(entry, contentDir, pandocDir);
    if (!(await Bun.file(resolved).exists())) {
      throw new BuildError("config", [file], `registry path not found: ${entry.path}`);
    }
  }
  return true;
}

function registryFile(path: string, source: RegistrySource | undefined): RegistryFile {
  return { path, source };
}

function registryPath(file: RegistryFile, contentDir: string, pandocDir: string): string {
  let base = file.source === "content" ? contentDir : pandocDir;
  if (file.source !== "content" && file.path.startsWith("islands/")) {
    return join(pandocDir, "..", file.path);
  }
  if (file.source !== "content" && file.path.endsWith(".html") && !file.path.includes("/")) {
    return join(base, "templates", file.path);
  }
  return join(base, file.path);
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
