import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "node-html-parser";
import type { Manifest } from "./types.ts";

export interface BrokenLink {
  sourcePage: string;
  target: string;
}

/** All `.html` file paths (POSIX, dist-relative) under `root`, recursively. */
async function htmlFiles(root: string): Promise<string[]> {
  let glob = new Bun.Glob("**/*.html");
  let out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: true, onlyFiles: true })) {
    out.push(rel);
  }
  return out;
}

/** Extract every `href` / `src` attribute value from HTML, via a real parser. */
function extractTargets(html: string): string[] {
  let out: string[] = [];
  for (const el of parse(html).querySelectorAll("[href], [src]")) {
    let href = el.getAttribute("href");
    if (href !== undefined) {
      out.push(href);
    }
    let src = el.getAttribute("src");
    if (src !== undefined) {
      out.push(src);
    }
  }
  return out;
}

/** True when the value is a site-internal link (single leading `/`). */
function isInternal(value: string): boolean {
  if (value === "") {
    return false;
  }
  if (value.startsWith("#")) {
    return false;
  }
  if (value.startsWith("//")) {
    return false;
  }
  return value.startsWith("/");
}

/**
 * Decode percent-escapes so a link like `/a/My%20File.html` resolves against
 * the real file `My File.html`. A stray `%` not followed by two hex digits is
 * not a valid escape; in that case the path is returned unchanged (rather than
 * letting decodeURIComponent throw), so a malformed link is simply checked
 * as-authored.
 */
function decodePath(path: string): string {
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) {
    return path;
  }
  return decodeURIComponent(path);
}

/**
 * Resolve an internal `/`-prefixed path against the built tree:
 *   `/p/`     → `distDir/p/index.html`
 *   `/p`      → `distDir/p` or `distDir/p/index.html`
 *   `/f.ext`  → `distDir/f.ext`
 */
async function fileExistsFor(distDir: string, path: string): Promise<boolean> {
  let rel = path.slice(1);
  if (path.endsWith("/")) {
    let candidate = join(distDir, rel, "index.html");
    return Bun.file(candidate).exists();
  }
  let direct = join(distDir, rel);
  if (await Bun.file(direct).exists()) {
    return true;
  }
  let asDir = join(distDir, rel, "index.html");
  return Bun.file(asDir).exists();
}

export async function checkLinks(distDir: string, manifest: Manifest): Promise<BrokenLink[]> {
  let routeUrls = new Set(manifest.routes.map((r) => r.url));
  let passthroughPaths = new Set(
    manifest.passthrough.map((p) => (p.output.startsWith("/") ? p.output : `/${p.output}`)),
  );

  let broken: BrokenLink[] = [];
  let pages = await htmlFiles(distDir);
  for (const page of pages) {
    let html = await readFile(join(distDir, page), "utf8");
    for (const raw of extractTargets(html)) {
      if (!isInternal(raw)) {
        continue;
      }
      // The URL builtin owns splitting off the ?query and #fragment.
      let path = decodePath(new URL(raw, "http://_").pathname);
      if (path === "") {
        continue;
      }
      if (routeUrls.has(path)) {
        continue;
      }
      if (passthroughPaths.has(path)) {
        continue;
      }
      if (await fileExistsFor(distDir, path)) {
        continue;
      }
      broken.push({ sourcePage: page, target: raw });
    }
  }

  broken.sort((a, b) => {
    if (a.sourcePage !== b.sourcePage) {
      return a.sourcePage < b.sourcePage ? -1 : 1;
    }
    if (a.target === b.target) {
      return 0;
    }
    return a.target < b.target ? -1 : 1;
  });
  return broken;
}
