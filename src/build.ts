import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import matter from "gray-matter";
import { parse as parseHtml } from "node-html-parser";
import type { Tags } from "yaml";
import * as YAML from "yaml";
import { z } from "zod";
import { classifyFiles } from "./classify.ts";
import { loadAppConfig, loadSiteConfig } from "./config.ts";
import { BuildError } from "./errors.ts";
import { buildIsland } from "./islands.ts";
import { loadNavigation } from "./nav.ts";
import { renderPage } from "./pandoc.ts";
import { assertNoCollisions, outputPathForRoute, routeForPage } from "./routes.ts";
import { scanContent } from "./scan.ts";
import { resolvePageType, validatePageMeta } from "./schemas.ts";
import type {
  BuildOptions,
  ClassifiedFile,
  GeneratedEntry,
  Manifest,
  PageType,
  RouteEntry,
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

/**
 * A plain-text excerpt for the blog listing: the text of the first prose
 * paragraph of the *rendered* post (pandoc already parsed the markdown), with
 * the post header and inline math removed, truncated to ~50 words. Body prose
 * is a direct child of <article>; the date/chips live in <header>, so removing
 * the header leaves the first real paragraph.
 */
function extractExcerpt(renderedHtml: string): string {
  let article = parseHtml(renderedHtml).querySelector("article");
  if (article === null) {
    return "";
  }
  let header = article.querySelector("header");
  if (header !== null) {
    header.remove();
  }
  for (const math of article.querySelectorAll(".math")) {
    math.remove();
  }
  let p = article.querySelector("p");
  if (p === null) {
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

/**
 * Full pipeline (O4–O7): scan → classify → validate → route → collision
 * check → nav validation → render pages via pandoc → copy assets/opaque
 * trees byte-identically → write site-manifest.json into outDir → return
 * the manifest. Any failure throws BuildError and leaves no partial outDir.
 */
export async function build(opts: BuildOptions): Promise<Manifest> {
  let { contentDir, pandocDir, outDir } = opts;

  // ---- validation phase: everything that can fail happens before any write ----
  let config = await loadSiteConfig(contentDir);
  let relPaths = await scanContent(contentDir);
  let classified = await classifyFiles(contentDir, relPaths, config);

  let pages: PlannedPage[] = [];
  let passthrough = passthroughEntries(classified);
  // Excerpt is filled at posts.json time from the rendered HTML (pandoc owns the
  // markdown parse), so it is absent during this classification pass.
  let blogPosts: Omit<PostMeta, "excerpt">[] = [];

  for (const file of classified) {
    if (file.class !== "page") {
      continue;
    }
    let sourcePath = join(contentDir, file.relPath);
    let raw = await readFile(sourcePath, "utf8");
    let rawMeta = matter(raw, matterOptions).data;

    let pageType = resolvePageType(file.relPath, rawMeta, config.dirTypes);
    let explicit = explicitSchema(rawMeta);
    let schemaId = explicit === undefined ? pageType.schema : explicit;
    let meta = validatePageMeta(file.relPath, rawMeta, schemaId);

    let url = routeForPage(file.relPath, routeOverride(rawMeta));
    let route: RouteEntry = {
      source: file.relPath,
      url,
      output: outputPathForRoute(url),
      type: pageType.name,
      schema: schemaId,
    };
    pages.push({ relPath: file.relPath, sourcePath, route, pageType });

    if (pageType.name === "blog-post") {
      // blog-post.v1 requires date; assert existence at this boundary.
      if (meta.date === undefined) {
        throw new BuildError("schema", [file.relPath], "blog-post page missing required date");
      }
      blogPosts.push({
        title: meta.title,
        date: meta.date,
        url,
        tags: meta.tags === undefined ? [] : meta.tags,
        categories: meta.categories === undefined ? [] : meta.categories,
        dateLong: formatDate(meta.date),
      });
    }
  }

  let routes = pages.map((p) => p.route);
  assertNoCollisions(routes, passthrough);

  let generated: GeneratedEntry[] = [];
  let manifest: Manifest = { schemaVersion: 1, routes, passthrough, generated };

  let nav = await loadNavigation(contentDir);

  let appConfig = await loadAppConfig();
  let mathMacros = await generateMathMacros(appConfig.mathjaxMacroManifest, pandocDir);
  let items = await loadItems(contentDir);

  // Per-post template metadata (friendly date, prev/next neighbours, tag/category
  // chips), keyed by route url. One source feeds the post page here; PostMeta
  // feeds the listing island. Newest-first order makes prev = older, next = newer.
  let byDate = [...blogPosts].sort((a, b) => b.date.localeCompare(a.date));
  let postCtx = new Map<string, Record<string, unknown>>();
  for (const [i, post] of byDate.entries()) {
    let newer = byDate[i - 1];
    let older = byDate[i + 1];
    let terms = [
      ...post.tags.map((t) => ({
        name: t,
        kind: "tag",
        href: `/blog/?tag=${encodeURIComponent(t)}`,
      })),
      ...post.categories.map((c) => ({
        name: c,
        kind: "category",
        href: `/blog/?category=${encodeURIComponent(c)}`,
      })),
    ];
    let ctx: Record<string, unknown> = { date_long: post.dateLong, post_terms: terms };
    if (newer !== undefined) {
      ctx.next = { url: newer.url, title: newer.title };
    }
    if (older !== undefined) {
      ctx.prev = { url: older.url, title: older.title };
    }
    postCtx.set(post.url, ctx);
  }

  // Render every page (pandoc) before any write so a failure aborts cleanly.
  let rendered = new Map<string, string>();
  for (const page of pages) {
    let html = await renderPage({
      sourcePath: page.sourcePath,
      relPath: page.relPath,
      pandocDir,
      pageType: page.pageType,
      nav,
      mathMacros,
      items,
      contentRoot: contentDir,
      pandocHome: appConfig.pandocHome,
      extraMeta: postCtx.get(page.route.url),
    });
    rendered.set(page.route.output, html);
  }

  // Which island mounts the filter actually emitted — read off the rendered
  // HTML (pandoc parsed the component fences), not by re-scanning raw markdown.
  // Unknown collection keys are still validated against items.yaml below.
  let usesBlogIndex = false;
  let collectionKeys = new Set<string>();
  for (const html of rendered.values()) {
    let root = parseHtml(html);
    if (root.querySelector("#blog-index") !== null) {
      usesBlogIndex = true;
    }
    for (const mount of root.querySelectorAll("[data-collection]")) {
      let src = mount.getAttribute("data-collection");
      if (src !== undefined) {
        // "/_collections/<key>.json" → "<key>"
        collectionKeys.add(basename(src, ".json"));
      }
    }
  }

  // ---- write phase: stage into a temp dir, then atomically swap into outDir ----
  let staging = `${outDir}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  for (const [output, html] of rendered) {
    let dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html, "utf8");
  }

  for (const entry of passthrough) {
    let src = join(contentDir, entry.source);
    let dest = join(staging, entry.output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  // Theme assets (O18): the design layer's stylesheet + self-hosted fonts ship
  // with the generator, so the build emits them into dist/assets/ (pandoc/ is
  // not otherwise copied). Unconditional — every page links the stylesheet.
  for (const rel of await walkRel(join(pandocDir, "assets"))) {
    let src = join(pandocDir, "assets", rel);
    let output = `assets/${rel}`;
    let dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
    generated.push({ output, kind: "theme" });
  }

  // Interactive blog-index island (O16): only when a page uses the component.
  if (usesBlogIndex) {
    let postsOutput = "blog/posts.json";
    let postsDest = join(staging, postsOutput);
    await mkdir(dirname(postsDest), { recursive: true });
    let sorted: PostMeta[] = [...blogPosts]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((post) => {
        // Every post was rendered into `rendered` above (its output key is
        // outputPathForRoute(url) by construction); undefined would be a bug.
        let html = rendered.get(outputPathForRoute(post.url));
        if (html === undefined) {
          throw new Error(`no rendered HTML for post ${post.url}`);
        }
        return { ...post, excerpt: extractExcerpt(html) };
      });
    await writeFile(postsDest, JSON.stringify(sorted, null, 2), "utf8");
    generated.push({ output: postsOutput, kind: "data" });

    generated.push({ output: await buildIsland("blog-index", staging), kind: "island" });
  }

  // Filterable collection islands (O20): emit one JSON per referenced items key,
  // then bundle the shared collection island. Fail loud on an unknown key.
  if (collectionKeys.size > 0) {
    for (const key of collectionKeys) {
      let data = items[key];
      if (data === undefined) {
        throw new BuildError(
          "config",
          ["_data/items.yaml"],
          `collection: unknown items key '${key}'`,
        );
      }
      let output = `_collections/${key}.json`;
      let dest = join(staging, output);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, JSON.stringify(data, null, 2), "utf8");
      generated.push({ output, kind: "data" });
    }
    generated.push({ output: await buildIsland("collection", staging), kind: "island" });
  }

  await writeFile(join(staging, "site-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  await rm(outDir, { recursive: true, force: true });
  await rename(staging, outDir);

  return manifest;
}

/** POSIX paths of every file under `root`, recursively (relative to `root`). */
async function walkRel(root: string, prefix = ""): Promise<string[]> {
  let out: string[] = [];
  let entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    let rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) {
      out.push(...(await walkRel(join(root, e.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
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

function explicitSchema(rawMeta: unknown): string | undefined {
  let schema = (rawMeta as { site?: { schema?: unknown } }).site?.schema;
  return typeof schema === "string" ? schema : undefined;
}

function routeOverride(rawMeta: unknown): string | undefined {
  let route = (rawMeta as { site?: { route?: unknown } }).site?.route;
  return typeof route === "string" ? route : undefined;
}
