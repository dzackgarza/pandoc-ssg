import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanContent } from "../src/site/scan.ts";
import { listOutputFiles } from "./files.ts";

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
    "_site.toml",
    "blog/first.md",
    "index.md",
  ]);
});

test("scanContent preserves the exact deep nested image path 2026/spring/math2250/mypic.jpg", async () => {
  const got = await scanContent(deepnestContent);
  expect(got).toContain("2026/spring/math2250/mypic.jpg");
});

// Exact expectations keep the test inventory independent of the production scan.
test("file inventories include nested dotfiles, exclude directories, and sort relative paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssg-scan-"));
  try {
    await mkdir(join(root, "nested", ".hidden"), { recursive: true });
    await mkdir(join(root, "empty"));
    for (const path of ["z.txt", "nested/.hidden/b.txt", ".root", "nested/a.txt"]) {
      await writeFile(join(root, path), path);
    }
    const expected = [".root", "nested/.hidden/b.txt", "nested/a.txt", "z.txt"];
    expect(await scanContent(root)).toEqual(expected);
    expect(await listOutputFiles(root)).toEqual(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("output inventory counts symlinks as entries without descending into them", async () => {
  const root = await mkdtemp(join(tmpdir(), "ssg-output-scan-"));
  try {
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "file.txt"), "x");
    await symlink("nested", join(root, "alias"), "dir");
    await symlink("missing", join(root, "dangling"), "file");
    expect(await listOutputFiles(root)).toEqual(["alias", "dangling", "nested/file.txt"]);
    expect(await scanContent(root)).toEqual(["nested/file.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
