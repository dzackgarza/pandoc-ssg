import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { startServer, type RunningServer } from "../src/serve.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

describe("O13: preview server over a built dist tree", () => {
  let outDir: string;
  let server: RunningServer;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-serve-"));
    await build({ contentDir: DEMO_CONTENT, pandocDir: PANDOC_DIR, outDir });
    server = startServer({ outDir });
  });

  afterAll(async () => {
    server.stop();
    await rm(outDir, { recursive: true, force: true });
  });

  test("GET / returns home index.html as text/html", async () => {
    let res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    let body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  test("GET /about/ returns the about page as text/html", async () => {
    let res = await fetch(`http://localhost:${server.port}/about/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    let body = await res.text();
    expect(body).toContain("About");
  });

  test("GET a real asset returns its bytes with the right content-type", async () => {
    let res = await fetch(
      `http://localhost:${server.port}/2026/spring/math2250/mypic.jpg`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
  });

  test("GET an unknown path returns 404", async () => {
    let res = await fetch(`http://localhost:${server.port}/does-not-exist/`);
    expect(res.status).toBe(404);
  });

  test("path traversal attempt returns 404 and leaks nothing", async () => {
    let res = await fetch(`http://localhost:${server.port}/../package.json`);
    expect(res.status).toBe(404);
    let encoded = await fetch(
      `http://localhost:${server.port}/%2e%2e/package.json`,
    );
    expect(encoded.status).toBe(404);
  });
});
