import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import { type RunningServer, startServer } from "../src/serve.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

describe("O13: preview server over a built dist tree", () => {
  let outDir: string;
  let server: RunningServer;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-serve-"));
    await build({ contentDir: DEMO_CONTENT, pandocDir: PANDOC_DIR, outDir });
    server = await startServer({ outDir });
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
    let res = await fetch(`http://localhost:${server.port}/2026/spring/math2250/mypic.jpg`);
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
    let encoded = await fetch(`http://localhost:${server.port}/%2e%2e/package.json`);
    expect(encoded.status).toBe(404);
  });
});

/**
 * Regression (observed): `pandoc-ssg verify`/`serve` 404'd EVERY route against a
 * real built dist because the CLI passes a relative, "./"-prefixed outDir
 * ("dist" / "./dist"). `join("./dist","index.html")` normalizes to
 * "dist/index.html", but the containment guard compared it against the raw
 * "./dist" — `"dist/index.html".startsWith("./dist/")` is false — so every file
 * was rejected. The existing suite missed it by only ever using absolute
 * mkdtemp dirs.
 */
describe("O13: serve resolves files under a relative outDir (CLI invocation)", () => {
  let origCwd: string;
  let tmp: string;
  let server: RunningServer;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "ssg-serve-rel-"));
    await mkdir(join(tmp, "dist"), { recursive: true });
    await writeFile(join(tmp, "dist", "index.html"), "<!DOCTYPE html>\n<title>home</title>", "utf8");
    origCwd = process.cwd();
    process.chdir(tmp);
    // exactly how the CLI invokes it: a relative, "./"-prefixed output dir
    server = await startServer({ outDir: "./dist" });
  });

  afterAll(async () => {
    server.stop();
    process.chdir(origCwd);
    await rm(tmp, { recursive: true, force: true });
  });

  test("GET / serves the index instead of 404ing", async () => {
    let res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("home");
  });
});
