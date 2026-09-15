import { relative, resolve, sep } from "node:path";
import { exists, type FileSystem } from "./filesystem";
import { ValidationError } from "./identifiers";

export async function ensureProtocolDirectory(
  fs: FileSystem,
  root: string,
  path: string
): Promise<void> {
  const base = resolve(root);
  const target = resolve(path);
  const rel = relative(base, target);
  if (rel.startsWith("..") || rel.split(sep).includes(".."))
    throw new ValidationError("Protocol path escapes mission root");
  let current = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (await exists(fs, current)) {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ValidationError(`Protocol directory is unsafe: ${current}`);
    } else {
      try {
        await fs.mkdir(current, { mode: 0o700 });
      } catch {
        const stat = await fs.lstat(current);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new ValidationError(`Protocol directory is unsafe: ${current}`);
      }
    }
  }
}
