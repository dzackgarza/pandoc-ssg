import { describe, expect, test } from "bun:test";
import { resolveIslandEntry } from "../src/island-path.ts";

// Guards the generator↔content contract that broke once: config.ts (registry
// validation) and islands.ts (vite bundling) now both resolve island entries
// through resolveIslandEntry, so pinning it here pins both — they cannot drift.
// Expected paths are written as literals, NOT recomputed via join(), so a switch
// to a different path constructor that diverges on edge cases would be caught.
const roots = { contentDir: "/site/content", pandocDir: "/site/pandoc" };

describe("resolveIslandEntry — single island-path contract", () => {
  test("content-owned island resolves under contentDir", () => {
    expect(resolveIslandEntry({ source: "content", entry: "islands/x/main.ts" }, roots)).toBe(
      "/site/content/islands/x/main.ts",
    );
  });

  test("installed generator island (node_modules form) is project-root-relative", () => {
    // The exact consumer form that broke the build: a content repo pinning
    // pandoc-ssg references islands at node_modules/pandoc-ssg/islands/…, which
    // must resolve next to the pandoc/ bundle (pandocDir/..), not under it.
    expect(
      resolveIslandEntry({ entry: "node_modules/pandoc-ssg/islands/collection/main.ts" }, roots),
    ).toBe("/site/node_modules/pandoc-ssg/islands/collection/main.ts");
  });

  test("content repo's own islands/ tree (non-content source) is project-root-relative", () => {
    expect(resolveIslandEntry({ source: "pandoc", entry: "islands/y/main.ts" }, roots)).toBe(
      "/site/islands/y/main.ts",
    );
  });
});
