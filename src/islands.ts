import { basename, dirname, join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build as viteBuild } from "vite";
import { resolveIslandEntry } from "./island-path.ts";
import type { IslandEntry } from "./types.ts";

/**
 * Bundle a registry-declared island into its stable output path. The registry
 * owns both the entrypoint and dist-relative output path, so built-ins and
 * content-owned islands use the same path contract.
 */
export async function buildIsland(
  island: IslandEntry,
  stagingDir: string,
  roots: { contentDir: string; pandocDir: string },
): Promise<string> {
  let entry = resolveIslandEntry(island, roots);
  let outDir = join(stagingDir, dirname(island.output));
  await viteBuild({
    configFile: false,
    logLevel: "silent",
    plugins: [svelte({})],
    build: {
      lib: {
        entry,
        formats: ["es"],
        fileName: () => basename(island.output),
      },
      outDir,
      emptyOutDir: false,
      minify: true,
    },
  });
  return island.output;
}
