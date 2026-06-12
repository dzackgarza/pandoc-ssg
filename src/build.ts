import type { BuildOptions, Manifest } from "./types.ts";

/**
 * Full pipeline (O4–O7): scan → classify → validate → route → collision
 * check → nav validation → render pages via pandoc → copy assets/opaque
 * trees byte-identically → write site-manifest.json into outDir → return
 * the manifest. Any failure throws BuildError and leaves no partial outDir.
 */
export async function build(opts: BuildOptions): Promise<Manifest> {
  void opts;
  throw new Error("not implemented");
}
