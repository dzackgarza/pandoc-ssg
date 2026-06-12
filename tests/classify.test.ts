import { test, expect } from "bun:test";
import { join } from "node:path";
import { classifyFiles } from "../src/classify.ts";
import type { ClassifiedFile, FileClass, SiteConfig } from "../src/types.ts";

const basicContent = join(import.meta.dir, "fixtures", "kernel", "basic", "content");

const config: SiteConfig = {
  passthrough: [{ path: "MakeMeAQual" }],
  dirTypes: [{ dir: "blog", type: "blog-post" }],
};

const allRelPaths = [
  "2026/spring/math2250/index.md",
  "2026/spring/math2250/mypic.jpg",
  "2026/spring/math2250/syllabus.md",
  "2026/spring/math2250/syllabus.pdf",
  "MakeMeAQual/assets/app.js",
  "MakeMeAQual/index.html",
  "MakeMeAQual/readme.md",
  "_data/navigation.toml",
  "_site.toml",
  "about.md",
  "blog/foo.md",
  "draft.md",
  "index.md",
  "notes.md",
];

async function classOf(relPath: string): Promise<string> {
  const result = await classifyFiles(basicContent, allRelPaths, config);
  const entry = result.find((c: ClassifiedFile) => c.relPath === relPath);
  if (entry === undefined) {
    throw new Error(`classifyFiles dropped ${relPath} from its output`);
  }
  return entry.class;
}

// O1: exactly one class per file, totality + exclusivity.

test("classifyFiles returns exactly one classification entry per input path", async () => {
  const result = await classifyFiles(basicContent, allRelPaths, config);
  expect(result.map((c) => c.relPath).sort()).toEqual([...allRelPaths].sort());
  expect(result.length).toBe(allRelPaths.length);
});

test("classifyFiles assigns the full basic tree its exact expected classes", async () => {
  const result = await classifyFiles(basicContent, allRelPaths, config);
  const byPath = new Map(result.map((c) => [c.relPath, c.class]));
  const expected: Record<string, FileClass> = {
    "_site.toml": "reserved",
    "_data/navigation.toml": "reserved",
    "MakeMeAQual/index.html": "opaque",
    "MakeMeAQual/assets/app.js": "opaque",
    "MakeMeAQual/readme.md": "opaque",
    "index.md": "page",
    "about.md": "page",
    "blog/foo.md": "page",
    "2026/spring/math2250/index.md": "page",
    "2026/spring/math2250/syllabus.md": "asset",
    "2026/spring/math2250/syllabus.pdf": "asset",
    "2026/spring/math2250/mypic.jpg": "asset",
    "draft.md": "asset",
    "notes.md": "asset",
  };
  for (const [path, cls] of Object.entries(expected)) {
    expect(byPath.get(path)).toBe(cls);
  }
});

test("reserved: a path whose first segment starts with underscore classifies reserved", async () => {
  expect(await classOf("_site.toml")).toBe("reserved");
  expect(await classOf("_data/navigation.toml")).toBe("reserved");
});

test("opaque: a passthrough-subtree file classifies opaque", async () => {
  expect(await classOf("MakeMeAQual/index.html")).toBe("opaque");
  expect(await classOf("MakeMeAQual/assets/app.js")).toBe("opaque");
});

test("opaque wins over page: a site.page true markdown inside a passthrough subtree classifies opaque", async () => {
  expect(await classOf("MakeMeAQual/readme.md")).toBe("opaque");
});

test("page: a markdown whose frontmatter has site.page true classifies page", async () => {
  expect(await classOf("index.md")).toBe("page");
  expect(await classOf("about.md")).toBe("page");
  expect(await classOf("blog/foo.md")).toBe("page");
  expect(await classOf("2026/spring/math2250/index.md")).toBe("page");
});

test("asset: markdown with site.page false classifies asset, not page", async () => {
  expect(await classOf("draft.md")).toBe("asset");
});

test("asset: markdown with no site frontmatter classifies asset", async () => {
  expect(await classOf("notes.md")).toBe("asset");
});

test("asset: non-opt-in markdown beside a pdf (syllabus case) classifies asset", async () => {
  expect(await classOf("2026/spring/math2250/syllabus.md")).toBe("asset");
});

test("asset: non-markdown files never classify page", async () => {
  expect(await classOf("2026/spring/math2250/mypic.jpg")).toBe("asset");
  expect(await classOf("2026/spring/math2250/syllabus.pdf")).toBe("asset");
});
