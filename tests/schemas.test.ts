import { expect, test } from "bun:test";
import { BuildError } from "../src/errors.ts";
import { resolvePageType, validatePageMeta } from "../src/schemas.ts";

// O3: validatePageMeta — page.v1.

test("validatePageMeta accepts a minimal page.v1 and returns the typed meta", () => {
  const meta = validatePageMeta("about.md", { title: "About", site: { page: true } }, "page.v1");
  expect(meta.title).toBe("About");
  expect(meta.site.page).toBe(true);
});

test("validatePageMeta rejects page.v1 missing title with schema error naming the file", async () => {
  await expect(
    Promise.resolve().then(() => validatePageMeta("about.md", { site: { page: true } }, "page.v1")),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["about.md"],
  });
});

test("validatePageMeta rejects an unknown top-level key with a schema error", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true }, banner: "x" },
        "page.v1",
      ),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["about.md"],
  });
});

test("validatePageMeta rejects an unknown schema id with a schema error", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta("about.md", { title: "About", site: { page: true } }, "page.v999"),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["about.md"],
  });
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
  );
  expect(meta.title).toBe("Example post");
  expect(meta.date).toBe("2026-06-12");
  expect(meta.tags).toEqual(["algebraic-geometry", "teaching"]);
});

test("validatePageMeta rejects blog-post.v1 with a non-ISO date string", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta(
        "blog/foo.md",
        { title: "Example post", site: { page: true }, date: "June 12, 2026" },
        "blog-post.v1",
      ),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["blog/foo.md"],
  });
});

test("validatePageMeta rejects blog-post.v1 missing the required date", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta(
        "blog/foo.md",
        { title: "Example post", site: { page: true } },
        "blog-post.v1",
      ),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["blog/foo.md"],
  });
});

// O3: validatePageMeta — site.route shape.

test("validatePageMeta accepts a site.route equal to the root", () => {
  const meta = validatePageMeta(
    "about.md",
    { title: "About", site: { page: true, route: "/" } },
    "page.v1",
  );
  expect(meta.site.route).toBe("/");
});

test("validatePageMeta accepts a site.route bounded by leading and trailing slashes", () => {
  const meta = validatePageMeta(
    "about.md",
    { title: "About", site: { page: true, route: "/activities/goats-2020/" } },
    "page.v1",
  );
  expect(meta.site.route).toBe("/activities/goats-2020/");
});

test("validatePageMeta rejects a site.route missing its leading slash", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true, route: "about/" } },
        "page.v1",
      ),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["about.md"],
  });
});

test("validatePageMeta rejects a site.route missing its trailing slash", async () => {
  await expect(
    Promise.resolve().then(() =>
      validatePageMeta(
        "about.md",
        { title: "About", site: { page: true, route: "/about" } },
        "page.v1",
      ),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
    files: ["about.md"],
  });
});

// O8: resolvePageType.

test("resolvePageType infers blog-post for a mapped directory with no explicit type", () => {
  const t = resolvePageType("blog/foo.md", { title: "Example post", site: { page: true } }, [
    { dir: "blog", type: "blog-post" },
  ]);
  expect(t).toEqual({ name: "blog-post", schema: "blog-post.v1", template: "blog.html" });
});

test("resolvePageType lets an explicit site.type beat directory inference", () => {
  const t = resolvePageType(
    "blog/foo.md",
    { title: "Example post", site: { page: true, type: "page" } },
    [{ dir: "blog", type: "blog-post" }],
  );
  expect(t).toEqual({ name: "page", schema: "page.v1", template: "page.html" });
});

test("resolvePageType falls back to the default page type in an unmapped directory", () => {
  const t = resolvePageType("about.md", { title: "About", site: { page: true } }, [
    { dir: "blog", type: "blog-post" },
  ]);
  expect(t).toEqual({ name: "page", schema: "page.v1", template: "page.html" });
});

test("resolvePageType picks the longest matching directory prefix", () => {
  const t = resolvePageType("blog/drafts/foo.md", { title: "Draft post", site: { page: true } }, [
    { dir: "blog", type: "page" },
    { dir: "blog/drafts", type: "blog-post" },
  ]);
  expect(t).toEqual({ name: "blog-post", schema: "blog-post.v1", template: "blog.html" });
});

test("resolvePageType rejects an unknown explicit site.type with a schema error", async () => {
  await expect(
    Promise.resolve().then(() =>
      resolvePageType("about.md", { title: "About", site: { page: true, type: "no-such-type" } }, [
        { dir: "blog", type: "blog-post" },
      ]),
    ),
  ).rejects.toMatchObject({
    name: "BuildError",
    kind: "schema",
  });
});
