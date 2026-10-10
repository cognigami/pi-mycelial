import { dirname, isAbsolute, normalize, parse, resolve } from "node:path";
import { type FileSystem, isMissing } from "./filesystem";
import { ValidationError } from "./identifiers";

export function absolutePath(path: unknown): string {
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    normalize(path) !== path ||
    path.includes("\0")
  )
    throw new ValidationError("Expected an absolute normalized path");
  return path;
}

/** Read-only; checks ancestors too, not just the final directory entry. */
export async function safePath(
  fs: FileSystem,
  path: string,
  kind: "file" | "directory",
  optional = false
): Promise<boolean> {
  absolutePath(path);
  const ancestors: string[] = [];
  for (
    let current = dirname(path);
    current !== parse(current).root;
    current = dirname(current)
  )
    ancestors.unshift(current);
  for (const ancestor of ancestors) {
    try {
      const stat = await fs.lstat(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ValidationError(`Unsafe directory: ${ancestor}`);
    } catch (error) {
      if (optional && isMissing(error)) return false;
      throw error;
    }
  }
  try {
    const stat = await fs.lstat(path);
    if (
      stat.isSymbolicLink() ||
      !(kind === "file" ? stat.isFile() : stat.isDirectory())
    )
      throw new ValidationError(`Unsafe ${kind}: ${path}`);
    return true;
  } catch (error) {
    if (optional && isMissing(error)) return false;
    throw error;
  }
}

export async function optionalNames(
  fs: FileSystem,
  path: string
): Promise<string[]> {
  if (!(await safePath(fs, resolve(path), "directory", true))) return [];
  return (await fs.readdir(path)).sort();
}
