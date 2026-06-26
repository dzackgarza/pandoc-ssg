import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";
import type { Manifest, ManifestDependency, RouteEntry } from "../src/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const DEMO_CONTENT = join(FIXTURES, "demo", "content");

/** All file paths (POSIX, dir-relative) under `root`, recursively. */
async function walk(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walk(join(root, e.name), rel)));
    } else {
      out.push(rel);
    }
  }
  return out;
}

function sortRoutes(routes: RouteEntry[]): RouteEntry[] {
  return [...routes].sort((a, b) => a.source.localeCompare(b.source));
}

function routeCore(route: RouteEntry): Omit<RouteEntry, "dependencies"> {
  return {
    source: route.source,
    url: route.url,
    output: route.output,
    type: route.type,
    schema: route.schema,
  };
}

function sortedDependencyKeys(dependencies: ManifestDependency[]): string[] {
  return dependencies.map((dep) => [dep.kind, dep.origin, dep.path, dep.key ?? ""].join("\u0000")).sort();
}

const EXPECTED_ROUTES: RouteEntry[] = [
  {
    source: "2026/spring/math2250/index.md",
    url: "/2026/spring/math2250/",
    output: "2026/spring/math2250/index.html",
    type: "page",
    schema: "page.v1",
  },
  {
    source: "about.md",
    url: "/about/",
    output: "about/index.html",
    type: "page",
    schema: "page.v1",
  },
  {
    source: "blog.md",
    url: "/blog/",
    output: "blog/index.html",
    type: "page",
    schema: "page.v1",
  },
  {
    source: "blog/2026-06-12-hello.md",
    url: "/blog/2026-06-12-hello/",
    output: "blog/2026-06-12-hello/index.html",
    type: "blog-post",
    schema: "blog-post.v1",
  },
  {
    source: "index.md",
    url: "/",
    output: "index.html",
    type: "page",
    schema: "page.v1",
  },
];

// Every asset/opaque file that must appear in passthrough (output paths).
const EXPECTED_PASSTHROUGH_OUTPUTS = [
  "2026/spring/math2250/syllabus.md",
  "2026/spring/math2250/syllabus.pdf",
  "2026/spring/math2250/mypic.jpg",
  "standalone-app/index.html",
  "standalone-app/app.js",
].sort();

describe("O6: manifest is the single contract", () => {
  let outDir: string;
  let returned: Manifest;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-manifest-"));
    returned = await build({
      contentDir: DEMO_CONTENT,
      pandocDir: PANDOC_DIR,
      outDir,
    });
  }, 30000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("schemaVersion is 2", () => {
    expect(returned.schemaVersion).toBe(2);
  });

  test("returned manifest deep-equals the written site-manifest.json", async () => {
    const raw = await readFile(join(outDir, "site-manifest.json"), "utf8");
    const onDisk = JSON.parse(raw) as Manifest;
    expect(onDisk).toEqual(returned);
  });

  test("routes are EXACTLY the expected set", () => {
    expect(sortRoutes(returned.routes).map(routeCore)).toEqual(sortRoutes(EXPECTED_ROUTES));
  });

  test("route entries carry source, registry, nav, macro, and data dependencies", () => {
    const about = returned.routes.find((r) => r.source === "about.md");
    expect(about?.dependencies).toContainEqual({ kind: "source-page", path: "about.md", origin: "content" });
    expect(about?.dependencies).toContainEqual({ kind: "template", path: "page.html", origin: "pandoc" });
    expect(about?.dependencies).toContainEqual({ kind: "defaults", path: "defaults/page.yaml", origin: "pandoc" });
    expect(about?.dependencies).toContainEqual({ kind: "navigation", path: "_data/navigation.toml", origin: "content" });
    expect(about?.dependencies).toContainEqual({ kind: "site-config", path: "_site.toml", origin: "content" });
    expect(about?.dependencies).toContainEqual({ kind: "site-config", path: "registry.toml", origin: "pandoc" });
    expect(about?.dependencies).toContainEqual(expect.objectContaining({ kind: "macro-manifest", origin: "absolute" }));
  });

  test("passthrough entries carry their copied source dependency", () => {
    const app = returned.passthrough.find((p) => p.output === "standalone-app/app.js");
    expect(app?.dependencies).toEqual([
      { kind: "passthrough-source", path: "standalone-app/app.js", origin: "content" },
    ]);
  });

  test("all dependency arrays are deterministically sorted", () => {
    for (const entry of [...returned.routes, ...returned.passthrough, ...returned.generated]) {
      const dependencies = entry.dependencies ?? [];
      expect(dependencies.map((dep) => [dep.kind, dep.origin, dep.path, dep.key ?? ""].join("\u0000"))).toEqual(
        sortedDependencyKeys(dependencies),
      );
    }
  });

  test("passthrough outputs cover every asset and opaque file exactly", () => {
    const outputs = returned.passthrough.map((p) => p.output).sort();
    expect(outputs).toEqual(EXPECTED_PASSTHROUGH_OUTPUTS);
  });

  test("each passthrough source maps to the same relative output", () => {
    for (const p of returned.passthrough) {
      expect(p.output).toBe(p.source);
    }
  });

  test("bijection: dist contents == {manifest} ∪ routes ∪ passthrough ∪ generated", async () => {
    const onDisk = (await walk(outDir)).sort();

    const expected = [
      "site-manifest.json",
      ...returned.routes.map((r) => r.output),
      ...returned.passthrough.map((p) => p.output),
      ...returned.generated.map((g) => g.output),
    ].sort();

    expect(onDisk).toEqual(expected);
  });

  test("every manifest output exists on disk", async () => {
    for (const r of returned.routes) {
      expect((await stat(join(outDir, r.output))).isFile()).toBe(true);
    }
    for (const p of returned.passthrough) {
      expect((await stat(join(outDir, p.output))).isFile()).toBe(true);
    }
  });
});
