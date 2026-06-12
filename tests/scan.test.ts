import { test, expect } from "bun:test";
import { join } from "node:path";
import { scanContent } from "../src/scan.ts";

const fixtures = join(import.meta.dir, "fixtures", "kernel");
const basicContent = join(fixtures, "basic", "content");
const deepnestContent = join(fixtures, "deepnest", "content");

// O1: scanContent returns sorted POSIX relative paths of every file recursively.

test("scanContent lists every file in the basic tree as sorted POSIX relative paths", async () => {
  const got = await scanContent(basicContent);
  expect(got).toEqual([
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
  ]);
});

test("scanContent recurses into dotless deep directories and keeps POSIX separators", async () => {
  const got = await scanContent(deepnestContent);
  expect(got).toEqual([
    "2026/spring/math2250/index.md",
    "2026/spring/math2250/mypic.jpg",
    "blog/first.md",
    "index.md",
  ]);
});

test("scanContent preserves the exact deep nested image path 2026/spring/math2250/mypic.jpg", async () => {
  const got = await scanContent(deepnestContent);
  expect(got).toContain("2026/spring/math2250/mypic.jpg");
});
