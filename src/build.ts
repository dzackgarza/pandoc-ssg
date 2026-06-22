import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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
  Manifest,
  PageMeta,
  PageType,
  PassthroughEntry,
  RouteEntry,
  SiteConfig,
} from "./types.ts";

/** Post metadata the blog-index island consumes (emitted as blog/posts.json). */
interface PostMeta {
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

/**
 * Load content/_data/items.yaml: the data backing data-driven components
 * (e.g. feature-row card collections). Missing file → no items. The shape is
 * intentionally open (component filters own their own field contracts); this
 * only guarantees a top-level mapping of collection-name → value.
 */
async function loadItems(contentDir: string): Promise<Record<string, unknown>> {
  let itemsPath = join(contentDir, "_data", "items.yaml");
  if (!(await Bun.file(itemsPath).exists())) {
    return {};
  }
  let raw = await readFile(itemsPath, "utf8");
  let parsed = z.record(z.string(), z.unknown()).safeParse(YAML.parse(raw));
  if (!parsed.success) {
    throw new BuildError("config", ["_data/items.yaml"], parsed.error.message);
  }
  return parsed.data;
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
  routes: RouteEntry[];
}

interface RenderInputs {
  pandocDir: string;
  nav: Awaited<ReturnType<typeof loadNavigation>>;
  mathMacros: Record<string, string | [string, number]>;
  items: Record<string, unknown>;
  contentDir: string;
  pandocHome: string;
  postCtx: Map<string, Record<string, unknown>>;
}

interface IslandUsage {
  usesBlogIndex: boolean;
  collectionKeys: Set<string>;
}

/**
 * Full pipeline (O4–O7): scan → classify → validate → route → collision
 * check → nav validation → render pages via pandoc → copy assets/opaque
 * trees byte-identically → write site-manifest.json into outDir → return
 * the manifest. Any failure throws BuildError and leaves no partial outDir.
 */
export async function build(opts: BuildOptions): Promise<Manifest> {
  let { contentDir, pandocDir, outDir } = opts;
  let config = await loadSiteConfig(contentDir, pandocDir);
  let relPaths = await scanContent(contentDir);
  let classified = await classifyFiles(contentDir, relPaths, config);
  let plan = await planBuild(contentDir, classified, config);
  let generated: GeneratedEntry[] = [];
  let manifest: Manifest = {
    schemaVersion: 1,
    routes: plan.routes,
    passthrough: plan.passthrough,
    generated,
  };
  let nav = await loadNavigation(contentDir);
  let appConfig = await loadAppConfig();
  let mathMacros = await generateMathMacros(appConfig.mathjaxMacroManifest, pandocDir);
  let items = await loadItems(contentDir);
  let postCtx = buildPostContext(plan.blogPosts);
  let rendered = await renderPlannedPages(plan.pages, {
    pandocDir,
    nav,
    mathMacros,
    items,
    contentDir,
    pandocHome: appConfig.pandocHome,
    postCtx,
  });
  let islandUsage = discoverIslandUsage(rendered);

  // ---- write phase: stage into a temp dir, then atomically swap into outDir ----
  let staging = `${outDir}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await writeRenderedPages(staging, rendered);
  await copyPassthroughEntries(contentDir, staging, plan.passthrough);
  await emitThemeAssets(pandocDir, staging, generated);
  await emitBlogIndex(staging, plan.blogPosts, rendered, generated, islandUsage.usesBlogIndex);
  await emitCollectionIslands(staging, islandUsage.collectionKeys, items, generated);

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
  return { pages, passthrough, blogPosts, routes };
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

function appendBlogPost(
  blogPosts: Omit<PostMeta, "excerpt">[],
  meta: PageMeta,
  url: string,
  relPath: string,
  pageType: PageType,
): boolean {
  if (pageType.name !== "blog-post") {
    return true;
  }
  if (!meta.date) {
    throw new BuildError("schema", [relPath], "blog-post page missing required date");
  }
  blogPosts.push({
    title: meta.title,
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
      extraMeta: inputs.postCtx.get(page.route.url),
    });
    rendered.set(page.route.output, html);
  }
  return rendered;
}

function discoverIslandUsage(rendered: Map<string, string>): IslandUsage {
  let usesBlogIndex = false;
  let collectionKeys = new Set<string>();
  [...rendered.values()].forEach((html) => {
    let root = parseHtml(html);
    if (!usesBlogIndex && root.querySelector("#blog-index") !== null) {
      usesBlogIndex = true;
    }
    root.querySelectorAll("[data-collection]").forEach((mount) => {
      let src = mount.getAttribute("data-collection");
      if (src) {
        collectionKeys.add(basename(src, ".json"));
      }
      return true;
    });
    return true;
  });
  return { usesBlogIndex, collectionKeys };
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
  let themeAssetRels = await walkRel(join(pandocDir, "assets"));
  await Promise.all(themeAssetRels.map(async (rel) => {
    let src = join(pandocDir, "assets", rel);
    let output = `assets/${rel}`;
    let dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    generated.push({ output, kind: "theme" });
    return true;
  }));
  return true;
}

async function emitBlogIndex(
  staging: string,
  blogPosts: Omit<PostMeta, "excerpt">[],
  rendered: Map<string, string>,
  generated: GeneratedEntry[],
  enabled: boolean,
): Promise<boolean> {
  if (!enabled) {
    return true;
  }
  let postsOutput = "blog/posts.json";
  let postsDest = join(staging, postsOutput);
  await mkdir(dirname(postsDest), { recursive: true });
  await writeFile(postsDest, JSON.stringify(renderedPostData(blogPosts, rendered)), "utf8");
  generated.push({ output: postsOutput, kind: "data" });
  generated.push({ output: await buildIsland("blog-index", staging), kind: "island" });
  return true;
}

function renderedPostData(
  blogPosts: Omit<PostMeta, "excerpt">[],
  rendered: Map<string, string>,
): PostMeta[] {
  return [...blogPosts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((post) => {
      let html = rendered.get(outputPathForRoute(post.url));
      if (!html) {
        throw new Error(`no rendered HTML for post ${post.url}`);
      }
      return { ...post, excerpt: extractExcerpt(html) };
    });
}

async function emitCollectionIslands(
  staging: string,
  collectionKeys: Set<string>,
  items: Record<string, unknown>,
  generated: GeneratedEntry[],
): Promise<boolean> {
  if (collectionKeys.size > 0) {
    await Promise.all([...collectionKeys].map(async (key) => {
      let data = items[key];
      if (!data) {
        throw new BuildError(
          "config",
          ["_data/items.yaml"],
          `collection: unknown items key '${key}'`,
        );
      }
      let output = `_collections/${key}.json`;
      let dest = join(staging, output);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, JSON.stringify(data), "utf8");
      generated.push({ output, kind: "data" });
      return true;
    }));
    generated.push({ output: await buildIsland("collection", staging), kind: "island" });
  }
  return true;
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
