/**
 * CLI entrypoint (O9). Subcommands:
 *   build [--content DIR] [--pandoc DIR] [--out DIR]
 *   new post "Title" [--content DIR]   — scaffold a valid blog post
 * Exits 0 on success; nonzero with the BuildError report on stderr.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { build } from "./build.ts";
import { BuildError } from "./errors.ts";
import { validatePageMeta } from "./schemas.ts";

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

function requireFlag(flags: Map<string, string>, name: string): string {
  let value = flags.get(name);
  if (value === undefined) {
    throw new BuildError("config", [], `missing required flag --${name}`);
  }
  return value;
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
    contentDir: requireFlag(flags, "content"),
    pandocDir: requireFlag(flags, "pandoc"),
    outDir: requireFlag(flags, "out"),
  });
  return 0;
}

async function runNewPost(positionals: string[], flags: Map<string, string>): Promise<number> {
  let title = positionals[0];
  if (title === undefined) {
    throw new BuildError("scaffold", [], "missing post title");
  }
  let contentDir = requireFlag(flags, "content");
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
