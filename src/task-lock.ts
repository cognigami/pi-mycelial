import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { FileSystem } from "./filesystem";
import { isExists, isMissing } from "./filesystem";
import type { Clock, SessionId, TaskId } from "./identifiers";
import {
  nowIso,
  sessionId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import { formatJson, parseJson } from "./json-codec";
import type { MissionPaths } from "./paths";
import { exactObject, FORMAT_VERSION, type LockOwner } from "./protocol";
import { ensureProtocolDirectory } from "./safe-path";

export interface TaskLockOptions {
  retries: number;
  backoffMs: number;
  isProcessAlive?: (pid: number) => boolean;
}
export interface HeldTaskLock {
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}
export class TaskLock {
  private readonly alive: (pid: number) => boolean;
  constructor(
    readonly fs: FileSystem,
    readonly paths: MissionPaths,
    readonly clock: Clock,
    readonly options: TaskLockOptions
  ) {
    this.alive = options.isProcessAlive ?? processAlive;
  }
  async acquire(
    task: TaskId,
    session: SessionId
  ): Promise<HeldTaskLock | undefined> {
    await ensureProtocolDirectory(
      this.fs,
      this.paths.root,
      this.paths.claims()
    );
    const lockPath = this.paths.lock(task);
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      const token = randomUUID();
      try {
        await this.fs.mkdir(lockPath, { mode: 0o700 });
        const owner: LockOwner = {
          formatVersion: FORMAT_VERSION,
          token,
          pid: process.pid,
          session,
          acquired: nowIso(this.clock),
        };
        const handle = await this.fs.open(
          join(lockPath, "owner.json"),
          "wx",
          0o600
        );
        try {
          await handle.writeFile(Buffer.from(formatJson(owner)));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.fs.syncDirectory(lockPath);
        return new Held(this.fs, lockPath, token);
      } catch (error) {
        if (!isExists(error)) {
          try {
            await this.fs.rm(lockPath, { recursive: true, force: true });
          } catch {}
          throw error;
        }
        if (await this.recoverDead(lockPath)) {
          attempt--;
          continue;
        }
        if (attempt < this.options.retries)
          await sleep(this.options.backoffMs * (attempt + 1));
      }
    }
    return undefined;
  }
  private async recoverDead(lockPath: string): Promise<boolean> {
    let owner: LockOwner;
    try {
      const path = join(lockPath, "owner.json");
      owner = parseJson(
        (await this.fs.readFile(path)).toString("utf8"),
        path,
        validateOwner
      );
    } catch {
      // A creator may still be syncing owner.json. Missing or unreadable owner
      // metadata cannot prove abandonment, so leave the lock intact.
      return false;
    }
    if (this.alive(owner.pid)) return false;
    const quarantine = `${lockPath}.abandoned-${randomUUID()}`;
    try {
      await this.fs.rename(lockPath, quarantine);
    } catch (error) {
      if (isMissing(error)) return true;
      return false;
    }
    await this.fs.rm(quarantine, { recursive: true, force: true });
    return true;
  }
}
class Held implements HeldTaskLock {
  private released = false;
  constructor(
    readonly fs: FileSystem,
    readonly path: string,
    readonly token: string
  ) {}
  async assertOwned() {
    if (this.released) throw new Error("Task lock has been released");
    const ownerPath = join(this.path, "owner.json");
    const owner = parseJson(
      (await this.fs.readFile(ownerPath)).toString("utf8"),
      ownerPath,
      validateOwner
    );
    if (owner.token !== this.token)
      throw new Error("Task lock ownership was lost");
  }
  async release() {
    if (this.released) return;
    await this.assertOwned();
    this.released = true;
    await this.fs.rm(this.path, { recursive: true });
  }
}
function validateOwner(value: unknown): LockOwner {
  const o = exactObject(
    value,
    ["formatVersion", "token", "pid", "session", "acquired"],
    ["formatVersion", "token", "pid", "session", "acquired"],
    "lock owner"
  );
  if (
    o.formatVersion !== 1 ||
    typeof o.token !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(o.token) ||
    !Number.isInteger(o.pid) ||
    (o.pid as number) <= 0
  )
    throw new ValidationError("invalid lock owner");
  return {
    formatVersion: 1,
    token: o.token,
    pid: o.pid as number,
    session: sessionId(o.session),
    acquired: utcTimestamp(o.acquired),
  };
}
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ESRCH"
    );
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
