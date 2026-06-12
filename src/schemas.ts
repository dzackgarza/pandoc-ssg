import { z } from "zod";
import { BuildError } from "./errors.ts";
import type { PageMeta, PageType } from "./types.ts";

/**
 * Page type registry (O8): name → schema id + pandoc template file.
 * "page" is the default type for pages in unmapped directories.
 */
export let pageTypes: Record<string, PageType> = {
  page: { name: "page", schema: "page.v1", template: "page.html" },
  "blog-post": { name: "blog-post", schema: "blog-post.v1", template: "blog.html" },
};

function isRootOrBounded(s: string): boolean {
  if (s === "/") {
    return true;
  }
  return s.startsWith("/") && s.endsWith("/");
}

let routeShape = z.string().refine(isRootOrBounded);

let siteShape = z
  .object({
    page: z.literal(true),
    schema: z.string().optional(),
    type: z.string().optional(),
    route: routeShape.optional(),
  })
  .strict();

let pageV1 = z
  .object({
    title: z.string(),
    site: siteShape,
  })
  .strict();

let blogPostV1 = z
  .object({
    title: z.string(),
    site: siteShape,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tags: z.array(z.string()).optional(),
  })
  .strict();

let schemaRegistry: Record<string, z.ZodType<PageMeta>> = {
  "page.v1": pageV1,
  "blog-post.v1": blogPostV1,
};

/** Schema ids known to the registry. */
export function knownSchemas(): string[] {
  return Object.keys(schemaRegistry);
}

/**
 * Validate raw frontmatter against the named schema (O3). Strict: unknown
 * schema id, missing required fields, or unknown keys throw
 * BuildError(kind="schema", files=[relPath]).
 *
 * page.v1:      requires title; site.page === true.
 * blog-post.v1: requires title and date (YYYY-MM-DD); optional tags: string[].
 * All schemas:  optional site.route ("/" or "/…/" shaped), site.type, site.schema.
 */
export function validatePageMeta(relPath: string, rawMeta: unknown, schemaId: string): PageMeta {
  let schema = schemaRegistry[schemaId];
  if (schema === undefined) {
    throw new BuildError("schema", [relPath], `unknown schema id ${schemaId}`);
  }
  let parsed = schema.safeParse(rawMeta);
  if (!parsed.success) {
    throw new BuildError("schema", [relPath], parsed.error.message);
  }
  return parsed.data;
}

/**
 * Resolve the effective page type for an opt-in page (O8): explicit
 * site.type/site.schema beat directory inference (longest matching dirTypes
 * prefix), which beats the default "page" type. Unknown type names throw
 * BuildError(kind="schema").
 */
export function resolvePageType(
  relPath: string,
  rawMeta: unknown,
  dirTypes: { dir: string; type: string }[],
): PageType {
  let explicitType = (rawMeta as { site?: { type?: unknown } }).site?.type;
  let typeName =
    typeof explicitType === "string" ? explicitType : inferTypeFromDir(relPath, dirTypes);
  let pageType = pageTypes[typeName];
  if (pageType === undefined) {
    throw new BuildError("schema", [relPath], `unknown page type ${typeName}`);
  }
  return pageType;
}

function inferTypeFromDir(relPath: string, dirTypes: { dir: string; type: string }[]): string {
  let bestDir = "";
  let bestType = "page";
  for (const { dir, type } of dirTypes) {
    let underDir = relPath === dir ? true : relPath.startsWith(`${dir}/`);
    if (underDir && dir.length >= bestDir.length) {
      bestDir = dir;
      bestType = type;
    }
  }
  return bestType;
}
