import type { Manifest } from "./types.ts";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ShotResult {
  /** the manifest route url that was captured */
  url: string;
  /** absolute path of the written PNG */
  file: string;
}

export interface ShotOptions {
  /** origin of a running preview server, e.g. http://localhost:8080 */
  baseUrl: string;
  manifest: Manifest;
  /** directory to write `<name>.png` into (created if absent) */
  outDir: string;
  /** per-page navigation timeout in ms */
  timeoutMs: number;
}

/**
 * Filesystem-safe basename for a route url: the home route "/" becomes "index",
 * and a nested route "/a/b/" becomes "a-b". Deterministic and collision-free for
 * the injective routes O2 guarantees.
 */
export function shotName(routeUrl: string): string {
  let trimmed = routeUrl.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") {
    return "index";
  }
  return trimmed.replace(/\//g, "-");
}

/**
 * Full-page screenshot capture (O29). Drives a headless Chromium over every
 * manifest route of the running, *served* site and writes one full-page PNG per
 * route into `outDir`. Reuses the O15 browser machinery and the O13 server;
 * unlike O15 it produces images on a clean site rather than failing on findings.
 * Requires a running preview server at baseUrl (see startServer). Returns one
 * result per route, sorted by output path.
 */
export async function screenshotSite(opts: ShotOptions): Promise<ShotResult[]> {
  await mkdir(opts.outDir, { recursive: true });
  let browser = await chromium.launch({ headless: true });
  let results: ShotResult[] = [];
  try {
    results = await Promise.all(
      opts.manifest.routes.map((route) => shotPage(browser, opts, route.url)),
    );
  } finally {
    await browser.close();
  }
  results.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return results;
}

async function shotPage(browser: Browser, opts: ShotOptions, routeUrl: string): Promise<ShotResult> {
  let url = `${opts.baseUrl}${routeUrl}`;
  let file = join(opts.outDir, `${shotName(routeUrl)}.png`);
  let page = await browser.newPage();
  // domcontentloaded (not networkidle): real pages embed iframes/external media
  // that never go idle. Math gets a bounded settle window below so typeset
  // equations appear in the capture.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });
  let hasMath = (await page.locator("span.math, mjx-container").count()) > 0;
  if (hasMath) {
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return { url: routeUrl, file };
}
