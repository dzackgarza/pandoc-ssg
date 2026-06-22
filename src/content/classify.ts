import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import type { ClassifiedFile, FileClass, SiteConfig } from "../types.ts";

/**
 * Classify every scanned file into exactly one FileClass (O1):
 * - "reserved": any path whose first segment starts with "_"
 * - "opaque":   inside a config-declared passthrough subtree (wins over page)
 * - "page":     a .md file whose YAML frontmatter has `site.page: true`
 * - "asset":    everything else, including non-opt-in markdown
 */
export function classifyFiles(
  contentDir: string,
  relPaths: string[],
  config: Pick<SiteConfig, "passthrough">,
): Promise<ClassifiedFile[]> {
  return Promise.all(
    relPaths.map(async (relPath) => {
      let fileClass = await classifyOne(contentDir, relPath, config);
      return { relPath, class: fileClass };
    }),
  );
}

async function classifyOne(
  contentDir: string,
  relPath: string,
  config: Pick<SiteConfig, "passthrough">,
): Promise<FileClass> {
  let firstSegment = relPath.split("/")[0];
  if (!firstSegment) {
    throw new Error("content path must not be empty");
  }
  if (firstSegment.startsWith("_")) {
    return "reserved";
  }
  if (config.passthrough.some((p) => isInSubtree(relPath, p.path))) {
    return "opaque";
  }
  if (relPath.endsWith(".md") && (await isOptInPage(contentDir, relPath))) {
    return "page";
  }
  return "asset";
}

function isInSubtree(relPath: string, subtree: string): boolean {
  if (relPath === subtree) {
    return true;
  }
  return relPath.startsWith(`${subtree}/`);
}

async function isOptInPage(contentDir: string, relPath: string): Promise<boolean> {
  let raw = await readFile(join(contentDir, relPath), "utf8");
  let parsed = matter(raw);
  let site = (parsed.data as { site?: { page?: unknown } }).site;
  return site?.page === true;
}
