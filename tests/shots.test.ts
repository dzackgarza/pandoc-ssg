import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type RunningServer, startServer } from "../src/serve.ts";
import type { Manifest } from "../src/types.ts";
import { type ShotResult, screenshotSite, shotName } from "../src/shots.ts";

function page(body: string): string {
  return [
    "<!DOCTYPE html>",
    "<html><head><title>T</title></head>",
    `<body><nav></nav><main>${body}</main></body></html>`,
  ].join("\n");
}

// route key -> served HTML
const PAGES: Record<string, string> = {
  index: page("<h1>home</h1>"),
  about: page("<h1>about</h1>"),
  "blog/first-post": page("<h1>a post</h1>"),
};

function manifestFor(keys: string[]): Manifest {
  return {
    schemaVersion: 2,
    routes: keys.map((k) => ({
      source: `${k}.md`,
      url: k === "index" ? "/" : `/${k}/`,
      output: k === "index" ? "index.html" : `${k}/index.html`,
      type: "page",
      schema: "page.v1",
    })),
    passthrough: [],
    generated: [],
  };
}

// PNG signature: the eight bytes every PNG file begins with.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("O29: full-page screenshot capture", () => {
  test("route url maps to a deterministic filesystem-safe basename", () => {
    expect(shotName("/")).toBe("index");
    expect(shotName("/about/")).toBe("about");
    expect(shotName("/blog/first-post/")).toBe("blog-first-post");
  });

  describe("screenshotSite over a served tree", () => {
    let outDir: string;
    let shotsDir: string;
    let server: RunningServer;
    let results: ShotResult[];

    beforeAll(async () => {
      outDir = await mkdtemp(join(tmpdir(), "ssg-shots-out-"));
      shotsDir = await mkdtemp(join(tmpdir(), "ssg-shots-png-"));
      for (const [key, html] of Object.entries(PAGES)) {
        let dir = key === "index" ? outDir : join(outDir, key);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "index.html"), html, "utf8");
      }
      server = await startServer({ outDir });
      results = await screenshotSite({
        baseUrl: `http://localhost:${server.port}`,
        manifest: manifestFor(Object.keys(PAGES)),
        outDir: shotsDir,
        timeoutMs: 20000,
      });
    }, 60000);

    afterAll(async () => {
      server.stop();
      await rm(outDir, { recursive: true, force: true });
      await rm(shotsDir, { recursive: true, force: true });
    });

    test("captures exactly one screenshot per manifest route (total coverage)", () => {
      expect(results.length).toBe(Object.keys(PAGES).length);
    });

    test("each screenshot is a non-empty valid PNG on disk", async () => {
      for (const r of results) {
        let bytes = await readFile(r.file);
        expect(bytes.length).toBeGreaterThan(0);
        expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
      }
    });

    test("the home route is written as index.png", () => {
      expect(results.some((r) => r.file.endsWith("/index.png"))).toBe(true);
    });
  });
});
