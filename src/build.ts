import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import * as YAML from "yaml";
import type { Tags } from "yaml";
import { z } from "zod";
import { classifyFiles } from "./classify.ts";
import { loadSiteConfig } from "./config.ts";
import { BuildError } from "./errors.ts";
import { assertNavTargets, loadNavigation } from "./nav.ts";
import { renderPage } from "./pandoc.ts";
import { assertNoCollisions, outputPathForRoute, routeForPage } from "./routes.ts";
import { scanContent } from "./scan.ts";
import { resolvePageType, validatePageMeta } from "./schemas.ts";
import type {
  BuildOptions,
  ClassifiedFile,
  Manifest,
  PageType,
  RouteEntry,
} from "./types.ts";

/**
 * gray-matter engine that parses YAML with the core schema but keeps
 * timestamps as plain strings (so `date: 2026-06-12` stays a string for the
 * schema regex) while preserving booleans and numbers.
 */
const matterOptions = {
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

const macrosShape = z.object({
  macros: z.record(z.string(), z.string()).optional(),
});

/** Load content/_data/math-macros.yaml. Missing file → no macros. */
async function loadMathMacros(contentDir: string): Promise<Record<string, string>> {
  const macrosPath = join(contentDir, "_data", "math-macros.yaml");
  let raw: string;
  try {
    raw = await readFile(macrosPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
  const parsed = macrosShape.safeParse(YAML.parse(raw));
  if (!parsed.success) {
    throw new BuildError("config", ["_data/math-macros.yaml"], parsed.error.message);
  }
  return parsed.data.macros ?? {};
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
  const { contentDir, pandocDir, outDir } = opts;

  // ---- validation phase: everything that can fail happens before any write ----
  const config = await loadSiteConfig(contentDir);
  const relPaths = await scanContent(contentDir);
  const classified = await classifyFiles(contentDir, relPaths, config);

  const pages: PlannedPage[] = [];
  const passthrough = passthroughEntries(classified);

  for (const file of classified) {
    if (file.class !== "page") {
      continue;
    }
    const sourcePath = join(contentDir, file.relPath);
    const raw = await readFile(sourcePath, "utf8");
    const rawMeta = matter(raw, matterOptions).data;

    const pageType = resolvePageType(file.relPath, rawMeta, config.dirTypes);
    const schemaId = explicitSchema(rawMeta) ?? pageType.schema;
    validatePageMeta(file.relPath, rawMeta, schemaId);

    const url = routeForPage(file.relPath, routeOverride(rawMeta));
    const route: RouteEntry = {
      source: file.relPath,
      url,
      output: outputPathForRoute(url),
      type: pageType.name,
      schema: schemaId,
    };
    pages.push({ relPath: file.relPath, sourcePath, route, pageType });
  }

  const routes = pages.map((p) => p.route);
  assertNoCollisions(routes, passthrough);

  const manifest: Manifest = { schemaVersion: 1, routes, passthrough };

  const nav = await loadNavigation(contentDir);
  assertNavTargets(nav, manifest);

  const mathMacros = await loadMathMacros(contentDir);

  // Render every page (pandoc) before any write so a failure aborts cleanly.
  const rendered = new Map<string, string>();
  for (const page of pages) {
    const html = await renderPage({
      sourcePath: page.sourcePath,
      relPath: page.relPath,
      pandocDir,
      pageType: page.pageType,
      nav,
      mathMacros,
    });
    rendered.set(page.route.output, html);
  }

  // ---- write phase: stage into a temp dir, then atomically swap into outDir ----
  const staging = `${outDir}.staging-${process.pid}-${Date.now()}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  for (const [output, html] of rendered) {
    const dest = join(staging, output);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, html, "utf8");
  }

  for (const entry of passthrough) {
    const src = join(contentDir, entry.source);
    const dest = join(staging, entry.output);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }

  await writeFile(join(staging, "site-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  await rm(outDir, { recursive: true, force: true });
  await rename(staging, outDir);

  return manifest;
}

/** Passthrough copies: every "asset" and "opaque" file (reserved never copied). */
function passthroughEntries(classified: ClassifiedFile[]) {
  return classified
    .filter((f) => f.class === "asset" || f.class === "opaque")
    .map((f) => ({ source: f.relPath, output: f.relPath }));
}

function explicitSchema(rawMeta: unknown): string | undefined {
  const schema = (rawMeta as { site?: { schema?: unknown } }).site?.schema;
  return typeof schema === "string" ? schema : undefined;
}

function routeOverride(rawMeta: unknown): string | undefined {
  const route = (rawMeta as { site?: { route?: unknown } }).site?.route;
  return typeof route === "string" ? route : undefined;
}
