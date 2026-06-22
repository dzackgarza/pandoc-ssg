import { join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build as viteBuild } from "vite";

// The SSG ships its island sources alongside src/ and pandoc/.
let ISLANDS_SRC = join(import.meta.dir, "..", "islands");

/**
 * Bundle the SSG-owned Svelte island named `name` (source at
 * `islands/<name>/main.ts`) into a stable, self-contained ES module at
 * `<stagingDir>/assets/islands/<name>.js` (no content hash, so a Lua filter can
 * emit a fixed script src). Returns the dist-relative output path for the
 * manifest's generated entry (O16/O20).
 */
export async function buildIsland(name: string, stagingDir: string): Promise<string> {
  let outDir = join(stagingDir, "assets", "islands");
  await viteBuild({
    configFile: false,
    logLevel: "silent",
    plugins: [svelte({})],
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
