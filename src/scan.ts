/**
 * Recursively list every file under contentDir as sorted POSIX paths relative
 * to contentDir. Bun.Glob owns the recursive walk (dot: true keeps dotfiles,
 * which the build still routes/passes through).
 */
export async function scanContent(contentDir: string): Promise<string[]> {
  let glob = new Bun.Glob("**/*");
  return (await Array.fromAsync(glob.scan({ cwd: contentDir, dot: true, onlyFiles: true }))).sort();
}
