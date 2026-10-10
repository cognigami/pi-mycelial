import { join } from "node:path";
import {
  CURRENT_SESSION_VERSION,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import type { FileSystem } from "./filesystem";
import { sessionId, utcTimestamp, ValidationError } from "./identifiers";
import { absolutePath, safePath } from "./rotation-paths";

export interface VerifiedSession {
  path: string;
  header: SessionHeader;
  /** Exact first-line identity, including optional/unknown metadata. */
  headerLine: string;
}

export async function readSessionHeader(
  fs: FileSystem,
  path: string
): Promise<VerifiedSession> {
  await safePath(fs, path, "file");
  const prefix = await fs.readPrefix(path, 64 * 1024);
  const newline = prefix.indexOf(10);
  if (newline < 0)
    throw new ValidationError(`Missing or oversized session header: ${path}`);
  const headerLine = prefix.subarray(0, newline).toString("utf8");
  let header: SessionHeader;
  try {
    header = JSON.parse(headerLine);
  } catch {
    throw new ValidationError(`Invalid session header: ${path}`);
  }
  if (
    header?.type !== "session" ||
    !Number.isInteger(header.version ?? 1) ||
    (header.version ?? 1) < 1 ||
    (header.version ?? 1) > CURRENT_SESSION_VERSION
  )
    throw new ValidationError(`Unsupported session header: ${path}`);
  sessionId(header.id);
  utcTimestamp(header.timestamp);
  absolutePath(header.cwd);
  if (header.parentSession !== undefined) absolutePath(header.parentSession);
  return { path, header, headerLine };
}

export interface DiscoveryReport {
  roots: string[];
  family: VerifiedSession[];
  problems: string[];
}

/** Never follows symlinks or reads transcript bodies. Problems forbid deletion. */
export async function discoverSessionFamily(
  fs: FileSystem,
  roots: readonly string[],
  managed: readonly VerifiedSession[]
): Promise<DiscoveryReport> {
  const candidates = new Map(managed.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const problems: string[] = [];
  const scan = async (path: string): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);
    try {
      const stat = await fs.lstat(path);
      if (stat.isSymbolicLink())
        throw new ValidationError(`Unsafe discovery symlink: ${path}`);
      if (stat.isDirectory()) {
        await safePath(fs, path, "directory");
        for (const name of (await fs.readdir(path)).sort())
          await scan(join(path, name));
      } else if (path.endsWith(".jsonl")) {
        candidates.set(path, await readSessionHeader(fs, path));
      }
    } catch (error) {
      problems.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };
  const uniqueRoots = [...new Set(roots)].sort();
  for (const root of uniqueRoots) {
    try {
      await safePath(fs, root, "directory");
      await scan(root);
    } catch (error) {
      problems.push(`${root}: ${String(error)}`);
    }
  }
  const selected = new Set(managed.map((file) => file.path));
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates.values()) {
      if (
        !selected.has(candidate.path) &&
        candidate.header.parentSession &&
        selected.has(candidate.header.parentSession)
      ) {
        selected.add(candidate.path);
        changed = true;
      }
    }
  }
  // Readable chains that never reach a managed session are outside this family,
  // including orphans and cycles. They grant no deletion permission and do not
  // make the scan incomplete. Unreadable headers/roots still report problems
  // above because they could hide a direct link to a managed session.
  // Descendants first; old managed coordinator last.
  const depth = (file: VerifiedSession): number => {
    let value = 0;
    const chain = new Set<string>();
    for (
      let parent = file.header.parentSession;
      parent && selected.has(parent) && !chain.has(parent);
      parent = candidates.get(parent)?.header.parentSession
    ) {
      chain.add(parent);
      value++;
    }
    return value;
  };
  return {
    roots: uniqueRoots,
    family: [...selected]
      .map((path) => candidates.get(path) as VerifiedSession)
      .sort((a, b) => depth(b) - depth(a) || a.path.localeCompare(b.path)),
    problems,
  };
}
