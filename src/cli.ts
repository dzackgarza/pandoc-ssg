#!/usr/bin/env bun
/**
 * CLI entrypoint. The generator ships no content; it operates on a content
 * directory supplied by the caller (default: ./content in the current repo),
 * the way a content repo depends on this tool. Subcommands:
 *   build [--content DIR] [--pandoc DIR] [--out DIR]   — full pipeline (O9)
 *   new post "Title" [--content DIR]                   — scaffold a blog post (O9)
 *   check [--content DIR] [--pandoc DIR] [--out DIR]   — build, then validate
 *                                                        every page (structure,
 *                                                        no un-migrated markup)
 *                                                        and internal links;
 *                                                        exit 1 if any (O12, O14)
 *   verify [--content DIR] [--pandoc DIR] [--out DIR]  — build, then drive a
 *                                                        headless browser over
 *                                                        every route; fail on
 *                                                        console/page errors,
 *                                                        missing landmarks, or
 *                                                        MathJax errors (O15).
 *                                                        Needs Chromium installed.
 *   serve [--out DIR] [--port N]                        — preview the built tree (O13)
 *   shots [--content DIR] [--pandoc DIR] [--out DIR] [--shots DIR]
 *                                                      — build, serve, and write a
 *                                                        full-page PNG per route into
 *                                                        --shots DIR (default ./shots),
 *                                                        kept out of dist/ (O29).
 *                                                        Needs Chromium installed.
 *   deploy DIR [--content DIR] [--pandoc DIR] [--out DIR] — build, then mirror the
 *                                                        built tree into DIR with
 *                                                        rsync -a --delete (O19)
 * Defaults: --content ./content, --pandoc the bundled design layer, --out ./dist.
 * Exits 0 on success; nonzero with the BuildError report on stderr.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { build } from "./build.ts";
import { loadAppConfig, loadSiteConfig } from "./config.ts";
import { deploySite } from "./deploy.ts";
import { BuildError } from "./errors.ts";
import { pandocConfigStatus, writeKnownGood } from "./pandoc-config.ts";
import { checkLinks, checkServedLinks } from "./site/links.ts";
import { validatePageMeta } from "./content/schemas.ts";
import { startServer } from "./serve.ts";
import { screenshotSite } from "./shots.ts";
import { validateSite } from "./site/validate.ts";
import type { PageScaffold, PageType, SiteConfig } from "./types.ts";
import { type VerifyFinding, verifySite } from "./verify.ts";

/** The design layer (defaults, templates, filters) bundled with the generator. */
let BUNDLED_PANDOC = join(import.meta.dir, "..", "pandoc");

/**
 * Common build options shared by build/check/verify/deploy. The MathJax macro
 * manifest and the pandoc tree are NOT flags — the build reads them from the
 * static XDG config (`~/.config/pandoc-ssg/config.toml`).
 */
function buildOpts(flags: Map<string, string>): {
  contentDir: string;
  pandocDir: string;
  outDir: string;
} {
  return {
    contentDir: flagOr(flags, "content", "content"),
    pandocDir: flagOr(flags, "pandoc", BUNDLED_PANDOC),
    outDir: flagOr(flags, "out", "dist"),
  };
}

/** Flag value, or a fallback when the flag is absent. */
function flagOr(flags: Map<string, string>, name: string, fallback: string): string {
  let value = flags.get(name);
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function portFromFlag(portFlag: string | undefined): number {
  if (portFlag === undefined) {
    return 0;
  }
  return Number(portFlag);
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
  let opts = buildOpts(flags);
  await build(opts);
  await reportPandocConfig(opts.contentDir);
  return 0;
}

/**
 * Stamp the build with the pandoc-config version it floated on, and warn loudly when that
 * version has advanced past what this site was last verified against. Never blocks the build:
 * the warning prompts re-verification + `pandoc-config bump`, it does not pin or fail.
 */
async function reportPandocConfig(contentDir: string): Promise<void> {
  let appConfig = await loadAppConfig();
  let status = await pandocConfigStatus(appConfig.pandocHome, contentDir);
  if (status.version === null) {
    process.stderr.write("pandoc-config: provenance unavailable — pandocHome is not a git checkout\n");
    return;
  }
  process.stdout.write(`pandoc-config: built against ${status.version}\n`);
  if (status.drift !== null && status.drift.aheadBy > 0) {
    process.stderr.write(
      `WARNING: pandoc-config advanced ${status.drift.aheadBy} commit(s) past this site's known-good ` +
        `(${status.knownGood} -> ${status.version}). Re-verify rendering, then bump with ` +
        "`pandoc-ssg pandoc-config bump`.\n",
    );
  }
  if (status.drift !== null && status.drift.aheadBy === -1) {
    process.stderr.write(
      `WARNING: this build's pandoc-config (${status.version}) is not a descendant of the site's ` +
        `known-good (${status.knownGood}); they have diverged. Re-verify and bump.\n`,
    );
  }
}

/** `pandoc-config [print|bump]`: inspect or advance the site's known-good pandoc-config stamp. */
async function runPandocConfig(sub: string | undefined, flags: Map<string, string>): Promise<number> {
  if (sub !== undefined && sub !== "bump" && sub !== "print") {
    return await Promise.reject(
      new BuildError("config", [], `unknown pandoc-config subcommand: ${sub} (expected: print, bump)`),
    );
  }
  let contentDir = flagOr(flags, "content", "content");
  let appConfig = await loadAppConfig();
  let status = await pandocConfigStatus(appConfig.pandocHome, contentDir);
  if (sub === "bump") {
    if (status.version === null) {
      return await Promise.reject(
        new BuildError("config", [], "cannot bump known-good: pandocHome is not a git checkout"),
      );
    }
    let path = await writeKnownGood(contentDir, status.version);
    process.stdout.write(`known-good set to ${status.version} (${path})\n`);
    return 0;
  }
  process.stdout.write(
    `pandoc-config version: ${status.version === null ? "unavailable" : status.version}\n`,
  );
  process.stdout.write(`known-good:            ${status.knownGood === null ? "(unset)" : status.knownGood}\n`);
  if (status.drift !== null && status.drift.aheadBy > 0) {
    process.stdout.write(`drift:                 ahead by ${status.drift.aheadBy} commit(s) — re-verify and bump\n`);
  }
  return 0;
}

async function runCheck(flags: Map<string, string>): Promise<number> {
  let opts = buildOpts(flags);
  let manifest = await build(opts);
  let issues = await validateSite(opts.outDir, manifest);
  issues.forEach((issue) => {
    process.stderr.write(`page issue: ${issue.issue} (in ${issue.page})\n`);
    return true;
  });
  let broken = await checkLinks(opts.outDir);
  broken.forEach((link) => {
    process.stderr.write(`broken link: ${link.target} (in ${link.sourcePage})\n`);
    return true;
  });
  return issues.length + broken.length === 0 ? 0 : 1;
}

/** Write each verification finding to stderr. */
function reportFindings(findings: Awaited<ReturnType<typeof verifySite>>): boolean {
  findings.forEach((f) => {
    process.stderr.write(
      `verify: ${f.issue} on ${f.url}${f.detail === "" ? "" : ` — ${f.detail}`}\n`,
    );
    return true;
  });
  return true;
}

/**
 * Live preflight: serve the built tree over HTTP and validate it against that
 * running server — browser-verify every route AND lychee-check every link
 * (internal against the server, external against the real internet). Both are a
 * single findings list so the deploy gate is one check. Stops the server.
 */
async function verifyOut(
  outDir: string,
  manifest: Awaited<ReturnType<typeof build>>,
): Promise<VerifyFinding[]> {
  let server = await startServer({ outDir });
  let findings: VerifyFinding[] = [];
  try {
    let baseUrl = `http://localhost:${server.port}`;
    let [browserFindings, brokenLinks] = await Promise.all([
      verifySite({ baseUrl, manifest, timeoutMs: 20000 }),
      checkServedLinks(baseUrl, manifest),
    ]);
    let linkFindings: VerifyFinding[] = brokenLinks.map((b) => ({
      url: b.sourcePage,
      issue: "broken-link",
      detail: b.target,
    }));
    findings = [...browserFindings, ...linkFindings];
  } finally {
    server.stop();
  }
  return findings;
}

async function runVerify(flags: Map<string, string>): Promise<number> {
  let opts = buildOpts(flags);
  let manifest = await build(opts);
  let findings = await verifyOut(opts.outDir, manifest);
  reportFindings(findings);
  return findings.length === 0 ? 0 : 1;
}

async function runShots(flags: Map<string, string>): Promise<number> {
  let opts = buildOpts(flags);
  let manifest = await build(opts);
  let shotsDir = flagOr(flags, "shots", "shots");
  let server = await startServer({ outDir: opts.outDir });
  let results: Awaited<ReturnType<typeof screenshotSite>>;
  try {
    results = await screenshotSite({
      baseUrl: `http://localhost:${server.port}`,
      manifest,
      outDir: shotsDir,
      timeoutMs: 20000,
    });
  } finally {
    server.stop();
  }
  process.stdout.write(`wrote ${results.length} screenshot(s) to ${shotsDir}\n`);
  return 0;
}

async function runDeploy(positionals: string[], flags: Map<string, string>): Promise<number> {
  let deployDir = positionals[0];
  if (typeof deployDir === "undefined") {
    throw new BuildError("config", [], "missing deploy target directory: ssg deploy DIR");
  }
  let opts = buildOpts(flags);
  let manifest = await build(opts);
  // Deploy gate: serve the built tree and validate it live — browser-verify
  // every page (undefined macro, unrendered math, missing landmark, broken
  // script) and lychee-check every link (internal + external) over HTTP. Refuse
  // to publish on any finding; broken pages/links must never reach the web root.
  let findings = await verifyOut(opts.outDir, manifest);
  if (findings.length > 0) {
    reportFindings(findings);
    process.stderr.write(`deploy aborted: ${findings.length} verification finding(s)\n`);
    return 1;
  }
  await deploySite(opts.outDir, deployDir);
  process.stdout.write(`deployed ${opts.outDir} -> ${deployDir}\n`);
  return 0;
}

async function runServe(flags: Map<string, string>): Promise<number> {
  let outDir = flagOr(flags, "out", "dist");
  let portFlag = flags.get("port");
  let port = portFromFlag(portFlag);
  let server = await startServer({ outDir, port });
  process.stdout.write(`serving ${outDir} at http://localhost:${server.port}/\n`);
  // Block until the process is terminated; the server keeps handling requests.
  return await new Promise<number>((): boolean => true);
}

interface ScaffoldContext {
  title: string;
  slug: string;
  date: string;
  type: string;
}

async function runNewPage(
  requestedType: string | undefined,
  positionals: string[],
  flags: Map<string, string>,
): Promise<number> {
  if (typeof requestedType === "undefined") {
    throw new BuildError("scaffold", [], "missing page type");
  }
  let title = positionals[0];
  if (typeof title === "undefined") {
    throw new BuildError("scaffold", [], `missing ${requestedType} title`);
  }
  let contentDir = flagOr(flags, "content", "content");
  let pandocDir = flagOr(flags, "pandoc", BUNDLED_PANDOC);
  let config = await loadSiteConfig(contentDir, pandocDir);
  let pageType = scaffoldPageType(config, requestedType);
  let scaffold = requiredScaffold(pageType, requestedType);
  let date = today();
  let ctx: ScaffoldContext = { title, slug: slugify(title), date, type: pageType.name };
  let dir = flagOr(flags, "dir", renderTemplate(scaffold.dir, ctx));
  let relPath = join(dir, renderTemplate(scaffold.filename, ctx));
  let target = join(contentDir, relPath);

  let data: Record<string, unknown> = {
    site: { page: true },
    title,
    ...scaffoldFields(scaffold, ctx),
  };
  let site = data.site as { page: true; type?: string };
  site.type = pageType.name;
  let frontmatter = matter.stringify("", data);
  let validate = matter(frontmatter);
  validatePageMeta(relPath, validate.data, pageType.schema, config.schemas);

  if (await Bun.file(target).exists()) {
    throw new BuildError("scaffold", [relPath], `${pageType.name} already exists: ${relPath}`);
  }
  await mkdir(join(contentDir, dir), { recursive: true });
  await writeFile(target, frontmatter, { encoding: "utf8", flag: "wx" });
  return 0;
}

function scaffoldPageType(config: SiteConfig, requestedType: string): PageType {
  let direct = config.pageTypes[requestedType];
  if (direct) {
    return direct;
  }
  let matched = Object.values(config.pageTypes).find(
    (pageType) => pageType.scaffold?.alias === requestedType,
  );
  if (matched) {
    return matched;
  }
  throw new BuildError("scaffold", [], `unknown 'new' target: ${requestedType}`);
}

function requiredScaffold(pageType: PageType, requestedType: string): PageScaffold {
  if (pageType.scaffold) {
    return pageType.scaffold;
  }
  throw new BuildError("scaffold", [], `page type has no scaffold: ${requestedType}`);
}

function scaffoldFields(
  scaffold: PageScaffold,
  ctx: ScaffoldContext,
): Record<string, unknown> {
  let fields: Record<string, unknown> = {};
  Object.entries(scaffold.fields === undefined ? {} : scaffold.fields).forEach(([name, value]) => {
    fields[name] = renderTemplate(value, ctx);
    return true;
  });
  return fields;
}

function renderTemplate(template: string, ctx: ScaffoldContext): string {
  return template
    .replaceAll("{title}", ctx.title)
    .replaceAll("{slug}", ctx.slug)
    .replaceAll("{date}", ctx.date)
    .replaceAll("{type}", ctx.type);
}

async function dispatch(argv: string[]): Promise<number> {
  let [subcommand, ...rest] = argv;

  if (subcommand === "build") {
    return await runBuild(parseFlags(rest).flags);
  }

  if (subcommand === "check") {
    return await runCheck(parseFlags(rest).flags);
  }

  if (subcommand === "verify") {
    return await runVerify(parseFlags(rest).flags);
  }

  if (subcommand === "serve") {
    return await runServe(parseFlags(rest).flags);
  }

  if (subcommand === "shots") {
    return await runShots(parseFlags(rest).flags);
  }

  if (subcommand === "deploy") {
    let { flags, positionals } = parseFlags(rest);
    return await runDeploy(positionals, flags);
  }

  if (subcommand === "new") {
    let [kind, ...newRest] = rest;
    let { flags, positionals } = parseFlags(newRest);
    return await runNewPage(kind, positionals, flags);
  }

  if (subcommand === "pandoc-config") {
    let [sub, ...pcRest] = rest;
    return await runPandocConfig(sub, parseFlags(pcRest).flags);
  }

  return await Promise.reject(
    new BuildError("config", [], `unknown subcommand: ${String(subcommand)}`),
  );
}

export async function main(argv: string[]): Promise<number> {
  // Single boundary renderer: a thrown BuildError becomes a stderr report and a
  // nonzero return; any other exception propagates (crash) rather than being swallowed.
  let status = 0;
  try {
    status = await dispatch(argv);
  } catch (err) {
    if (err instanceof BuildError) {
      let files = err.files.length > 0 ? `\n${err.files.join("\n")}` : "";
      process.stderr.write(`${err.kind} error: ${err.message}${files}\n`);
      status = 1;
    } else {
      return await Promise.reject(err);
    }
  }
  return status;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
