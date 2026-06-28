import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import { parse as parseHtml } from "node-html-parser";
import type { Tags } from "yaml";
import * as YAML from "yaml";
import { z } from "zod";
import { classifyFiles } from "./content/classify.ts";
import { loadAppConfig, loadSiteConfig } from "./config.ts";
import { BuildError } from "./errors.ts";
import { buildIsland } from "./islands.ts";
import { loadNavigation } from "./site/nav.ts";
import { renderPage } from "./pandoc.ts";
import { assertNoCollisions, outputPathForRoute, routeForPage } from "./site/routes.ts";
import { scanContent } from "./site/scan.ts";
import { resolvePageType, validatePageMeta } from "./content/schemas.ts";
import type {
  BuildOptions,
  ClassifiedFile,
  GeneratedEntry,
  IslandEntry,
  Manifest,
  ManifestDependency,
  PageMeta,
  PageType,
  PassthroughEntry,
  RegistryFile,
  RouteEntry,
  SiteConfig,
} from "./types.ts";

/** Post metadata the blog-index island consumes (emitted as blog/posts.json). */
interface PostMeta {
  /** content-relative source file; manifest dependency metadata only */
  source: string;
  title: string;
  date: string;
  url: string;
  tags: string[];
  categories: string[];
  /** plain-text teaser (first prose paragraph) for the blog listing */
  excerpt: string;
  /** friendly date, e.g. "November 28, 2020" */
  dateLong: string;
}

type PublicPostMeta = Omit<PostMeta, "source">;

let dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Format a schema-validated ISO `YYYY-MM-DD` date as "Month D, YYYY". The
 * frontmatter schema already guarantees the YYYY-MM-DD shape, so an invalid
 * value here throws (RangeError) rather than degrading silently.
 */
function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

function optionalStringList(value: string[] | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  return value;
}

/**
 * A plain-text excerpt for the blog listing: the text of the first prose
 * paragraph of the *rendered* post (pandoc already parsed the markdown), with
 * the post header and inline math removed, truncated to ~50 words. Body prose
 * is a direct child of <article>; the date/chips live in <header>, so removing
 * the header leaves the first real paragraph.
 */
function extractExcerpt(renderedHtml: string): string {
  let article = parseHtml(renderedHtml).querySelector("article");
  if (!article) {
    return "";
  }
  let header = article.querySelector("header");
  if (header) {
    header.remove();
  }
  article.querySelectorAll(".math").forEach((math) => {
    math.remove();
    return true;
  });
  let p = article.querySelector("p");
  if (!p) {
    return "";
  }
  let words = p.text.replace(/\s+/g, " ").trim().split(" ");
  return words.length > 50 ? `${words.slice(0, 50).join(" ")}…` : words.join(" ");
}

/**
 * gray-matter engine that parses YAML with the core schema but keeps
 * timestamps as plain strings (so `date: 2026-06-12` stays a string for the
 * schema regex) while preserving booleans and numbers.
 */
let matterOptions = {
  engines: {
    yaml: (raw: string): object =>
      YAML.parse(raw, {
        schema: "core",
        customTags: (tags: Tags): Tags =>
          tags.filter(
            (t) =>
              t !== "timestamp" &&
              !(typeof t === "object" && t.tag === "tag:yaml.org,2002:timestamp"),
          ),
      }) as object,
  },
};

// MathJax 3 tex.macros map: a zero-arg macro is a string body; an N-arg macro
// is [body, argCount]. This is exactly the extractor's stdout shape.
let macroMapShape = z.record(
  z.string(),
  z.union([z.string(), z.tuple([z.string(), z.number()])]),
);

type DataSourceMap = Record<string, Record<string, unknown>>;

interface LoadedDataSources {
  values: DataSourceMap;
  dependencies: Record<string, ManifestDependency[]>;
}

/**
 * Load registry-declared data sources from content/_data/<source>.yaml and
 * content/_data/<source>/*.yaml. The generator owns only this plumbing;
 * filters and templates own the meaning and shape of the resulting values.
 */
async function loadDataSources(
  contentDir: string,
  sourceNames: Iterable<string>,
): Promise<LoadedDataSources> {
  let values: DataSourceMap = {};
  let dependencies: Record<string, ManifestDependency[]> = {};
  await Promise.all([...sourceNames].sort().map(async (sourceName) => {
    let loaded = await loadDataSource(contentDir, sourceName);
    values[sourceName] = loaded.value;
    dependencies[sourceName] = loaded.dependencies;
  }));
  return { values, dependencies };
}

async function loadDataSource(
  contentDir: string,
  sourceName: string,
): Promise<{ value: Record<string, unknown>; dependencies: ManifestDependency[] }> {
  let value: Record<string, unknown> = {};
  let dependencies: ManifestDependency[] = [];
  let sourceFile = join(contentDir, "_data", `${sourceName}.yaml`);
  if (await Bun.file(sourceFile).exists()) {
    mergeDataMapping(value, await readDataMapping(sourceFile, [`_data/${sourceName}.yaml`]));
    dependencies.push(dependency("content-data", `_data/${sourceName}.yaml`, "content"));
  }

  let sourceDir = join(contentDir, "_data", sourceName);
  if (await Bun.file(sourceDir).exists()) {
    let rels = (await walkRel(sourceDir)).filter((rel) => rel.endsWith(".yaml")).sort();
    await Promise.all(rels.map(async (rel) => {
      let path = join(sourceDir, rel);
      let sourceRel = `_data/${sourceName}/${rel}`;
      mergeDataMapping(value, await readDataMapping(path, [sourceRel]));
      dependencies.push(dependency("content-data", sourceRel, "content"));
    }));
  }

  return { value, dependencies: sortedDependencies(dependencies) };
}

async function readDataMapping(path: string, rels: string[]): Promise<Record<string, unknown>> {
  let raw = await readFile(path, "utf8");
  let parsed = z.record(z.string(), z.unknown()).safeParse(YAML.parse(raw));
  if (!parsed.success) {
    throw new BuildError("config", rels, parsed.error.message);
  }
  return parsed.data;
}

function mergeDataMapping(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (let [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) {
      throw new BuildError("config", ["_data"], `duplicate data key '${key}'`);
    }
    target[key] = value;
  }
}

/**
 * Extract MathJax macros live by running the bundled extractor over the macro
 * manifest. The macros are generated every build from the canonical LaTeX
 * source — never read from a stored copy. Fails loudly (BuildError) if uv, the
 * script, the manifest, or any listed macro file is missing, or if the output
 * is not a valid MathJax macro map. There is no silent empty fallback.
 */
async function generateMathMacros(
  manifestPath: string,
  pandocDir: string,
): Promise<Record<string, string | [string, number]>> {
  let script = join(pandocDir, "bin", "extract_mathjax_macros.py");
  let proc = Bun.spawn(["uv", "run", script, manifestPath], { stdout: "pipe", stderr: "pipe" });
  let [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new BuildError("config", [manifestPath], `macro extraction failed: ${stderr.trim()}`);
  }
  let parsed = macroMapShape.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new BuildError("config", [manifestPath], parsed.error.message);
  }
  return parsed.data;
}

interface PlannedPage {
  relPath: string;
  sourcePath: string;
  route: RouteEntry;
  pageType: PageType;
}

interface BuildPlan {
  pages: PlannedPage[];
  passthrough: PassthroughEntry[];
  blogPosts: Omit<PostMeta, "excerpt">[];
}

interface RenderInputs {
  pandocDir: string;
  nav: Awaited<ReturnType<typeof loadNavigation>>;
  mathMacros: Record<string, string | [string, number]>;
  items: Record<string, unknown>;
  contentDir: string;
  pandocHome: string;
  postCtx: Map<string, Record<string, unknown>>;
  siteFilters: SiteConfig["filters"];
  componentHandlers: SiteConfig["componentHandlers"];
  islands: SiteConfig["islands"];
}

type IslandUsage = Map<string, Set<string>>;

interface ManifestDependencyContext {
  contentDir: string;
  pandocDir: string;
  siteConfigDependencies: ManifestDependency[];
  navDependency?: ManifestDependency;
  dataDependencies: Record<string, ManifestDependency[]>;
  macroManifestDependency: ManifestDependency;
  siteFilters: SiteConfig["filters"];
}

/**
 * Full pipeline (O4-O7): scan, classify, validate, route, collision check,
 * nav validation, render pages via pandoc, copy assets/opaque trees
 * byte-identically, write site-manifest.json into outDir, then return the
 * manifest. Any failure throws BuildError and leaves no partial outDir.
 */
export async function build(opts: BuildOptions): Promise<Manifest> {
  let { contentDir, pandocDir, outDir } = opts;
  let config = await loadSiteConfig(contentDir, pandocDir);
  let relPaths = await scanContent(contentDir);
  let classified = await classifyFiles(contentDir, relPaths, config);
  let plan = await planBuild(contentDir, classified, config);
  let generated: GeneratedEntry[] = [];
  let nav = await loadNavigation(contentDir);
  let appConfig = await loadAppConfig();
  let dataSources = await loadDataSources(contentDir, requiredDataSources(config));
  let dependencyContext = await manifestDependencyContext(contentDir, pandocDir, appConfig.mathjaxMacroManifest, config, dataSources);
  let manifest: Manifest = {
    schemaVersion: 2,
    routes: plan.pages.map((page) => routeWithDependencies(page, dependencyContext)),
    passthrough: plan.passthrough.map((entry) => passthroughWithDependencies(entry)),
    generated,
  };
  let mathMacros = await generateMathMacros(appConfig.mathjaxMacroManifest, pandocDir);
  let postCtx = buildPostContext(plan.blogPosts);
  let itemsData = dataSources.values.items;
  let rendered = await renderPlannedPages(plan.pages, {
    pandocDir,
    nav,
    mathMacros,
    items: itemsData === undefined ? {} : itemsData,
    contentDir,
    pandocHome: appConfig.pandocHome,
    postCtx,
    siteFilters: config.filters,
    componentHandlers: config.componentHandlers,
    islands: config.islands,
  });
  let islandUsage = discoverIslandUsage(rendered);

  // ---- write phase: stage into a temp dir, then atomically swap into outDir ----
  let staging = `${outDir}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await writeRenderedPages(staging, rendered);
  await copyPassthroughEntries(contentDir, staging, plan.passthrough);
  await emitThemeAssets(pandocDir, staging, generated);
  await emitIslandArtifacts(staging, islandUsage, config.islands, { contentDir, pandocDir }, {
    blogPosts: plan.blogPosts,
    rendered,
    dataSources: dataSources.values,
    generated,
    dependencies: dependencyContext,
  });

  generated.sort((a, b) => generatedEntryKey(a).localeCompare(generatedEntryKey(b)));
  await writeFile(join(staging, "site-manifest.json"), JSON.stringify(manifest), "utf8");
  await rm(outDir, { recursive: true, force: true });
  await rename(staging, outDir);

  return manifest;
}

async function planBuild(
  contentDir: string,
  classified: ClassifiedFile[],
  config: SiteConfig,
): Promise<BuildPlan> {
  let pages: PlannedPage[] = [];
  let blogPosts: Omit<PostMeta, "excerpt">[] = [];
  for (let fileIndex = 0; fileIndex < classified.length; fileIndex += 1) {
    let file = requiredIndex(classified, fileIndex, "classified file");
    if (file.class === "page") {
      let planned = await planPage(contentDir, file, config);
      pages.push(planned.page);
      appendBlogPost(blogPosts, planned.meta, planned.page.route.url, file.relPath, planned.page.pageType);
    }
  }
  let passthrough = passthroughEntries(classified);
  let routes = pages.map((p) => p.route);
  assertNoCollisions(routes, passthrough);
  return { pages, passthrough, blogPosts };
}

async function planPage(contentDir: string, file: ClassifiedFile, config: SiteConfig) {
  let sourcePath = join(contentDir, file.relPath);
  let raw = await readFile(sourcePath, "utf8");
  let rawMeta = matter(raw, matterOptions).data;
  let pageType = resolvePageType(file.relPath, rawMeta, config);
  let explicit = explicitSchema(rawMeta);
  let schemaId = explicit ? explicit : pageType.schema;
  let meta = validatePageMeta(file.relPath, rawMeta, schemaId, config.schemas);
  let url = routeForPage(file.relPath, routeOverride(rawMeta));
  let route: RouteEntry = {
    source: file.relPath,
    url,
    output: outputPathForRoute(url),
    type: pageType.name,
    schema: schemaId,
  };
  return { page: { relPath: file.relPath, sourcePath, route, pageType }, meta };
}

async function manifestDependencyContext(
  contentDir: string,
  pandocDir: string,
  macroManifestPath: string,
  config: SiteConfig,
  dataSources: LoadedDataSources,
): Promise<ManifestDependencyContext> {
  let siteConfigDependencies = [
    dependency("site-config", "registry.toml", "pandoc"),
    ...((await Bun.file(join(contentDir, "_site.toml")).exists())
      ? [dependency("site-config", "_site.toml", "content")]
      : []),
  ];
  let navDependency = (await Bun.file(join(contentDir, "_data", "navigation.toml")).exists())
    ? dependency("navigation", "_data/navigation.toml", "content")
    : undefined;
  return {
    contentDir,
    pandocDir,
    siteConfigDependencies: sortedDependencies(siteConfigDependencies),
    navDependency,
    dataDependencies: dataSources.dependencies,
    macroManifestDependency: dependency("macro-manifest", macroManifestPath, "absolute"),
    siteFilters: config.filters,
  };
}

function requiredDataSources(config: SiteConfig): Set<string> {
  let names = new Set<string>(["items"]);
  Object.values(config.islands).forEach((island) => {
    if (island.dataSource && island.dataSource !== "blog-posts") {
      names.add(island.dataSource);
    }
  });
  return names;
}

function routeWithDependencies(page: PlannedPage, context: ManifestDependencyContext): RouteEntry {
  return {
    ...page.route,
    dependencies: sortedDependencies([
      dependency("source-page", page.relPath, "content"),
      registryDependency("template", { path: page.pageType.template, source: page.pageType.source }),
      registryDependency("defaults", { path: page.pageType.defaults, source: page.pageType.source }),
      ...registryDependencies(
        "filter",
        context.siteFilters === undefined || context.siteFilters === null ? [] : context.siteFilters,
      ),
      ...registryDependencies(
        "filter",
        page.pageType.filters === undefined || page.pageType.filters === null ? [] : page.pageType.filters,
      ),
      ...context.siteConfigDependencies,
      ...(context.navDependency ? [context.navDependency] : []),
      ...(context.dataDependencies.items === undefined ? [] : context.dataDependencies.items),
      context.macroManifestDependency,
    ]),
  };
}

function passthroughWithDependencies(entry: PassthroughEntry): PassthroughEntry {
  return {
    ...entry,
    dependencies: sortedDependencies([dependency("passthrough-source", entry.source, "content")]),
  };
}

function appendBlogPost(
  blogPosts: Omit<PostMeta, "excerpt">[],
  meta: PageMeta,
  url: string,
  relPath: string,
  pageType: PageType,
): boolean {
  if (pageType.feed !== "blog") {
    return true;
  }
  if (!meta.date) {
    throw new BuildError("schema", [relPath], "blog-post page missing required date");
  }
  blogPosts.push({
    title: meta.title,
    source: relPath,
    date: meta.date,
    url,
    tags: optionalStringList(meta.tags),
    categories: optionalStringList(meta.categories),
    dateLong: formatDate(meta.date),
  });
  return true;
}

function buildPostContext(blogPosts: Omit<PostMeta, "excerpt">[]): Map<string, Record<string, unknown>> {
  let byDate = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
  let postCtx = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < byDate.length; i += 1) {
    let post = requiredIndex(byDate, i, "blog post");
    let terms = postTerms(post);
    let ctx: Record<string, unknown> = { date_long: post.dateLong, post_terms: terms };
    let newer = byDate[i - 1];
    let older = byDate[i + 1];
    if (newer) {
      ctx.next = { url: newer.url, title: newer.title };
    }
    if (older) {
      ctx.prev = { url: older.url, title: older.title };
    }
    postCtx.set(post.url, ctx);
  }
  return postCtx;
}

function postTerms(post: Omit<PostMeta, "excerpt">): Record<string, string>[] {
  return [
    ...post.tags.map((name) => ({ name, kind: "tag", href: `/blog/?tag=${encodeURIComponent(name)}` })),
    ...post.categories.map((name) => ({
      name,
      kind: "category",
      href: `/blog/?category=${encodeURIComponent(name)}`,
    })),
  ];
}

async function renderPlannedPages(
  pages: PlannedPage[],
  inputs: RenderInputs,
): Promise<Map<string, string>> {
  let rendered = new Map<string, string>();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    let page = requiredIndex(pages, pageIndex, "planned page");
    let html = await renderPage({
      sourcePath: page.sourcePath,
      relPath: page.relPath,
      pandocDir: inputs.pandocDir,
      pageType: page.pageType,
      nav: inputs.nav,
      mathMacros: inputs.mathMacros,
      items: inputs.items,
      contentRoot: inputs.contentDir,
      pandocHome: inputs.pandocHome,
      siteFilters: inputs.siteFilters,
      componentHandlers: inputs.componentHandlers,
      islands: inputs.islands,
      extraMeta: inputs.postCtx.get(page.route.url),
    });
    rendered.set(page.route.output, html);
  }
  return rendered;
}

function discoverIslandUsage(rendered: Map<string, string>): IslandUsage {
  let usage: IslandUsage = new Map();
  [...rendered.values()].forEach((html) => {
    let root = parseHtml(html);
    // Island discovery is purely registry/attribute-driven: every island mount
    // (built-in or content-owned) carries `data-ssg-island` naming its registry
    // entry and an optional `data-ssg-data-key`. No component name is special-
    // cased here, so a site can register and unify its own listing islands
    // without editing the kernel (decouples blog-index/collection identity from
    // the discovery pass — see dzackgarza/pandoc-ssg#2, #3).
    root.querySelectorAll("[data-ssg-island]").forEach((mount) => {
      let island = mount.getAttribute("data-ssg-island");
      if (island) {
        let dataKey = mount.getAttribute("data-ssg-data-key");
        addIslandUsage(usage, island, dataKey === null || dataKey === undefined ? "" : dataKey);
      }
      return true;
    });
    return true;
  });
  return usage;
}

function addIslandUsage(usage: IslandUsage, island: string, dataKey: string): boolean {
  let keys = usage.get(island);
  if (!keys) {
    keys = new Set<string>();
    usage.set(island, keys);
  }
  keys.add(dataKey);
  return true;
}

async function writeRenderedPages(staging: string, rendered: Map<string, string>): Promise<boolean> {
  await Promise.all([...rendered.entries()].map(async ([output, html]) => {
    let dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html, "utf8");
    return true;
  }));
  return true;
}

async function copyPassthroughEntries(
  contentDir: string,
  staging: string,
  passthrough: PassthroughEntry[],
): Promise<boolean> {
  await Promise.all(passthrough.map(async (entry) => {
    let src = join(contentDir, entry.source);
    let dest = join(staging, entry.output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    return true;
  }));
  return true;
}

async function emitThemeAssets(
  pandocDir: string,
  staging: string,
  generated: GeneratedEntry[],
): Promise<boolean> {
  let themeAssetRels = (await walkRel(join(pandocDir, "assets"))).sort();
  await Promise.all(themeAssetRels.map(async (rel) => {
    let src = join(pandocDir, "assets", rel);
    let output = `assets/${rel}`;
    let dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    generated.push({
      output,
      kind: "theme",
      dependencies: sortedDependencies([dependency("theme-asset", output, "pandoc")]),
    });
    return true;
  }));
  return true;
}

async function emitIslandArtifacts(
  staging: string,
  usage: IslandUsage,
  islands: Record<string, IslandEntry>,
  roots: { contentDir: string; pandocDir: string },
  data: {
    blogPosts: Omit<PostMeta, "excerpt">[];
    rendered: Map<string, string>;
    dataSources: DataSourceMap;
    generated: GeneratedEntry[];
    dependencies: ManifestDependencyContext;
  },
): Promise<boolean> {
  for (const name of [...usage.keys()].sort()) {
    let island = islands[name];
    if (!island) {
      throw new BuildError("config", ["registry.toml"], `used island ${name} is not registered`);
    }
    await emitIslandData(staging, name, island, requiredUsage(usage, name), data);
    data.generated.push({
      output: await buildIsland(island, staging, roots),
      kind: "island",
      dependencies: sortedDependencies([
        ...data.dependencies.siteConfigDependencies,
        registryDependency("island-entry", { path: island.entry, source: island.source }),
      ]),
    });
  }
  return true;
}

async function emitIslandData(
  staging: string,
  name: string,
  island: IslandEntry,
  dataKeys: Set<string>,
  data: {
    blogPosts: Omit<PostMeta, "excerpt">[];
    rendered: Map<string, string>;
    dataSources: DataSourceMap;
    generated: GeneratedEntry[];
    dependencies: ManifestDependencyContext;
  },
): Promise<boolean> {
  if (!island.dataOutput) {
    return true;
  }
  if (island.dataSource === "blog-posts") {
    await writeGeneratedJson(
      staging,
      islandOutput(island.dataOutput, ""),
      renderedPostData(data.blogPosts, data.rendered),
      data.generated,
      [
        ...data.dependencies.siteConfigDependencies,
        data.dependencies.macroManifestDependency,
        ...data.blogPosts.map((post) => dependency("source-page", post.source, "content")),
      ],
    );
    return true;
  }
  if (island.dataSource) {
    let keys = [...dataKeys].filter((key) => key !== "").sort();
    if (keys.length === 0) {
      throw new BuildError("config", ["registry.toml"], `island ${name} needs a data key`);
    }
    let sourceData = data.dataSources[island.dataSource];
    let sourceDependencies = data.dependencies.dataDependencies[island.dataSource];
    sourceData = sourceData === undefined ? {} : sourceData;
    sourceDependencies = sourceDependencies === undefined ? [] : sourceDependencies;
    await Promise.all(keys.map(async (key) => {
      let itemData = sourceData[key];
      if (typeof itemData === "undefined") {
        throw new BuildError("config", ["_data"], `${name}: unknown ${island.dataSource} data key '${key}'`);
      }
      await writeGeneratedJson(staging, islandOutput(island.dataOutput!, key), itemData, data.generated, [
        ...data.dependencies.siteConfigDependencies,
        ...sourceDependencies,
      ]);
      return true;
    }));
    return true;
  }
  throw new BuildError("config", ["registry.toml"], `island ${name} declares dataOutput without dataSource`);
}

function renderedPostData(
  blogPosts: Omit<PostMeta, "excerpt">[],
  rendered: Map<string, string>,
): PublicPostMeta[] {
  return [...blogPosts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((post) => {
      let html = rendered.get(outputPathForRoute(post.url));
      if (!html) {
        throw new Error(`no rendered HTML for post ${post.url}`);
      }
      // Construct the public shape explicitly — `source` is internal manifest
      // metadata and must not leak into the client-facing posts.json.
      return {
        title: post.title,
        date: post.date,
        url: post.url,
        tags: post.tags,
        categories: post.categories,
        dateLong: post.dateLong,
        excerpt: extractExcerpt(html),
      };
    });
}

async function writeGeneratedJson(
  staging: string,
  output: string,
  data: unknown,
  generated: GeneratedEntry[],
  dependencies: ManifestDependency[],
): Promise<boolean> {
  let dest = join(staging, output);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(data), "utf8");
  generated.push({ output, kind: "data", dependencies: sortedDependencies(dependencies) });
  return true;
}

function islandOutput(template: string, key: string): string {
  return template.replaceAll("{key}", key);
}

function requiredUsage(usage: IslandUsage, name: string): Set<string> {
  let dataKeys = usage.get(name);
  if (!dataKeys) {
    throw new Error(`island usage missing for ${name}`);
  }
  return dataKeys;
}

function dependency(
  kind: ManifestDependency["kind"],
  path: string,
  origin: ManifestDependency["origin"],
  key?: string,
): ManifestDependency {
  let dep: ManifestDependency = { kind, path, origin };
  if (key !== undefined) {
    dep.key = key;
  }
  return dep;
}

function registryDependency(kind: ManifestDependency["kind"], file: RegistryFile): ManifestDependency {
  if (file.source === undefined) {
    throw new Error(`registry dependency missing source for ${kind}: ${file.path}`);
  }
  return dependency(kind, file.path, file.source);
}

function registryDependencies(
  kind: ManifestDependency["kind"],
  files: RegistryFile[],
): ManifestDependency[] {
  return files.map((file) => registryDependency(kind, file));
}

function sortedDependencies(dependencies: ManifestDependency[]): ManifestDependency[] {
  let byKey = new Map<string, ManifestDependency>();
  dependencies.forEach((dep) => {
    byKey.set(dependencyKey(dep), dep);
    return true;
  });
  return [...byKey.values()].sort((a, b) => dependencyKey(a).localeCompare(dependencyKey(b)));
}

function dependencyKey(dep: ManifestDependency): string {
  return [dep.kind, dep.origin, dep.path, dep.key === undefined || dep.key === null ? "" : dep.key].join("\u0000");
}

function generatedEntryKey(entry: GeneratedEntry): string {
  return [entry.kind, entry.output].join("\u0000");
}

function requiredIndex<T>(items: T[], index: number, label: string): T {
  let item = items[index];
  if (!item) {
    throw new Error(`${label} missing at index ${index}`);
  }
  return item;
}

/** POSIX paths of every file under `root`, recursively (relative to `root`). */
async function walkRel(root: string): Promise<string[]> {
  let glob = new Bun.Glob("**/*");
  return await Array.fromAsync(glob.scan({ cwd: root, dot: true, onlyFiles: true }));
}

/** True for the file classes copied verbatim into dist ("asset" or "opaque"). */
function isPassthroughClass(fileClass: ClassifiedFile["class"]): boolean {
  if (fileClass === "asset") {
    return true;
  }
  return fileClass === "opaque";
}

/** Passthrough copies: every "asset" and "opaque" file (reserved never copied). */
function passthroughEntries(classified: ClassifiedFile[]) {
  return classified
    .filter((f) => isPassthroughClass(f.class))
    .map((f) => ({ source: f.relPath, output: f.relPath }));
}

function explicitSchema(rawMeta: unknown): string | false {
  let schema = (rawMeta as { site?: { schema?: unknown } }).site?.schema;
  return typeof schema === "string" ? schema : false;
}

function routeOverride(rawMeta: unknown): string | false {
  let route = (rawMeta as { site?: { route?: unknown } }).site?.route;
  return typeof route === "string" ? route : false;
}
