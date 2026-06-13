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
  throwpage: page('<h1>e</h1><script>throw new Error("kaboom")</script>'),
  markup: page("<p>{% include x %}</p>"),
  nolandmarks:
    "<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>bare</p></body></html>",
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
    server = startServer({ outDir });
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

  test("an uncaught exception is reported as a page error", () => {
    expect(forUrl("/throwpage/")).toContain("page-error");
  });

  test("un-migrated Liquid visible in the live DOM is reported", () => {
    expect(forUrl("/markup/")).toContain("unresolved-markup");
  });

  test("missing main and nav landmarks are both reported", () => {
    let issues = forUrl("/nolandmarks/");
    expect(issues).toContain("missing-main");
    expect(issues).toContain("missing-nav");
  });
});
