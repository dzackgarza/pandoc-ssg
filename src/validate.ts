import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  let issues: PageIssue[] = [];
  for (const route of manifest.routes) {
    let html = await readFile(join(distDir, route.output), "utf8");
    for (const issue of pageIssues(html)) {
      issues.push({ page: route.output, issue });
    }
  }
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
  if (!html.trimStart().toLowerCase().startsWith("<!doctype html")) {
    found.push("missing-doctype");
  }
  if (!/<main[\s>]/i.test(html)) {
    found.push("missing-main");
  }
  if (!hasNonEmptyTitle(html)) {
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

function hasNonEmptyTitle(html: string): boolean {
  let match = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (match === null) {
    return false;
  }
  let inner = match[1];
  if (inner === undefined) {
    return false;
  }
  return inner.trim() !== "";
}
