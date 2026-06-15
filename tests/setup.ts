// Test preload: point the generator's XDG config at a hermetic fixture before
// any test runs. Macros come from the committed fixture manifest (stable, not the
// live ~/.pandoc set which changes frequently); pandoc_home stays the real
// ~/.pandoc so the tikzcd LaTeX toolchain (filter + template + styles) resolves.
// Subprocess CLI tests inherit XDG_CONFIG_HOME from this process's env.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const xdg = mkdtempSync(join(tmpdir(), "ssg-xdg-"));
const cfgDir = join(xdg, "pandoc-ssg");
mkdirSync(cfgDir, { recursive: true });

const manifest = join(import.meta.dir, "fixtures", "macros", "manifest.txt");
const pandocHome = join(homedir(), ".pandoc");
writeFileSync(
  join(cfgDir, "config.toml"),
  `pandoc_home = "${pandocHome}"\nmathjax_macro_manifest = "${manifest}"\n`,
);

process.env.XDG_CONFIG_HOME = xdg;
