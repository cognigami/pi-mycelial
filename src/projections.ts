import { dirname } from "node:path";
import { replaceMutable } from "./atomic-files";
import { formatClaim, parseClaim } from "./claim-codec";
import type { FileSystem } from "./filesystem";
import { isMissing } from "./filesystem";
import type { Clock, TaskId } from "./identifiers";
import {
  messageId,
  nowIso,
  roleId,
  sessionId,
  taskId,
  utcTimestamp,
  ValidationError,
} from "./identifiers";
import { formatJson, parseJson } from "./json-codec";
import type { MissionSnapshot } from "./mission";
import { KeyedMutex } from "./mutex";
import {
  type ClaimRecord,
  exactObject,
  type RosterRecord,
  type TrustedIdentity,
} from "./protocol";
import { ensureProtocolDirectory } from "./safe-path";
import { TaskLock, type TaskLockOptions } from "./task-lock";

export interface ClaimResult {
  outcome:
    | "claimed"
    | "renewed"
    | "taken-over"
    | "released"
    | "contended"
    | "rejected";
  claim?: ClaimRecord;
  owner?: ClaimRecord;
}
export interface ProjectionOptions extends TaskLockOptions {
  minLeaseMs?: number;
  maxLeaseMs?: number;
}
export class ProjectionStore {
  readonly lock: TaskLock;
  constructor(
    readonly fs: FileSystem,
    readonly mission: MissionSnapshot,
    readonly clock: Clock,
    readonly options: ProjectionOptions,
    readonly mutex = new KeyedMutex()
  ) {
    this.lock = new TaskLock(fs, mission.paths, clock, options);
  }

  async claim(
    identity: TrustedIdentity,
    taskInput: string,
    leaseMs: number,
    messageInput?: string
  ): Promise<ClaimResult> {
    if (
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < (this.options.minLeaseMs ?? 1) ||
      leaseMs > (this.options.maxLeaseMs ?? Number.MAX_SAFE_INTEGER)
    )
      throw new ValidationError("Claim lease is outside configured bounds");
    const task = taskId(taskInput);
    const held = await this.lock.acquire(task, identity.session);
    if (!held)
      return { outcome: "contended", owner: await this.readClaim(task) };
    try {
      await held.assertOwned();
      const previous = await this.readClaim(task);
      const now = this.clock.now();
      if (
        previous?.status === "claimed" &&
        Date.parse(previous.expires) > now.getTime() &&
        (previous.agent !== identity.role ||
          previous.session !== identity.session)
      )
        return { outcome: "contended", owner: previous };
      const same =
        previous?.status === "claimed" &&
        previous.agent === identity.role &&
        previous.session === identity.session;
      const takeover =
        previous?.status === "claimed" &&
        Date.parse(previous.expires) <= now.getTime() &&
        !same;
      const created = previous?.created ?? nowIso(this.clock);
      const claim: ClaimRecord = {
        formatVersion: 1,
        task,
        agent: identity.role,
        session: identity.session,
        status: "claimed",
        version: (previous?.version ?? 0) + 1,
        created,
        updated: nowIso(this.clock),
        expires: new Date(now.getTime() + leaseMs).toISOString(),
        ...(messageInput
          ? { message: messageId(messageInput) }
          : previous?.message
            ? { message: previous.message }
            : {}),
        ...(takeover && previous
          ? { observed_prior_version: previous.version }
          : {}),
      };
      await held.assertOwned();
      await ensureProtocolDirectory(
        this.fs,
        this.mission.paths.root,
        this.mission.paths.claims()
      );
      await replaceMutable(
        this.fs,
        this.mission.paths.claim(task),
        Buffer.from(formatClaim(claim))
      );
      return {
        outcome: takeover ? "taken-over" : same ? "renewed" : "claimed",
        claim,
      };
    } finally {
      await held.release();
    }
  }

  async release(
    identity: TrustedIdentity,
    taskInput: string,
    note?: string
  ): Promise<ClaimResult> {
    const task = taskId(taskInput);
    const held = await this.lock.acquire(task, identity.session);
    if (!held)
      return { outcome: "contended", owner: await this.readClaim(task) };
    try {
      await held.assertOwned();
      const previous = await this.readClaim(task);
      if (
        previous?.status !== "claimed" ||
        previous.agent !== identity.role ||
        previous.session !== identity.session
      )
        return { outcome: "rejected", owner: previous };
      const claim: ClaimRecord = {
        ...previous,
        status: "released",
        version: previous.version + 1,
        updated: nowIso(this.clock),
        expires: nowIso(this.clock),
        ...(note === undefined ? {} : { note }),
      };
      await held.assertOwned();
      await replaceMutable(
        this.fs,
        this.mission.paths.claim(task),
        Buffer.from(formatClaim(claim))
      );
      return { outcome: "released", claim };
    } finally {
      await held.release();
    }
  }

  async readClaim(task: TaskId): Promise<ClaimRecord | undefined> {
    const path = this.mission.paths.claim(task);
    try {
      return parseClaim((await this.fs.readFile(path)).toString("utf8"), path);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async heartbeat(
    identity: TrustedIdentity,
    ttlMs: number,
    offline = false
  ): Promise<RosterRecord> {
    return this.mutex.run(
      `roster:${identity.role}:${identity.session}`,
      async () => {
        const now = this.clock.now();
        const record: RosterRecord = {
          formatVersion: 1,
          role: identity.role,
          session: identity.session,
          pid: process.pid,
          heartbeat: now.toISOString(),
          expires: new Date(
            offline ? now.getTime() : now.getTime() + ttlMs
          ).toISOString(),
          status: offline ? "offline" : "online",
        };
        const path = this.mission.paths.roster(identity.role, identity.session);
        await ensureProtocolDirectory(
          this.fs,
          this.mission.paths.root,
          dirname(path)
        );
        await replaceMutable(this.fs, path, Buffer.from(formatJson(record)));
        return record;
      }
    );
  }

  async roster(
    refreshIdentity?: TrustedIdentity,
    ttlMs?: number
  ): Promise<RosterRecord[]> {
    if (refreshIdentity && ttlMs) await this.heartbeat(refreshIdentity, ttlMs);
    let roles: string[];
    try {
      const rosterRoot = this.mission.paths.rosterRoot();
      const stat = await this.fs.lstat(rosterRoot);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ValidationError(`Unsafe roster directory: ${rosterRoot}`);
      roles = await this.fs.readdir(rosterRoot);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const records: RosterRecord[] = [];
    const now = this.clock.now().getTime();
    for (const role of roles.sort()) {
      const parsedRole = roleId(role);
      if (!this.mission.roles.includes(parsedRole))
        throw new ValidationError(`Unknown role in roster projection: ${role}`);
      let names: string[];
      const roleDirectory = dirname(
        this.mission.paths.roster(parsedRole, sessionId("placeholder"))
      );
      try {
        const stat = await this.fs.lstat(roleDirectory);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new ValidationError(
            `Unsafe roster directory: ${roleDirectory}`
          );
        names = await this.fs.readdir(roleDirectory);
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
        const path = this.mission.paths.roster(
          parsedRole,
          sessionId(name.slice(0, -5))
        );
        const record = parseJson(
          (await this.fs.readFile(path)).toString("utf8"),
          path,
          validateRoster
        );
        if (record.status === "online" && Date.parse(record.expires) > now)
          records.push(record);
      }
    }
    return records;
  }
}

function validateRoster(value: unknown): RosterRecord {
  const o = exactObject(
    value,
    [
      "formatVersion",
      "role",
      "session",
      "pid",
      "heartbeat",
      "expires",
      "status",
    ],
    [
      "formatVersion",
      "role",
      "session",
      "pid",
      "heartbeat",
      "expires",
      "status",
    ],
    "roster"
  );
  if (
    o.formatVersion !== 1 ||
    !Number.isInteger(o.pid) ||
    (o.status !== "online" && o.status !== "offline")
  )
    throw new ValidationError("invalid roster record");
  return {
    formatVersion: 1,
    role: roleId(o.role),
    session: sessionId(o.session),
    pid: o.pid as number,
    heartbeat: utcTimestamp(o.heartbeat),
    expires: utcTimestamp(o.expires),
    status: o.status,
  };
}
