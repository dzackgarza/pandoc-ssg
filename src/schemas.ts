import { z } from "zod";
import { BuildError } from "./errors.ts";
import type { PageMeta, PageType, SchemaDefinition, SchemaFieldType, SiteConfig } from "./types.ts";

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

/** Schema ids known to the registry. */
export function knownSchemas(schemas: Record<string, SchemaDefinition>): string[] {
  return Object.keys(schemas);
}

/**
 * Validate raw frontmatter against the named schema (O3). Strict: unknown
 * schema id, missing required fields, or unknown keys throw
 * BuildError(kind="schema", files=[relPath]).
 *
 * page.v1:      requires title; site.page === true.
 * blog-post.v1: requires title and date (YYYY-MM-DD); optional tags and
 *               categories (string[] each), the blog-index island's facets.
 * All schemas:  optional site.route ("/" or "/…/" shaped), site.type, site.schema.
 */
export function validatePageMeta(
  relPath: string,
  rawMeta: unknown,
  schemaId: string,
  schemas: Record<string, SchemaDefinition>,
): PageMeta {
  let schemaDefinition = schemas[schemaId];
  if (!schemaDefinition) {
    throw new BuildError("schema", [relPath], `unknown schema id ${schemaId}`);
  }
  let parsed = z.object(schemaFields(schemaDefinition)).strict().safeParse(rawMeta);
  if (!parsed.success) {
    throw new BuildError("schema", [relPath], parsed.error.message);
  }
  return parsed.data as PageMeta;
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
  config: SiteConfig,
): PageType {
  let explicitType = (rawMeta as { site?: { type?: unknown } }).site?.type;
  let typeName =
    typeof explicitType === "string" ? explicitType : inferTypeFromDir(relPath, config.dirTypes);
  let pageType = config.pageTypes[typeName];
  if (!pageType) {
    throw new BuildError("schema", [relPath], `unknown page type ${typeName}`);
  }
  return pageType;
}

function schemaFields(definition: SchemaDefinition): Record<string, z.ZodTypeAny> {
  let fields: Record<string, z.ZodTypeAny> = { site: siteShape };
  definition.fields.forEach((field) => {
    let fieldSchema = fieldType(field.type);
    fields[field.name] = field.required ? fieldSchema : fieldSchema.optional();
    return true;
  });
  return fields;
}

function fieldType(type: SchemaFieldType): z.ZodTypeAny {
  if (type === "string") {
    return z.string();
  }
  if (type === "date") {
    return z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  }
  return z.array(z.string());
}

function inferTypeFromDir(relPath: string, dirTypes: { dir: string; type: string }[]): string {
  let bestDir = "";
  let bestType = "page";
  dirTypes.forEach(({ dir, type }) => {
    let underDir = relPath === dir ? true : relPath.startsWith(`${dir}/`);
    if (underDir && dir.length >= bestDir.length) {
      bestDir = dir;
      bestType = type;
    }
    return true;
  });
  return bestType;
}
