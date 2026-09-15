import { constants } from "node:fs";
import * as fs from "node:fs/promises";

export interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
export interface FileHandle {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface FileSystem {
  readFile(path: string): Promise<Buffer>;
  readdir(path: string, withTypes?: boolean): Promise<string[]>;
  mkdir(
    path: string,
    options?: { recursive?: boolean; mode?: number }
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean }
  ): Promise<void>;
  rmdir(path: string): Promise<void>;
  lstat(path: string): Promise<FileStat>;
  realpath(path: string): Promise<string>;
  access(path: string): Promise<void>;
  open(path: string, flags: string, mode?: number): Promise<FileHandle>;
  syncDirectory(path: string): Promise<void>;
}

export const nodeFileSystem: FileSystem = {
  readFile: fs.readFile,
  readdir: async (path) => fs.readdir(path),
  mkdir: async (path, options) => {
    await fs.mkdir(path, options);
  },
  rename: fs.rename,
  link: fs.link,
  unlink: fs.unlink,
  rm: fs.rm,
  rmdir: fs.rmdir,
  lstat: fs.lstat,
  realpath: fs.realpath,
  access: async (path) => fs.access(path, constants.F_OK),
  open: async (path, flags, mode) => fs.open(path, flags, mode),
  syncDirectory: async (path) => {
    const handle = await fs.open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

export function isMissing(error: unknown): boolean {
  return isCode(error, "ENOENT");
}
export function isExists(error: unknown): boolean {
  return isCode(error, "EEXIST");
}
export function isCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}
export async function exists(
  fsPort: FileSystem,
  path: string
): Promise<boolean> {
  try {
    await fsPort.access(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
