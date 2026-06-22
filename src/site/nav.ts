import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { BuildError } from "../errors.ts";
import type { NavItem } from "../types.ts";

let navItemShape: z.ZodType<NavItem> = z.lazy(() =>
  z
    .object({
      title: z.string(),
      href: z.string().optional(),
      weight: z.number(),
      children: z.array(navItemShape).optional(),
    })
    .strict()
    .refine((n) => {
      if (typeof n.href === "string") {
        return true;
      }
      if (!n.children) {
        return false;
      }
      return n.children.length > 0;
    }, "nav item needs an href or children"),
);

let navShape = z.object({
  main: z.array(navItemShape).optional(),
});

function navItemsFromConfig(items: NavItem[] | undefined): NavItem[] {
  if (items === undefined) {
    return [];
  }
  return items;
}

/** Sort each level by weight, recursively through children. */
function sortNav(items: NavItem[]): NavItem[] {
  return [...items]
    .sort((a, b) => a.weight - b.weight)
    .map((item) => {
      if (!item.children) {
        return item;
      }
      return { ...item, children: sortNav(item.children) };
    });
}

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

  let table = {};
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

  let items = navItemsFromConfig(parsed.data.main);
  return sortNav(items);
}
