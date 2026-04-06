/**
 * Strip a cwd prefix from an absolute path to get a repo-relative path.
 * Used by review agent transforms to convert absolute file paths from
 * agent output into diff-compatible relative paths.
 */
export function toRelativePath(absolutePath: string, cwd?: string): string {
  if (!cwd) return absolutePath;
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath;
}
