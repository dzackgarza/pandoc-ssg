import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { build } from "../src/build.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "plain-para", "content");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const ROUTE = "intro-to-derived-algebraic-geometry-1-the-cotangent-complex-and-derived-de-rham-cohomology";

/**
 * Pandoc occasionally emits a prose block as `Plain` rather than `Para` (a real
 * case: a no-blank-line block that begins with a display-math `\[…\]`). The HTML
 * writer renders `Plain` WITHOUT a `<p>` wrapper, so the theme's `p`-scoped
 * prose size (1.4rem) does not apply and the text collapses to the 15px body
 * size mid-paragraph. This builds the real derived-AG post (which exhibits it)
 * and asserts the prose right after a display equation lives inside a paragraph.
 */
describe("prose after a display equation is wrapped in <p>, not left bare", () => {
  let outDir: string;
  let html: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "ssg-plainpara-"));
    await build({ contentDir: FIXTURE, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, ROUTE, "index.html"), "utf8");
  }, 120000);

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("the 'we send a set to the polynomial ring' prose has a <p> ancestor", () => {
    let root = parse(html);
    let phrase = "we send a set to the polynomial ring";
    // sanity: the phrase actually rendered on the page
    expect(root.text).toContain(phrase);
    // the discriminating claim: some <p> contains it. When the block is emitted
    // as a bare Plain (the bug), no <p> wraps it and this is false.
    let wrapped = root.querySelectorAll("p").some((p) => p.text.includes(phrase));
    expect(wrapped).toBe(true);
  });
});
