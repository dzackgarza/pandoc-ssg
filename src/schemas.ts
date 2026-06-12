import type { PageMeta, PageType } from "./types.ts";

/**
 * Page type registry (O8): name → schema id + pandoc template file.
 * "page" is the default type for pages in unmapped directories.
 */
export const pageTypes: Record<string, PageType> = {
  page: { name: "page", schema: "page.v1", template: "page.html" },
  "blog-post": { name: "blog-post", schema: "blog-post.v1", template: "blog.html" },
};

/** Schema ids known to the registry. */
export function knownSchemas(): string[] {
  throw new Error("not implemented");
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
export function validatePageMeta(
  relPath: string,
  rawMeta: unknown,
  schemaId: string,
): PageMeta {
  void relPath;
  void rawMeta;
  void schemaId;
  throw new Error("not implemented");
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
  void relPath;
  void rawMeta;
  void dirTypes;
  throw new Error("not implemented");
}
