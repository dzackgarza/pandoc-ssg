import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Inventory output independently of the production Bun.Glob scanner. Bun's
 * recursive readdir follows directory symlinks; walking Dirents ourselves
 * preserves the old output tests' rule that links are entries, not subtrees.
 */
export async function listOutputFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const directories = [""];
  for (const directory of directories) {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push(path);
      } else {
        files.push(path);
      }
    }
  }
  return files.sort();
}
