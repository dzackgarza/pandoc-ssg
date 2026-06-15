import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunningServer, startServer } from "../src/serve.ts";
import type { Manifest } from "../src/types.ts";
import { type VerifyFinding, verifySite } from "../src/verify.ts";

function page(body: string): string {
  return [
    "<!DOCTYPE html>",
    "<html><head><title>T</title></head>",
    `<body><nav></nav><main>${body}</main></body></html>`,
  ].join("\n");
}

// route key -> served HTML; each exercises one defect (or none)
const PAGES: Record<string, string> = {
  good: page("<h1>fine</h1>"),
  console: page('<h1>e</h1><script>console.error("boom")</script>'),
  // Third-party embeds (YouTube) log a "Permissions policy violation" when they
  // use a feature the host page does not grant (e.g. compute-pressure). This is
  // frame noise, not a page defect — like the net::/404 subresource noise already
  // excluded — and must not gate the build.
  permpolicy: page(
    '<h1>e</h1><script>console.error("[Violation] Permissions policy violation: compute-pressure is not allowed in this document.")</script>',
  ),
  throwpage: page('<h1>e</h1><script>throw new Error("kaboom")</script>'),
  markup: page("<p>{% include x %}</p>"),
  // legitimate displayed code (LaTeX) that merely contains "{%" — not un-migrated
  // Liquid. A real migrated post (latex-handwriting) hits this.
  codemarkup: page("<pre><code>\\newcommand{\\setline}[2]{%\n  \\hrule\n}</code></pre>"),
  nolandmarks:
    "<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>bare</p></body></html>",
  // Captured from the live derived-AG page: MathJax renders an undefined macro
  // (the author's global \GGm, absent from the injected set) as a LITERAL control
  // sequence inside the container, and raises NO <mjx-merror>. 61 of 154 containers
  // on that page were broken this way, yet verify reported zero findings because it
  // only counts <mjx-merror>. The gate must catch leftover TeX control sequences in
  // rendered math.
  undefinedmacro: page('<mjx-container class="MathJax">K(\\GGm,n)</mjx-container>'),
};

function manifestFor(keys: string[]): Manifest {
  return {
    schemaVersion: 1,
    routes: keys.map((k) => ({
      source: `${k}.md`,
      url: `/${k}/`,
      output: `${k}/index.html`,
      type: "page",
      schema: "page.v1",
    })),
    passthrough: [],
    generated: [],
  };
}

describe("O15: browser verification catches runtime defects", () => {
  let outDir: string;
  let server: RunningServer;
  let findings: VerifyFinding[];

  function forUrl(url: string): string[] {
    return findings.filter((f) => f.url.endsWith(url)).map((f) => f.issue);
  }

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-verify-"));
    for (const [key, html] of Object.entries(PAGES)) {
      let dir = join(outDir, key);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "index.html"), html, "utf8");
    }
    server = await startServer({ outDir });
    findings = await verifySite({
      baseUrl: `http://localhost:${server.port}`,
      manifest: manifestFor(Object.keys(PAGES)),
    });
  }, 60000);

  afterAll(async () => {
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("a well-formed page produces no findings", () => {
    expect(forUrl("/good/")).toEqual([]);
  });

  test("a console error is reported", () => {
    expect(forUrl("/console/")).toContain("console-error");
  });

  test("a third-party permissions-policy violation is NOT flagged as a console error", () => {
    expect(forUrl("/permpolicy/")).not.toContain("console-error");
  });

  test("an uncaught exception is reported as a page error", () => {
    expect(forUrl("/throwpage/")).toContain("page-error");
  });

  test("un-migrated Liquid visible in the live DOM is reported", () => {
    expect(forUrl("/markup/")).toContain("unresolved-markup");
  });

  test("liquid-looking text inside a code block is NOT flagged", () => {
    expect(forUrl("/codemarkup/")).not.toContain("unresolved-markup");
  });

  test("missing main and nav landmarks are both reported", () => {
    let issues = forUrl("/nolandmarks/");
    expect(issues).toContain("missing-main");
    expect(issues).toContain("missing-nav");
  });

  test("an undefined macro left as a literal control sequence in rendered math is reported", () => {
    // Reproduces the live derived-AG defect: MathJax emits no <mjx-merror> for an
    // undefined macro, so the merror check is blind to it. A correctly rendered
    // mjx-container never retains a literal \macro; its presence proves unrendered
    // math / an undefined macro that must gate the build before deploy.
    expect(forUrl("/undefinedmacro/")).toContain("undefined-macro");
  });

  test("a well-formed page with rendered math is NOT flagged for undefined macros", () => {
    // Glyph-only container (no leftover backslash control sequence) is correct math.
    expect(forUrl("/good/")).toEqual([]);
  });
});
