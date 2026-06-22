import { expect, test } from "bun:test";
import { BuildError } from "../src/errors.ts";
import { assertNoCollisions, outputPathForRoute, routeForPage } from "../src/site/routes.ts";
import type { PassthroughEntry, RouteEntry } from "../src/types.ts";

function route(source: string, url: string, output: string): RouteEntry {
  return { source, url, output, type: "page", schema: "page.v1" };
}

function passthrough(source: string, output: string): PassthroughEntry {
  return { source, output };
}

type CapturedThrow = { threw: true; error: unknown } | { threw: false };

function captureThrow(action: () => unknown): CapturedThrow {
  let result: CapturedThrow;
  try {
    action();
    result = { threw: false };
  } catch (error) {
    result = { threw: true, error };
  }
  return result;
}

// O2: routeForPage inference.

test("routeForPage maps index.md to the site root", () => {
  expect(routeForPage("index.md")).toBe("/");
});

test("routeForPage maps about.md to /about/", () => {
  expect(routeForPage("about.md")).toBe("/about/");
});

test("routeForPage maps a/b/index.md to /a/b/", () => {
  expect(routeForPage("a/b/index.md")).toBe("/a/b/");
});

test("routeForPage maps blog/foo.md to /blog/foo/", () => {
  expect(routeForPage("blog/foo.md")).toBe("/blog/foo/");
});

test("routeForPage uses a validated route override verbatim", () => {
  expect(routeForPage("x.md", "/custom/")).toBe("/custom/");
});

// O2: outputPathForRoute.

test("outputPathForRoute maps the root to index.html", () => {
  expect(outputPathForRoute("/")).toBe("index.html");
});

test("outputPathForRoute maps /a/b/ to a/b/index.html", () => {
  expect(outputPathForRoute("/a/b/")).toBe("a/b/index.html");
});

// O2: assertNoCollisions.

test("assertNoCollisions does not throw on disjoint outputs", () => {
  const routes = [
    route("content/index.md", "/", "index.html"),
    route("content/about.md", "/about/", "about/index.html"),
  ];
  const pass = [passthrough("content/MakeMeAQual/index.html", "MakeMeAQual/index.html")];
  expect(assertNoCollisions(routes, pass)).toBeTrue();
});

test("assertNoCollisions throws route-collision naming both page sources on a page/page clash", () => {
  const routes = [
    route("content/about.md", "/about/", "about/index.html"),
    route("content/about/index.md", "/about/", "about/index.html"),
  ];
  expect(captureThrow(() => assertNoCollisions(routes, []))).toMatchObject({
    threw: true,
    error: {
      name: "BuildError",
      kind: "route-collision",
      files: ["content/about.md", "content/about/index.md"],
    },
  });
});

test("assertNoCollisions throws BuildError on a page/page clash", () => {
  const routes = [
    route("content/about.md", "/about/", "about/index.html"),
    route("content/about/index.md", "/about/", "about/index.html"),
  ];
  expect(() => assertNoCollisions(routes, [])).toThrow(BuildError);
});

test("assertNoCollisions throws route-collision naming both sources on a page/passthrough clash", () => {
  const routes = [route("content/app.md", "/app/", "app/index.html")];
  const pass = [passthrough("content/app/index.html", "app/index.html")];
  expect(captureThrow(() => assertNoCollisions(routes, pass))).toMatchObject({
    threw: true,
    error: {
      name: "BuildError",
      kind: "route-collision",
      files: ["content/app.md", "content/app/index.html"],
    },
  });
});
