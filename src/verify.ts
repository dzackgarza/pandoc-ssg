import { BuildError } from "./errors.ts";
import type { Manifest } from "./types.ts";

export interface VerifyFinding {
  /** the page URL that failed */
  url: string;
  /** stable issue code (see verifySite) */
  issue: string;
  /** human-readable specifics (error text, count, status) */
  detail: string;
}

export interface VerifyOptions {
  /** origin of a running preview server, e.g. http://localhost:8080 */
  baseUrl: string;
  manifest: Manifest;
  /** per-page navigation timeout in ms (default 20000) */
  timeoutMs?: number;
}

/**
 * Boundary translator: load the optional `playwright` dependency, turning its
 * absence into an actionable BuildError instead of a raw module-resolution
 * error. Browser verification is opt-in, so the lean kernel does not force
 * playwright (or its browser downloads) on every consumer.
 */
async function loadChromium(): Promise<unknown> {
  try {
    let mod = await import("playwright");
    return (mod as { chromium: unknown }).chromium;
  } catch (err) {
    throw new BuildError(
      "verify",
      [],
      "browser verification needs the optional 'playwright' dependency; install it and its browser with `bun add -d playwright && bunx playwright install chromium`",
      err,
    );
  }
}

/**
 * Browser-level validation of the rendered, *served* site (O15). Drives a
 * headless Chromium over every manifest route and reports runtime defects that
 * neither a green build nor static HTML inspection can catch:
 *
 *   http-error         — the route did not serve with a 2xx/3xx status
 *   missing-main       — no <main> landmark in the live DOM
 *   missing-nav        — no <nav> landmark in the live DOM
 *   unresolved-markup  — `{% … %}`/`{: … }` visible in rendered text
 *   mathjax-error      — MathJax produced <mjx-merror> (e.g. an undefined macro)
 *   console-error      — the page logged a console error
 *   page-error         — an uncaught exception fired on the page
 *
 * Returns one finding per (url, issue, detail), sorted; empty means all pages
 * passed. Requires a running preview server (see startServer) at baseUrl.
 */
export async function verifySite(opts: VerifyOptions): Promise<VerifyFinding[]> {
  let timeoutMs = opts.timeoutMs === undefined ? 20000 : opts.timeoutMs;
  // biome-ignore lint/suspicious/noExplicitAny: playwright is an optional dep loaded dynamically; no types at kernel level
  let chromium = (await loadChromium()) as any;
  let browser = await chromium.launch({ headless: true });
  let findings: VerifyFinding[] = [];
  try {
    for (const route of opts.manifest.routes) {
      let pageFindings = await verifyPage(browser, opts.baseUrl, route.url, timeoutMs);
      findings.push(...pageFindings);
    }
  } finally {
    await browser.close();
  }
  findings.sort((a, b) => {
    if (a.url !== b.url) {
      return a.url < b.url ? -1 : 1;
    }
    if (a.issue !== b.issue) {
      return a.issue < b.issue ? -1 : 1;
    }
    return a.detail < b.detail ? -1 : a.detail > b.detail ? 1 : 0;
  });
  return findings;
}

// biome-ignore lint/suspicious/noExplicitAny: playwright Browser/Page have no types here (optional dep)
async function verifyPage(
  browser: any,
  baseUrl: string,
  routeUrl: string,
  timeoutMs: number,
): Promise<VerifyFinding[]> {
  let url = `${baseUrl}${routeUrl}`;
  let page = await browser.newPage();
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  page.on("console", (m: { type(): string; text(): string }) => {
    if (m.type() === "error") {
      consoleErrors.push(m.text());
    }
  });
  page.on("pageerror", (e: { message?: string }) => {
    pageErrors.push(e.message === undefined ? String(e) : e.message);
  });

  let findings: VerifyFinding[] = [];
  // domcontentloaded (not networkidle): real pages embed iframes/external media
  // that never go idle. Math gets a bounded settle window below.
  let response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (response !== null && response.status() >= 400) {
    findings.push({ url, issue: "http-error", detail: String(response.status()) });
  }
  if ((await page.locator("main").count()) === 0) {
    findings.push({ url, issue: "missing-main", detail: "" });
  }
  if ((await page.locator("nav").count()) === 0) {
    findings.push({ url, issue: "missing-nav", detail: "" });
  }
  let bodyText = await page.locator("body").innerText();
  if (bodyText.includes("{%") || bodyText.includes("{:")) {
    findings.push({ url, issue: "unresolved-markup", detail: "" });
  }
  // MathJax typesets asynchronously after load; settle only when the page
  // actually carries math, so component/text pages are not slowed.
  let hasMath = (await page.locator("span.math, mjx-container, mjx-merror").count()) > 0;
  if (hasMath) {
    await page.waitForTimeout(2000);
  }
  let merror = await page.locator("mjx-merror").count();
  if (merror > 0) {
    findings.push({ url, issue: "mathjax-error", detail: `${merror} expression(s)` });
  }
  for (const text of consoleErrors) {
    // A 404 on a third-party image/font is a link concern, not a page defect,
    // and external links are out of scope; keep only genuine script-level errors.
    if (text.includes("Failed to load resource") || text.includes("net::")) {
      continue;
    }
    findings.push({ url, issue: "console-error", detail: text });
  }
  for (const text of pageErrors) {
    findings.push({ url, issue: "page-error", detail: text });
  }
  await page.close();
  return findings;
}
