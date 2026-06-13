import { join } from "node:path";
import { BuildError } from "./errors.ts";

// The SSG ships its island sources alongside src/ and pandoc/.
let ISLANDS_SRC = join(import.meta.dir, "..", "islands");

interface ViteApi {
  // biome-ignore lint/suspicious/noExplicitAny: vite's build() shape from an optional peer dep
  viteBuild: (config: any) => Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: the svelte plugin factory from an optional peer dep
  svelte: (opts?: any) => unknown;
}

/**
 * Load vite + the Svelte plugin on demand. They are optional peer deps (like
 * Playwright for O15): a build that uses an island without them installed must
 * fail loudly with an actionable message, and a build that uses no island must
 * never import them. The try/catch is a pure boundary translator (missing
 * optional dep → BuildError), not error suppression.
 */
async function loadVite(): Promise<ViteApi> {
  try {
    let vite = await import("vite");
    let plugin = await import("@sveltejs/vite-plugin-svelte");
    return { viteBuild: vite.build, svelte: plugin.svelte };
  } catch (err) {
    throw new BuildError(
      "config",
      [],
      "interactive island components need 'vite' and '@sveltejs/vite-plugin-svelte' installed (optional peer deps) to bundle",
      err,
    );
  }
}

/**
 * Bundle the SSG-owned Svelte island named `name` (source at
 * `islands/<name>/main.ts`) into a stable, self-contained ES module at
 * `<stagingDir>/assets/islands/<name>.js` (no content hash, so a Lua filter can
 * emit a fixed script src). Returns the dist-relative output path for the
 * manifest's generated entry (O16/O20). vite + svelte are optional peer deps.
 */
export async function buildIsland(name: string, stagingDir: string): Promise<string> {
  let { viteBuild, svelte } = await loadVite();
  let outDir = join(stagingDir, "assets", "islands");
  await viteBuild({
    configFile: false,
    logLevel: "silent",
    plugins: [svelte()],
    build: {
      lib: {
        entry: join(ISLANDS_SRC, name, "main.ts"),
        formats: ["es"],
        fileName: () => `${name}.js`,
      },
      outDir,
      emptyOutDir: false,
      minify: true,
    },
  });
  return `assets/islands/${name}.js`;
}
