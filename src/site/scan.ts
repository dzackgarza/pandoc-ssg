/**
 * Recursively list every file under root as sorted POSIX paths relative
 * to root. Bun.Glob owns the recursive walk (dot: true keeps dotfiles,
 * which the build still routes/passes through).
 */
export async function scanFiles(root: string): Promise<string[]> {
  let glob = new Bun.Glob("**/*");
  return (await Array.fromAsync(glob.scan({ cwd: root, dot: true, onlyFiles: true }))).sort();
}

// Keep the content-scanning entry point for existing callers.
export { scanFiles as scanContent };
