import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Recursively list every file under contentDir as sorted POSIX paths
 * relative to contentDir.
 */
export async function scanContent(contentDir: string): Promise<string[]> {
  let out: string[] = [];
  await walk(contentDir, "", out);
  return out.sort();
}

async function walk(absDir: string, relPrefix: string, out: string[]): Promise<void> {
  let entries = await readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    let relPath = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(join(absDir, entry.name), relPath, out);
    } else {
      out.push(relPath);
    }
  }
}
