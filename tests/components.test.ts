import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/build.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "site");
const PANDOC_DIR = join(import.meta.dir, "..", "pandoc");
const COMPONENTS_CONTENT = join(FIXTURES, "components", "content");

function freshOutDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ssg-out-"));
}

/**
 * Component filter (data-backed fenced-div components). The `/writing/` page's
 * feature rows are the motivating case: a `::: {.component type="feature-row"
 * items="X"}` div must expand to a card grid built from _data/items.yaml,
 * with each card's markdown excerpt rendered to HTML.
 */
describe("component filter: feature-row expands from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a feature-row container, not an empty component div", () => {
    expect(html).toContain('class="feature-row"');
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="feature-row"');
  });

  test("renders one card per data entry with its title", () => {
    expect(html).toContain("Alpha Notes");
    expect(html).toContain("Beta Notes");
    expect(html).toContain('src="/img/a.png"');
    expect(html).toContain('alt="Alpha"');
  });

  test("card excerpt is rendered as markdown, not emitted verbatim", () => {
    // *Prof X, Fall 2020* must become emphasis, and the [PDF](url) a real link
    expect(html).toContain("<em>Prof X, Fall 2020</em>");
    expect(html).toContain('href="https://example.com/a.pdf"');
    expect(html).not.toContain("*Prof X, Fall 2020*");
  });

  test("a card with empty url produces no broken empty-href link", () => {
    expect(html).not.toContain('href=""');
  });
});

describe("component filter: media-gallery renders a static media grid from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "media-gallery", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a media-gallery container, not an empty component div", () => {
    expect(html).toContain('class="media-gallery"');
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="media-gallery"');
  });

  test("renders one figure per item in authored order", () => {
    const items = html.split('class="media-gallery__item"').length - 1;
    expect(items).toBe(3);
    expect(html.indexOf("/img/sphere.png")).toBeLessThan(html.indexOf("/img/klein.png"));
  });

  test("an image item renders an img with its src and alt", () => {
    expect(html).toContain('src="/img/sphere.png"');
    expect(html).toContain('alt="Sphere"');
  });

  test("an image with href links the image; an image without href has no empty link", () => {
    expect(html).toContain('href="/img/klein-large.png"');
    expect(html).not.toContain('href=""');
  });

  test("a video item embeds the provider iframe inside the gallery", () => {
    expect(html).toContain('src="https://www.youtube.com/embed/zRPa-VAvl6Q"');
    expect(html).toContain('class="responsive-embed"');
  });

  test("item tags are carried as a data attribute, not as an interactive filter", () => {
    expect(html).toContain('data-tags="hand-drawn topology"');
    // static component: no island bundle is referenced (no client-side filter)
    expect(html).not.toContain("assets/islands");
  });

  test("a caption is rendered as inline markdown", () => {
    expect(html).toContain("<em>2-sphere</em>");
  });
});

describe("component filter: a media-gallery item with an unknown type fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badMedia = join(FIXTURES, "components", "bad-media");
    await expect(
      build({ contentDir: badMedia, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: timeline expands to a dated list from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "timeline", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a timeline container, not an empty component div", () => {
    expect(html).toContain('class="timeline"');
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="timeline"');
  });

  test("renders one entry per data item in authored (not re-sorted) order", () => {
    const entries = html.split('class="timeline__entry"').length - 1;
    expect(entries).toBe(2);
    // demo-timeline lists Fall 2024 before Spring 2024; order is preserved
    expect(html.indexOf("Fall 2024")).toBeLessThan(html.indexOf("Spring 2024"));
  });

  test("each entry carries its date text", () => {
    expect(html).toContain("Fall 2024");
    expect(html).toContain("Spring 2024");
  });

  test("entry title is rendered as inline markdown (emphasis/math capable)", () => {
    expect(html).toContain("<em>Abstract Algebra</em>");
    expect(html).not.toContain("*Abstract Algebra*");
  });

  test("entry detail is rendered as inline markdown, not emitted verbatim", () => {
    expect(html).toContain('href="https://example.com/syllabus.pdf"');
  });

  test("an entry without a detail still renders its title and no broken empty link", () => {
    // the second entry (Spring 2024) has no detail field
    expect(html).toContain("<em>Number Theory</em>");
    expect(html).not.toContain('href=""');
  });
});

describe("component filter: a timeline with an unknown items key fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badTimeline = join(FIXTURES, "components", "bad-timeline");
    await expect(
      build({ contentDir: badTimeline, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: a timeline entry with no date fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badTimeline = join(FIXTURES, "components", "bad-timeline-nodate");
    await expect(
      build({ contentDir: badTimeline, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: papers expands to a bibliographic list from _data/items.yaml", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "papers", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("emits a papers list, not an empty component div", () => {
    expect(html).toContain('class="papers"');
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="papers"');
  });

  test("renders one entry per paper in authored order", () => {
    const entries = html.split('class="paper"').length - 1;
    expect(entries).toBe(2);
    expect(html.indexOf("Enriques")).toBeLessThan(html.indexOf("A preprint with no abstract"));
  });

  test("title is rendered as inline markdown (emphasis/math capable)", () => {
    expect(html).toContain("<em>Enriques</em>");
    expect(html).not.toContain("*Enriques*");
  });

  test("meta line joins present fields with a middot in authors·year·venue order", () => {
    expect(html).toContain("Alexeev, Engel, Garza, Schaffler · 2025 · Nagoya Math. J. 259");
    // absent fields must not produce empty or doubled separators
    expect(html).not.toContain(" ·  · ");
  });

  test("a bare arxiv id becomes an abs link labeled arXiv:<id>", () => {
    expect(html).toContain('href="https://arxiv.org/abs/2312.03638"');
    expect(html).toContain("arXiv:2312.03638");
  });

  test("a full arxiv url is linked verbatim", () => {
    expect(html).toContain('href="https://arxiv.org/abs/2401.00000"');
  });

  test("an abstract is an expandable details with block-markdown body", () => {
    expect(html).toContain('class="abstract-toggle"');
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    // abstract markdown is rendered, not emitted verbatim
    expect(html).toContain("<em>stable pair</em>");
  });

  test("a paper with no abstract emits no details element", () => {
    // only the first paper has an abstract; the second must not add a <details>
    const details = html.split("<details").length - 1;
    expect(details).toBe(1);
  });
});

describe("component filter: a papers list with an unknown items key fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badPapers = join(FIXTURES, "components", "bad-papers");
    await expect(
      build({ contentDir: badPapers, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: a paper entry with no title fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badPapers = join(FIXTURES, "components", "bad-papers-notitle");
    await expect(
      build({ contentDir: badPapers, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: video embeds a provider iframe", () => {
  let html: string;
  let outDir: string;

  beforeAll(async () => {
    outDir = await freshOutDir();
    await build({ contentDir: COMPONENTS_CONTENT, pandocDir: PANDOC_DIR, outDir });
    html = await readFile(join(outDir, "video", "index.html"), "utf8");
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  test("expands to a youtube embed iframe carrying the video id", () => {
    expect(html).toContain('src="https://www.youtube.com/embed/zRPa-VAvl6Q"');
    expect(html).toContain("<iframe");
    // the placeholder div must have been consumed, not passed through verbatim
    expect(html).not.toContain('type="video"');
  });

  test("wraps the iframe in a responsive container", () => {
    expect(html).toContain('class="responsive-embed"');
  });
});

describe("component filter: an unknown video provider fails the build", () => {
  test("rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badVideo = join(FIXTURES, "components", "bad-video");
    await expect(
      build({ contentDir: badVideo, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});

describe("component filter: unknown component type fails the build", () => {
  test("an unregistered component type rejects with BuildError kind=pandoc", async () => {
    const outDir = await freshOutDir();
    const badContent = join(FIXTURES, "components", "bad-content");
    await expect(
      build({ contentDir: badContent, pandocDir: PANDOC_DIR, outDir }),
    ).rejects.toMatchObject({ name: "BuildError", kind: "pandoc" });
    await rm(outDir, { recursive: true, force: true });
  });
});
