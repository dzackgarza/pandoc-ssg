import { expect, test } from "bun:test";
import { resolvePageType, validatePageMeta } from "../src/content/schemas.ts";
import { BuildError } from "../src/errors.ts";
import type { SiteConfig } from "../src/types.ts";

const TEST_SCHEMAS: SiteConfig["schemas"] = {
  "page.v1": {
    fields: [{ name: "title", type: "string", required: true }],
  },
  "blog-post.v1": {
    fields: [
      { name: "title", type: "string", required: true },
      { name: "date", type: "date", required: true },
      { name: "tags", type: "string[]", required: false },
      { name: "categories", type: "string[]", required: false },
    ],
  },
};

const TEST_CONFIG: SiteConfig = {
  passthrough: [],
  dirTypes: [],
  pageTypes: {
    page: {
      name: "page",
      schema: "page.v1",
      template: "page.html",
      defaults: "defaults/page.yaml",
    },
    "blog-post": {
      name: "blog-post",
      schema: "blog-post.v1",
      template: "blog.html",
      defaults: "defaults/blog.yaml",
    },
  },
  schemas: TEST_SCHEMAS,
  componentHandlers: {},
  islands: {},
  generatedArtifacts: [],
};

function configWith(dirTypes: SiteConfig["dirTypes"]): SiteConfig {
  return { ...TEST_CONFIG, dirTypes };
}

async function expectBuildError(action: () => unknown, expected: { kind: string; files?: string[] }): Promise<void> {
  const rejection = Promise.resolve().then(action);
  await expect(rejection).rejects.toThrow(BuildError);
  await expect(rejection).rejects.toMatchObject({ name: "BuildError", ...expected });
}

// O3: validatePageMeta — page.v1.

test("validatePageMeta accepts a minimal page.v1 and returns the typed meta", () => {
  const meta = validatePageMeta(
    "about.md",
    { title: "About", site: { page: true } },
    "page.v1",
    TEST_SCHEMAS,
  );
  expect(meta.title).toBe("About");
  expect(meta.site.page).toBe(true);
});

test("validatePageMeta rejects page.v1 missing title with schema error naming the file", async () => {
  await expectBuildError(
    () => validatePageMeta("about.md", { site: { page: true } }, "page.v1", TEST_SCHEMAS),
    { kind: "schema", files: ["about.md"] },
  );
});

test("validatePageMeta rejects an unknown top-level key with a schema error", async () => {
  await expectBuildError(
    () =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true }, banner: "x" },
        "page.v1",
        TEST_SCHEMAS,
      ),
    { kind: "schema", files: ["about.md"] },
  );
});

test("validatePageMeta rejects an unknown schema id with a schema error", async () => {
  await expectBuildError(
    () =>
      validatePageMeta("about.md", { title: "About", site: { page: true } }, "page.v999", TEST_SCHEMAS),
    { kind: "schema", files: ["about.md"] },
  );
});

// O3: validatePageMeta — blog-post.v1.

test("validatePageMeta accepts a blog-post.v1 with ISO date and string tags", () => {
  const meta = validatePageMeta(
    "blog/foo.md",
    {
      title: "Example post",
      site: { page: true },
      date: "2026-06-12",
      tags: ["algebraic-geometry", "teaching"],
    },
    "blog-post.v1",
    TEST_SCHEMAS,
  );
  expect(meta.title).toBe("Example post");
  expect(meta.date).toBe("2026-06-12");
  expect(meta.tags).toEqual(["algebraic-geometry", "teaching"]);
});

test("validatePageMeta rejects blog-post.v1 with a non-ISO date string", async () => {
  await expectBuildError(
    () =>
      validatePageMeta(
        "blog/foo.md",
        { title: "Example post", site: { page: true }, date: "June 12, 2026" },
        "blog-post.v1",
        TEST_SCHEMAS,
      ),
    { kind: "schema", files: ["blog/foo.md"] },
  );
});

test("validatePageMeta rejects blog-post.v1 missing the required date", async () => {
  await expectBuildError(
    () =>
      validatePageMeta(
        "blog/foo.md",
        { title: "Example post", site: { page: true } },
        "blog-post.v1",
        TEST_SCHEMAS,
      ),
    { kind: "schema", files: ["blog/foo.md"] },
  );
});

// O3: validatePageMeta — site.route shape.

test("validatePageMeta accepts a site.route equal to the root", () => {
  const meta = validatePageMeta(
    "about.md",
    { title: "About", site: { page: true, route: "/" } },
    "page.v1",
    TEST_SCHEMAS,
  );
  expect(meta.site.route).toBe("/");
});

test("validatePageMeta accepts a site.route bounded by leading and trailing slashes", () => {
  const meta = validatePageMeta(
    "about.md",
    { title: "About", site: { page: true, route: "/activities/goats-2020/" } },
    "page.v1",
    TEST_SCHEMAS,
  );
  expect(meta.site.route).toBe("/activities/goats-2020/");
});

test("validatePageMeta rejects a site.route missing its leading slash", async () => {
  await expectBuildError(
    () =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true, route: "about/" } },
        "page.v1",
        TEST_SCHEMAS,
      ),
    { kind: "schema", files: ["about.md"] },
  );
});

test("validatePageMeta rejects a site.route missing its trailing slash", async () => {
  await expectBuildError(
    () =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true, route: "/about" } },
        "page.v1",
        TEST_SCHEMAS,
      ),
    { kind: "schema", files: ["about.md"] },
  );
});

// O8: resolvePageType.

test("resolvePageType infers blog-post for a mapped directory with no explicit type", () => {
  const t = resolvePageType(
    "blog/foo.md",
    { title: "Example post", site: { page: true } },
    configWith([{ dir: "blog", type: "blog-post" }]),
  );
  expect(t).toEqual({
    name: "blog-post",
    schema: "blog-post.v1",
    template: "blog.html",
    defaults: "defaults/blog.yaml",
  });
});

test("resolvePageType lets an explicit site.type beat directory inference", () => {
  const t = resolvePageType(
    "blog/foo.md",
    { title: "Example post", site: { page: true, type: "page" } },
    configWith([{ dir: "blog", type: "blog-post" }]),
  );
  expect(t).toEqual({
    name: "page",
    schema: "page.v1",
    template: "page.html",
    defaults: "defaults/page.yaml",
  });
});

test("resolvePageType falls back to the default page type in an unmapped directory", () => {
  const t = resolvePageType(
    "about.md",
    { title: "About", site: { page: true } },
    configWith([{ dir: "blog", type: "blog-post" }]),
  );
  expect(t).toEqual({
    name: "page",
    schema: "page.v1",
    template: "page.html",
    defaults: "defaults/page.yaml",
  });
});

test("resolvePageType picks the longest matching directory prefix", () => {
  const t = resolvePageType(
    "blog/drafts/foo.md",
    { title: "Draft post", site: { page: true } },
    configWith([
      { dir: "blog", type: "page" },
      { dir: "blog/drafts", type: "blog-post" },
    ]),
  );
  expect(t).toEqual({
    name: "blog-post",
    schema: "blog-post.v1",
    template: "blog.html",
    defaults: "defaults/blog.yaml",
  });
});

test("resolvePageType rejects an unknown explicit site.type with a schema error", async () => {
  await expectBuildError(
    () =>
      resolvePageType(
        "about.md",
        { title: "About", site: { page: true, type: "no-such-type" } },
        configWith([{ dir: "blog", type: "blog-post" }]),
      ),
    { kind: "schema" },
  );
});
