import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { type FileSystem, isExists, isMissing } from "./filesystem";

export type PublishResult = "created" | "existing-identical";
export class ImmutableCollisionError extends Error {
  readonly code = "IMMUTABLE_COLLISION";
}

async function staged(
  fs: FileSystem,
  finalPath: string,
  bytes: Uint8Array
): Promise<string> {
  const dir = dirname(finalPath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${basename(finalPath)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    try {
      await handle.close();
    } catch {}
    try {
      await fs.unlink(temp);
    } catch {}
    throw error;
  }
  try {
    await handle.close();
  } catch (error) {
    try {
      await fs.unlink(temp);
    } catch {}
    throw error;
  }
  return temp;
}

export async function publishImmutable(
  fs: FileSystem,
  path: string,
  bytes: Uint8Array
): Promise<PublishResult> {
  let temp: string | undefined;
  try {
    temp = await staged(fs, path, bytes);
    try {
      await fs.link(temp, path);
      await fs.syncDirectory(dirname(path));
      return "created";
    } catch (error) {
      if (!isExists(error)) throw error;
      const stat = await fs.lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new ImmutableCollisionError(
          `Immutable destination is not a regular file: ${path}`
        );
      const prior = await fs.readFile(path);
      if (Buffer.compare(prior, Buffer.from(bytes)) === 0)
        return "existing-identical";
      throw new ImmutableCollisionError(
        `Immutable destination already contains different content: ${path}`
      );
    }
  } finally {
    if (temp)
      try {
        await fs.unlink(temp);
      } catch (error) {
        if (!isMissing(error)) {
          /* best effort */
        }
      }
  }
}

export async function replaceMutable(
  fs: FileSystem,
  path: string,
  bytes: Uint8Array
): Promise<void> {
  let temp: string | undefined;
  try {
    temp = await staged(fs, path, bytes);
    await fs.rename(temp, path);
    temp = undefined;
    await fs.syncDirectory(dirname(path));
  } finally {
    if (temp)
      try {
        await fs.unlink(temp);
      } catch {
        /* best effort */
      }
  }
}
