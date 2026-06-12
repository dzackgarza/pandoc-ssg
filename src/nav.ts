import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { BuildError } from "./errors.ts";
import type { Manifest, NavItem } from "./types.ts";

let navShape = z.object({
  main: z
    .array(
      z
        .object({
          title: z.string(),
          href: z.string(),
          weight: z.number(),
          external: z.boolean().optional(),
        })
        .strict(),
    )
    .optional(),
});

/**
 * Load content/_data/navigation.toml ([[main]] entries). Missing file means
 * an empty nav. Malformed entries throw BuildError(kind="nav").
 */
export async function loadNavigation(contentDir: string): Promise<NavItem[]> {
  let navPath = join(contentDir, "_data", "navigation.toml");
  if (!(await Bun.file(navPath).exists())) {
    return [];
  }
  let raw = await readFile(navPath, "utf8");

  let table: unknown;
  try {
    table = parse(raw);
  } catch (err) {
    let detail = err instanceof Error ? err.message : String(err);
    throw new BuildError(
      "nav",
      ["_data/navigation.toml"],
      `malformed navigation.toml: ${detail}`,
      err,
    );
  }

  let parsed = navShape.safeParse(table);
  if (!parsed.success) {
    throw new BuildError("nav", ["_data/navigation.toml"], parsed.error.message);
  }

  let items = parsed.data.main === undefined ? [] : parsed.data.main;
  return [...items].sort((a, b) => a.weight - b.weight);
}

/** True for nav entries that are not internal site routes. */
function isExternal(item: NavItem): boolean {
  if (item.external === true) {
    return true;
  }
  return /^https?:\/\//.test(item.href);
}

/**
 * O7: every non-external nav href must equal a manifest route url, else
 * BuildError(kind="nav").
 */
export function assertNavTargets(nav: NavItem[], manifest: Manifest): void {
  let urls = new Set(manifest.routes.map((r) => r.url));
  for (const item of nav) {
    if (isExternal(item)) {
      continue;
    }
    if (!urls.has(item.href)) {
      throw new BuildError(
        "nav",
        ["_data/navigation.toml"],
        `nav target ${item.href} (${item.title}) matches no route`,
      );
    }
  }
}
