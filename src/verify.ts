import type { Manifest } from "./types.ts";
import { chromium } from "playwright";
import type { Browser, ConsoleMessage } from "playwright";

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
  /** per-page navigation timeout in ms */
  timeoutMs: number;
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
 *   mathjax-error      — MathJax produced <mjx-merror>
 *   undefined-macro    — rendered math retains a literal \controlSequence (an
 *                        undefined macro or unrendered TeX; MathJax raises no
 *                        mjx-merror for these)
 *   console-error      — the page logged a console error
 *   page-error         — an uncaught exception fired on the page
 *
 * Returns one finding per (url, issue, detail), sorted; empty means all pages
 * passed. Requires a running preview server (see startServer) at baseUrl.
 */
export async function verifySite(opts: VerifyOptions): Promise<VerifyFinding[]> {
  let browser = await chromium.launch({ headless: true });
  let findings: VerifyFinding[] = [];
  try {
    let perPageFindings = await Promise.all(
      opts.manifest.routes.map((route) => verifyPage(browser, opts.baseUrl, route.url, opts.timeoutMs)),
    );
    findings.push(...perPageFindings.flat());
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

async function verifyPage(
  browser: Browser,
  baseUrl: string,
  routeUrl: string,
  timeoutMs: number,
): Promise<VerifyFinding[]> {
  let url = `${baseUrl}${routeUrl}`;
  let page = await browser.newPage();
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") {
      consoleErrors.push(m.text());
    }
    return true;
  });
  page.on("pageerror", (e: Error) => {
    pageErrors.push(e.message);
    return true;
  });

  let findings: VerifyFinding[] = [];
  // domcontentloaded (not networkidle): real pages embed iframes/external media
  // that never go idle. Math gets a bounded settle window below.
  let response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (response && response.status() >= 400) {
    findings.push({ url, issue: "http-error", detail: String(response.status()) });
  }
  if ((await page.locator("main").count()) === 0) {
    findings.push({ url, issue: "missing-main", detail: "" });
  }
  if ((await page.locator("nav").count()) === 0) {
    findings.push({ url, issue: "missing-nav", detail: "" });
  }
  // Scan prose only: "{%"/"{:" inside <pre>/<code> is legitimate displayed code
  // (e.g. LaTeX macros), not un-migrated Liquid/kramdown. String body avoids
  // node-side DOM typing.
  let proseText = await page.evaluate<string>(
    "(() => { const c = document.body.cloneNode(true); c.querySelectorAll('pre, code').forEach((e) => e.remove()); return c.innerText; })()",
  );
  let hasLiquid = proseText.includes("{%");
  let hasKramdownAttribute = proseText.includes("{:");
  if (hasLiquid) {
    findings.push({ url, issue: "unresolved-markup", detail: "" });
  }
  if (hasKramdownAttribute) {
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
  // Undefined macros do NOT raise <mjx-merror> in MathJax v3 — they render as a
  // literal control sequence inside the container (and fully unrendered math keeps
  // its raw TeX in span.math). Correctly typeset math is glyph-only, so any leftover
  // \controlSequence in rendered math proves an undefined macro / unrendered
  // expression that must gate the build before deploy.
  let leftover = await page.evaluate<string[]>(
    "(() => { const out = []; for (const el of document.querySelectorAll('mjx-container, span.math')) { const m = (el.textContent || '').match(/\\\\[a-zA-Z]+/g); if (m) { out.push(...m); } } return Array.from(new Set(out)); })()",
  );
  if (leftover.length > 0) {
    findings.push({ url, issue: "undefined-macro", detail: leftover.slice(0, 8).join(" ") });
  }
  findings.push(...consoleErrors.map((text) => ({ url, issue: "console-error", detail: text })));
  findings.push(...pageErrors.map((text) => ({ url, issue: "page-error", detail: text })));
  await page.close();
  return findings;
}
