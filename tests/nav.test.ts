import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadNavigation } from "../src/site/nav.ts";

async function navDir(toml: string): Promise<string> {
  let dir = await mkdtemp(join(tmpdir(), "nav-"));
  await mkdir(join(dir, "_data"), { recursive: true });
  await writeFile(join(dir, "_data", "navigation.toml"), toml);
  return dir;
}

test("loadNavigation parses a nested dropdown and sorts each level by weight", async () => {
  // A "Writing" parent (no href — a pure dropdown) grouping Notes + Talks, whose
  // children are declared out of weight order to prove the per-level sort.
  let dir = await navDir(`
[[main]]
title = "Home"
href = "/"
weight = 3

[[main]]
title = "Writing"
weight = 15

  [[main.children]]
  title = "Talks"
  href = "/talks/"
  weight = 20

  [[main.children]]
  title = "Notes"
  href = "/writing/"
  weight = 10
`);

  let nav = await loadNavigation(dir);

  expect(nav.map((n) => n.title)).toEqual(["Home", "Writing"]);
  let writing = nav[1];
  expect(writing?.href).toBeUndefined();
  // children sorted by weight: Notes (10) before Talks (20), not declaration order
  expect(writing?.children?.map((c) => c.title)).toEqual(["Notes", "Talks"]);
  expect(writing?.children?.map((c) => c.href)).toEqual(["/writing/", "/talks/"]);
});
