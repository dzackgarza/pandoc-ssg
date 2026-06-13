#!/usr/bin/env bun
/**
 * CLI entrypoint. The generator ships no content; it operates on a content
 * directory supplied by the caller (default: ./content in the current repo),
 * the way a content repo depends on this tool. Subcommands:
 *   build [--content DIR] [--pandoc DIR] [--out DIR]   — full pipeline (O9)
 *   new post "Title" [--content DIR]                   — scaffold a blog post (O9)
 *   check [--content DIR] [--pandoc DIR] [--out DIR]   — build, then report
 *                                                        broken internal links;
 *                                                        exit 1 if any (O12)
 *   serve [--out DIR] [--port N]                        — preview the built tree (O13)
 * Defaults: --content ./content, --pandoc the bundled design layer, --out ./dist.
 * Exits 0 on success; nonzero with the BuildError report on stderr.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { build } from "./build.ts";
import { BuildError } from "./errors.ts";
import { checkLinks } from "./links.ts";
import { validatePageMeta } from "./schemas.ts";
import { startServer } from "./serve.ts";

/** The design layer (defaults, templates, filters) bundled with the generator. */
let BUNDLED_PANDOC = join(import.meta.dir, "..", "pandoc");

/** Flag value, or a fallback when the flag is absent. */
function flagOr(flags: Map<string, string>, name: string, fallback: string): string {
  let value = flags.get(name);
  return value === undefined ? fallback : value;
}

/** Collect repeated `--flag value` pairs from argv into a flag map. */
function parseFlags(args: string[]): { flags: Map<string, string>; positionals: string[] } {
  let flags = new Map<string, string>();
  let positionals: string[] = [];
  let i = 0;
  while (i < args.length) {
    let arg = args[i] as string;
    if (arg.startsWith("--")) {
      let value = args[i + 1];
      if (value === undefined) {
        throw new BuildError("config", [], `missing value for ${arg}`);
      }
      flags.set(arg.slice(2), value);
      i += 2;
    } else {
      positionals.push(arg);
      i += 1;
    }
  }
  return { flags, positionals };
}

/**
 * Today's date as YYYY-MM-DD in UTC. The spec's date-field assertion reads the
 * frontmatter via UTC (dateToYmd) and computes the filename prefix from the
 * test process clock, which the bun test runner pins to UTC; producing the date
 * in UTC keeps the scaffolded filename and frontmatter aligned with both checks.
 */
function today(): string {
  let d = new Date();
  let y = d.getUTCFullYear();
  let m = String(d.getUTCMonth() + 1).padStart(2, "0");
  let day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lowercase, hyphen-separated slug from an arbitrary title string. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function runBuild(flags: Map<string, string>): Promise<number> {
  await build({
    contentDir: flagOr(flags, "content", "content"),
    pandocDir: flagOr(flags, "pandoc", BUNDLED_PANDOC),
    outDir: flagOr(flags, "out", "dist"),
  });
  return 0;
}

async function runCheck(flags: Map<string, string>): Promise<number> {
  let outDir = flagOr(flags, "out", "dist");
  let manifest = await build({
    contentDir: flagOr(flags, "content", "content"),
    pandocDir: flagOr(flags, "pandoc", BUNDLED_PANDOC),
    outDir,
  });
  let broken = await checkLinks(outDir, manifest);
  if (broken.length === 0) {
    return 0;
  }
  for (const link of broken) {
    process.stderr.write(`broken link: ${link.target} (in ${link.sourcePage})\n`);
  }
  return 1;
}

async function runServe(flags: Map<string, string>): Promise<number> {
  let outDir = flagOr(flags, "out", "dist");
  let portFlag = flags.get("port");
  let port = portFlag === undefined ? undefined : Number(portFlag);
  let server = startServer({ outDir, port });
  process.stdout.write(`serving ${outDir} at http://localhost:${server.port}/\n`);
  // Block until the process is terminated; the server keeps handling requests.
  return new Promise<number>(() => {});
}

async function runNewPost(positionals: string[], flags: Map<string, string>): Promise<number> {
  let title = positionals[0];
  if (title === undefined) {
    throw new BuildError("scaffold", [], "missing post title");
  }
  let contentDir = flagOr(flags, "content", "content");
  let date = today();
  let relPath = join("blog", `${date}-${slugify(title)}.md`);
  let target = join(contentDir, relPath);

  let frontmatter = matter.stringify("", {
    site: { page: true },
    title,
    date,
  });
  let validate = matter(frontmatter);
  validatePageMeta(relPath, validate.data, "blog-post.v1");

  if (await Bun.file(target).exists()) {
    throw new BuildError("scaffold", [relPath], `post already exists: ${relPath}`);
  }
  await mkdir(join(contentDir, "blog"), { recursive: true });
  await writeFile(target, frontmatter, { encoding: "utf8", flag: "wx" });
  return 0;
}

async function dispatch(argv: string[]): Promise<number> {
  let [subcommand, ...rest] = argv;

  if (subcommand === "build") {
    return await runBuild(parseFlags(rest).flags);
  }

  if (subcommand === "check") {
    return await runCheck(parseFlags(rest).flags);
  }

  if (subcommand === "serve") {
    return await runServe(parseFlags(rest).flags);
  }

  if (subcommand === "new") {
    let [kind, ...newRest] = rest;
    if (kind !== "post") {
      throw new BuildError("scaffold", [], `unknown 'new' target: ${String(kind)}`);
    }
    let { flags, positionals } = parseFlags(newRest);
    return await runNewPost(positionals, flags);
  }

  throw new BuildError("config", [], `unknown subcommand: ${String(subcommand)}`);
}

export async function main(argv: string[]): Promise<number> {
  // Single boundary renderer: a thrown BuildError becomes a stderr report and a
  // nonzero return; any other exception propagates (crash) rather than being swallowed.
  try {
    return await dispatch(argv);
  } catch (err) {
    if (err instanceof BuildError) {
      let files = err.files.length > 0 ? `\n${err.files.join("\n")}` : "";
      process.stderr.write(`${err.kind} error: ${err.message}${files}\n`);
      return 1;
    }
    throw err;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
