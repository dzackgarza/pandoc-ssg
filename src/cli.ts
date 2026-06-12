/**
 * CLI entrypoint (O9). Subcommands:
 *   build [--content DIR] [--pandoc DIR] [--out DIR]
 *   new post "Title" [--content DIR]   — scaffold a valid blog post
 * Exits 0 on success; nonzero with the BuildError report on stderr.
 */
export async function main(argv: string[]): Promise<number> {
  void argv;
  throw new Error("not implemented");
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
