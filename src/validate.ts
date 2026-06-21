import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "node-html-parser";
import type { Manifest } from "./types.ts";

export interface PageIssue {
  /** dist-relative output path of the page */
  page: string;
  /** stable issue code (see validateSite) */
  issue: string;
}

/**
 * Structural validation of the rendered site (manifest-driven). For every
 * route's output HTML this asserts the page compiled into a well-formed,
 * fully-migrated document, catching failure modes that a successful build
 * does not: source markup that pandoc passes through verbatim because it is
 * neither markdown nor a registered component.
 *
 * Issue codes:
 *   missing-doctype   — output does not begin with a <!doctype html>
 *   missing-main      — no <main> landmark (broken/!overridden template)
 *   empty-title       — <title> absent or whitespace-only
 *   leftover-liquid   — Jekyll `{% … %}` survived (un-migrated include/tag)
 *   leftover-kramdown — kramdown `{: … }` attribute list survived
 *
 * Returns one PageIssue per (page, code), sorted deterministically. An empty
 * array means every page passed.
 */
export async function validateSite(distDir: string, manifest: Manifest): Promise<PageIssue[]> {
  let perRouteIssues = await Promise.all(manifest.routes.map(async (route) => {
    let html = await readFile(join(distDir, route.output), "utf8");
    return pageIssues(html).map((issue) => ({ page: route.output, issue }));
  }));
  let issues = perRouteIssues.flat();
  issues.sort((a, b) => {
    if (a.page !== b.page) {
      return a.page < b.page ? -1 : 1;
    }
    if (a.issue === b.issue) {
      return 0;
    }
    return a.issue < b.issue ? -1 : 1;
  });
  return issues;
}

function pageIssues(html: string): string[] {
  let found: string[] = [];
  // Doctype + leftover-markup are checks on the literal serialization (a parser
  // normalizes the doctype away and these template-engine sigils are plain text
  // that escaped into output), so they stay string scans.
  if (!html.trimStart().toLowerCase().startsWith("<!doctype html")) {
    found.push("missing-doctype");
  }
  let root = parse(html);
  if (!root.querySelector("main")) {
    found.push("missing-main");
  }
  let title = root.querySelector("title");
  if (!title) {
    found.push("empty-title");
  } else if (title.text.trim() === "") {
    found.push("empty-title");
  }
  if (html.includes("{%")) {
    found.push("leftover-liquid");
  }
  if (/\{:\s/.test(html)) {
    found.push("leftover-kramdown");
  }
  return found;
}
