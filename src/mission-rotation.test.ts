import { afterEach, expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "./config";
import { type FileSystem, nodeFileSystem } from "./filesystem";
import {
  missionId,
  roleId,
  systemClock,
  taskId,
  ulidGenerator,
} from "./identifiers";
import { MailboxStore } from "./mailbox-store";
import { loadMission } from "./mission";
import { initializeMission } from "./mission-init";
import {
  DOWNTIME_QUESTION,
  preflightRotation,
  type RotationOperator,
  recoverRotation,
  rotateMission,
} from "./mission-rotation";
import { ProjectionStore } from "./projections";
import { readSessionHeader } from "./session-discovery";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mycelial-rotation-"))
  );
  roots.push(root);
  const cwd = join(root, "repo");
  const defaultSessionRoot = join(root, "default-sessions");
  await mkdir(cwd);
  await mkdir(defaultSessionRoot);
  const initialized = await initializeMission(nodeFileSystem, {
    mission: "mission",
    roles: ["builder", "reviewer"],
    cwd,
    sessionDirectory: join(root, "custom-sessions"),
    config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
  });
  const mission = await loadMission(nodeFileSystem, initialized.directory);
  const input = { missionDirectory: initialized.directory, defaultSessionRoot };
  const old = mission.sessions;
  if (!old) throw new Error("Missing fixture topology");
  const identity = (role: string) => ({
    mission: missionId("mission"),
    role: roleId(role),
    session: old.sessions[role].sessionId,
  });
  const mailbox = new MailboxStore(
    nodeFileSystem,
    mission,
    systemClock,
    ulidGenerator,
    DEFAULT_CONFIG
  );
  return { root, cwd, initialized, mission, input, old, identity, mailbox };
}
const operator = (answers: boolean[] = [true, true]): RotationOperator => ({
  confirm: async () => answers.shift() ?? true,
  report: () => {},
  phase: () => {},
});
async function child(path: string, parent?: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({ type: "session", version: 3, id: ulidGenerator.next(), timestamp: new Date().toISOString(), cwd: dirname(path), ...(parent ? { parentSession: parent } : {}) })}\n${"x".repeat(200_000)}\n`
  );
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (path: string): Promise<void> => {
    const stat = await nodeFileSystem.lstat(path);
    if (stat.isSymbolicLink()) {
      files[path] = `link:${await nodeFileSystem.realpath(path)}`;
      return;
    }
    if (stat.isDirectory()) {
      files[path] = "directory";
      for (const name of await readdir(path)) await walk(join(path, name));
    } else files[path] = (await readFile(path)).toString("base64");
  };
  await walk(root);
  return files;
}

test("dry run is mutation-free, bounded headers, exact direct/transitive/custom-root family, canonical unread and live claims", async () => {
  const f = await fixture();
  const returned = await f.mailbox.send(f.identity("coordinator"), {
    to: "builder",
    body: "returned",
  });
  await f.mailbox.read(f.identity("builder"));
  const pending = await f.mailbox.send(f.identity("coordinator"), {
    to: "builder",
    body: "pending",
  });
  await nodeFileSystem.unlink(
    f.mission.paths.marker(roleId("builder"), pending.message.id)
  );
  const store = new ProjectionStore(nodeFileSystem, f.mission, systemClock, {
    retries: 0,
    backoffMs: 1,
  });
  await store.claim(f.identity("builder"), returned.message.id, 60_000);
  const direct = join(
    f.input.defaultSessionRoot,
    "other-project",
    "child.jsonl"
  );
  const transitive = join(
    dirname(f.old.sessions.reviewer.sessionFile),
    "grandchild.jsonl"
  );
  const unrelated = join(f.input.defaultSessionRoot, "unrelated.jsonl");
  await child(direct, f.old.sessions.builder.sessionFile);
  await child(transitive, direct);
  await child(unrelated);
  // Large/invalid transcript body must not be parsed/opened.
  await writeFile(
    f.old.sessions.coordinator.sessionFile,
    `${await readFile(f.old.sessions.coordinator.sessionFile, "utf8")}${"not json".repeat(100_000)}\n`
  );
  const before = await snapshot(f.root);
  const mutate = async (): Promise<never> => {
    throw new Error("dry-run mutation");
  };
  const fs: FileSystem = {
    ...nodeFileSystem,
    mkdir: mutate,
    open: mutate,
    rename: mutate,
    link: mutate,
    unlink: mutate,
    rm: mutate,
    rmdir: mutate,
    symlink: mutate,
    chmod: mutate,
    syncDirectory: mutate,
    readFile: async (path) => {
      if (path.endsWith(".jsonl")) throw new Error("full transcript read");
      return nodeFileSystem.readFile(path);
    },
  };
  const report = await preflightRotation(fs, f.input);
  expect(report.refusals).toEqual([]);
  expect(report.family.map((file) => file.path).sort()).toEqual(
    [
      ...Object.values(f.old.sessions).map((session) => session.sessionFile),
      direct,
      transitive,
    ].sort()
  );
  expect(report.unread.builder).toEqual([pending.message.id]);
  expect(report.liveClaims).toHaveLength(1);
  expect(await snapshot(f.root)).toEqual(before);
});

test("rotation preserves durable mail/receipts/claims and fresh picker topology with history retention", async () => {
  const f = await fixture();
  const sent = await f.mailbox.send(f.identity("coordinator"), {
    to: "builder",
    body: "work",
    requires_ack: true,
  });
  await f.mailbox.read(f.identity("builder"));
  const receipt = await f.mailbox.acknowledge(f.identity("builder"), {
    message: sent.message.id,
    event: "accepted",
  });
  const pending = await f.mailbox.send(f.identity("coordinator"), {
    to: "builder",
    body: "pending",
  });
  let now = Date.now();
  const clock = { now: () => new Date(now) };
  const projections = new ProjectionStore(nodeFileSystem, f.mission, clock, {
    retries: 0,
    backoffMs: 1,
  });
  await projections.claim(
    f.identity("builder"),
    sent.message.id,
    60_000,
    sent.message.id
  );
  const claimBytes = await readFile(
    f.mission.paths.claim(taskId(sent.message.id))
  );
  const launcher = await readFile(f.initialized.launcherFile);
  await projections.heartbeat(f.identity("builder"), 60_000);
  const durableBefore = await snapshot(f.initialized.directory);
  expect(
    (
      await rotateMission(
        nodeFileSystem,
        { ...f.input, saveHistory: true },
        operator()
      )
    ).state
  ).toBe("committed");
  const durableAfter = await snapshot(f.initialized.directory);
  for (const [path, bytes] of Object.entries(durableBefore)) {
    if (path !== f.initialized.sessionsFile)
      expect(durableAfter[path]).toBe(bytes);
  }
  const mission = await loadMission(nodeFileSystem, f.initialized.directory);
  if (!mission.sessions) throw new Error("Missing fresh topology");
  const fresh = {
    ...f.identity("builder"),
    session: mission.sessions.sessions.builder.sessionId,
  };
  expect(
    (await f.mailbox.read(fresh)).messages.map((message) => message.id)
  ).toEqual([pending.message.id]);
  expect((await f.mailbox.read(fresh)).messages).toEqual([]);
  expect(await f.mailbox.receipts(sent.message.id)).toEqual([receipt]);
  expect(
    (await f.mailbox.reply(fresh, { message: sent.message.id, body: "linked" }))
      .message.thread
  ).toBe(sent.message.id);
  expect(
    (await projections.claim(fresh, sent.message.id, 60_000)).outcome
  ).toBe("contended");
  expect((await projections.release(fresh, sent.message.id)).outcome).toBe(
    "rejected"
  );
  expect(
    await readFile(f.mission.paths.claim(taskId(sent.message.id)))
  ).toEqual(claimBytes);
  now += 60_001;
  expect(
    (await projections.claim(fresh, sent.message.id, 60_000)).outcome
  ).toBe("taken-over");
  expect(await readFile(f.initialized.launcherFile)).toEqual(launcher);
  const listed = await SessionManager.list(
    f.cwd,
    dirname(f.old.sessions.coordinator.sessionFile)
  );
  for (const [role, session] of Object.entries(mission.sessions.sessions)) {
    expect(session.sessionId).not.toBe(f.old.sessions[role].sessionId);
    expect(session.herdrName).not.toBe(f.old.sessions[role].herdrName);
    expect(
      listed.filter((value) => value.id === session.sessionId)
    ).toHaveLength(1);
    const reopened = SessionManager.open(session.sessionFile);
    expect(reopened.buildSessionContext().messages).toEqual([]);
    expect(reopened.getSessionName()).toBe(`mission: ${role}`);
    expect(
      reopened.getEntries().filter((entry) => entry.type === "session_info")
    ).toHaveLength(1);
    expect(reopened.getHeader()?.parentSession).toBe(
      role === "coordinator"
        ? undefined
        : mission.sessions?.sessions.coordinator.sessionFile
    );
  }
  for (const session of Object.values(f.old.sessions))
    expect(await nodeFileSystem.lstat(session.sessionFile)).toBeDefined();
});

test("default cleanup deletes exactly the verified old family, descendants first, and never unrelated sessions", async () => {
  const f = await fixture();
  const direct = join(f.input.defaultSessionRoot, "child.jsonl");
  const grandchild = join(
    dirname(f.old.sessions.builder.sessionFile),
    "grandchild.jsonl"
  );
  const unrelated = join(f.input.defaultSessionRoot, "unrelated.jsonl");
  await child(direct, f.old.sessions.builder.sessionFile);
  await child(grandchild, direct);
  await child(unrelated);
  const deleted: string[] = [];
  const fs = {
    ...nodeFileSystem,
    unlink: async (path: string) => {
      if (path.endsWith(".jsonl")) {
        const current = await loadMission(
          nodeFileSystem,
          f.initialized.directory
        );
        expect(current.sessions?.sessions.coordinator.sessionId).not.toBe(
          f.old.sessions.coordinator.sessionId
        );
        deleted.push(path);
      }
      await nodeFileSystem.unlink(path);
    },
  };
  expect((await rotateMission(fs, f.input, operator())).state).toBe(
    "committed"
  );
  expect(deleted.indexOf(grandchild)).toBeLessThan(deleted.indexOf(direct));
  expect(deleted.indexOf(direct)).toBeLessThan(
    deleted.indexOf(f.old.sessions.builder.sessionFile)
  );
  expect(deleted.indexOf(f.old.sessions.builder.sessionFile)).toBeLessThan(
    deleted.indexOf(f.old.sessions.coordinator.sessionFile)
  );
  expect(deleted.sort()).toEqual(
    [
      direct,
      grandchild,
      ...Object.values(f.old.sessions).map((value) => value.sessionFile),
    ].sort()
  );
  expect(await readSessionHeader(nodeFileSystem, unrelated)).toBeDefined();
  const fresh = (await loadMission(nodeFileSystem, f.initialized.directory))
    .sessions;
  if (!fresh) throw new Error("Missing fresh topology");
  for (const session of Object.values(fresh.sessions))
    expect(
      await readSessionHeader(nodeFileSystem, session.sessionFile)
    ).toBeDefined();
});

test("unsafe/missing sessions, corrupt cursors, unsupported shape, discovery failures refuse; retention is the incomplete-scan escape hatch", async () => {
  const f = await fixture();
  await writeFile(join(f.input.defaultSessionRoot, "bad.jsonl"), "bad\n");
  expect(
    (await preflightRotation(nodeFileSystem, f.input)).refusals.join()
  ).toContain("Incomplete");
  expect(
    (await preflightRotation(nodeFileSystem, { ...f.input, saveHistory: true }))
      .refusals
  ).toEqual([]);
  await nodeFileSystem.unlink(f.old.sessions.builder.sessionFile);
  await symlink(
    f.old.sessions.reviewer.sessionFile,
    f.old.sessions.builder.sessionFile
  );
  expect(
    (
      await preflightRotation(nodeFileSystem, { ...f.input, saveHistory: true })
    ).refusals.join()
  ).toContain("Unsafe");
  const before = await readFile(f.initialized.sessionsFile);
  expect((await rotateMission(nodeFileSystem, f.input, operator())).state).toBe(
    "rolled-back"
  );
  expect(await readFile(f.initialized.sessionsFile)).toEqual(before);
});

test("downtime is explicit, cancellation has no session preparation, real invocation rechecks and exclusive operations never establish downtime", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  const questions: string[] = [];
  expect(
    (
      await rotateMission(nodeFileSystem, f.input, {
        ...operator(),
        confirm: async (question) => {
          questions.push(question);
          return false;
        },
      })
    ).state
  ).toBe("cancelled");
  expect(questions).toEqual([DOWNTIME_QUESTION]);
  expect(await snapshot(f.root)).toEqual(before);
  expect((await preflightRotation(nodeFileSystem, f.input)).refusals).toEqual(
    []
  );
  await nodeFileSystem.unlink(f.old.sessions.builder.sessionFile);
  expect((await rotateMission(nodeFileSystem, f.input, operator())).state).toBe(
    "rolled-back"
  );
  await mkdir(join(f.initialized.directory, ".session-rotation"));
  expect(
    (await preflightRotation(nodeFileSystem, f.input)).refusals.join()
  ).toContain("already exists");
  await expect(
    rotateMission(nodeFileSystem, f.input, operator())
  ).rejects.toMatchObject({ code: "EEXIST" });
});

test.each([
  "session-link-sync",
  "cursor-link-sync",
  "manifest-rename-sync",
  "manifest-readback",
  "delete",
])(
  "adversarial %s publication boundaries classify active tree and support explicit recovery",
  async (fault) => {
    const f = await fixture();
    const original = await readFile(f.initialized.sessionsFile);
    let fired = false;
    let lastLinked = "";
    let manifestRenamed = false;
    const fs: FileSystem = {
      ...nodeFileSystem,
      link: async (from, to) => {
        await nodeFileSystem.link(from, to);
        lastLinked = to;
      },
      rename: async (from, to) => {
        await nodeFileSystem.rename(from, to);
        if (to === f.initialized.sessionsFile) manifestRenamed = true;
      },
      syncDirectory: async (path) => {
        if (
          !fired &&
          ((fault === "session-link-sync" && lastLinked.endsWith(".jsonl")) ||
            (fault === "cursor-link-sync" &&
              lastLinked.includes("/cursors/")) ||
            (fault === "manifest-rename-sync" &&
              manifestRenamed &&
              path === f.initialized.directory))
        ) {
          fired = true;
          throw new Error(`injected ${fault}`);
        }
        await nodeFileSystem.syncDirectory(path);
      },
      readFile: async (path) => {
        if (
          !fired &&
          fault === "manifest-readback" &&
          manifestRenamed &&
          path === f.initialized.sessionsFile
        ) {
          fired = true;
          throw new Error("readback");
        }
        return nodeFileSystem.readFile(path);
      },
      unlink: async (path) => {
        if (
          !fired &&
          fault === "delete" &&
          Object.values(f.old.sessions).some(
            (value) => value.sessionFile === path
          )
        ) {
          fired = true;
          throw new Error("delete");
        }
        await nodeFileSystem.unlink(path);
      },
    };
    const result = await rotateMission(fs, f.input, operator());
    expect(fired).toBeTrue();
    if (fault.startsWith("session") || fault.startsWith("cursor")) {
      expect(result.state).toBe("rolled-back");
      expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
      expect(
        (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
          (name) => name.endsWith(".jsonl")
        )
      ).toHaveLength(3);
    } else {
      expect(result.state).toBe("recovery-required");
      expect(await readFile(f.initialized.sessionsFile)).not.toEqual(original);
      const active = (
        await loadMission(nodeFileSystem, f.initialized.directory)
      ).sessions;
      if (!active) throw new Error("Missing active topology");
      expect(
        (await recoverRotation(nodeFileSystem, f.input, operator())).state
      ).toBe("committed");
      expect(
        (await loadMission(nodeFileSystem, f.initialized.directory)).sessions
      ).toEqual(active);
    }
  }
);

test.each([
  "worker-link",
  "session-validation",
  "cursor-write",
  "cursor-readback",
  "recovery-rename",
  "recovery-sync",
  "manifest-before-rename",
  "control-drift",
  "cancel-preparation",
])(
  "precommit fault %s preserves old launch path and rolls back owned artifacts",
  async (fault) => {
    const f = await fixture();
    const oldManifest = await readFile(f.initialized.sessionsFile);
    let fired = false;
    const abort = new AbortController();
    const fs: FileSystem = {
      ...nodeFileSystem,
      link: async (from, to) => {
        if (
          !fired &&
          fault === "worker-link" &&
          to.endsWith(".jsonl") &&
          (await readFile(from, "utf8"))
            .split("\n")[0]
            ?.includes('"parentSession"')
        ) {
          fired = true;
          throw new Error(fault);
        }
        await nodeFileSystem.link(from, to);
      },
      readFile: async (path) => {
        if (
          !fired &&
          ((fault === "session-validation" &&
            path.endsWith(".jsonl") &&
            !Object.values(f.old.sessions).some(
              (value) => value.sessionFile === path
            )) ||
            (fault === "cursor-readback" &&
              path.includes("/cursors/") &&
              path.endsWith(".json") &&
              !path.split("/").pop()?.startsWith(".")))
        ) {
          fired = true;
          throw new Error(fault);
        }
        return nodeFileSystem.readFile(path);
      },
      open: async (path, flags, mode) => {
        const handle = await nodeFileSystem.open(path, flags, mode);
        if (
          !fired &&
          fault === "cursor-write" &&
          path.includes("/cursors/") &&
          flags === "wx"
        ) {
          return {
            ...handle,
            close: handle.close.bind(handle),
            sync: handle.sync.bind(handle),
            writeFile: async () => {
              fired = true;
              throw new Error(fault);
            },
          };
        }
        return handle;
      },
      rename: async (from, to) => {
        if (
          !fired &&
          ((fault === "recovery-rename" && to.endsWith("/recovery.json")) ||
            (fault === "manifest-before-rename" &&
              to === f.initialized.sessionsFile))
        ) {
          fired = true;
          throw new Error(fault);
        }
        await nodeFileSystem.rename(from, to);
      },
      syncDirectory: async (path) => {
        if (
          !fired &&
          fault === "recovery-sync" &&
          path.endsWith("/.session-rotation") &&
          (await nodeFileSystem.access(join(path, "recovery.json")).then(
            () => true,
            () => false
          ))
        ) {
          fired = true;
          throw new Error(fault);
        }
        await nodeFileSystem.syncDirectory(path);
      },
    };
    const op = {
      ...operator(),
      signal: abort.signal,
      phase: (phase: string) => {
        if (
          !fired &&
          phase === "prepare sessions and cursors" &&
          fault === "control-drift"
        ) {
          fired = true;
          void writeFile(
            f.initialized.agentsFile,
            '["coordinator","builder","reviewer"]'
          );
        }
        if (
          !fired &&
          phase === "prepare sessions and cursors" &&
          fault === "cancel-preparation"
        ) {
          fired = true;
          abort.abort(new Error(fault));
        }
      },
    };
    const result = await rotateMission(fs, f.input, op);
    expect(fired).toBeTrue();
    expect(result.state).toBe("rolled-back");
    expect(await readFile(f.initialized.sessionsFile)).toEqual(oldManifest);
    expect(
      (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
        (name) => name.endsWith(".jsonl")
      )
    ).toHaveLength(3);
    expect(await readdir(f.initialized.directory)).not.toContain(
      ".session-rotation"
    );
  }
);

test.each(
  ["session", "cursor", "recovery"].flatMap((target) =>
    ["open", "write", "sync", "close"].map((boundary) => ({ target, boundary }))
  )
)(
  "exclusive stage $target/$boundary failures leave old launch path usable",
  async ({ target, boundary }) => {
    const f = await fixture();
    const original = await readFile(f.initialized.sessionsFile);
    let fired = false;
    const fs = {
      ...nodeFileSystem,
      open: async (path: string, flags: string, mode?: number) => {
        const selected =
          flags === "wx" &&
          (target === "session"
            ? path.includes(".jsonl.")
            : target === "cursor"
              ? path.includes("/cursors/")
              : path.includes(".recovery.json."));
        if (!fired && selected && boundary === "open") {
          fired = true;
          throw new Error("stage open");
        }
        const handle = await nodeFileSystem.open(path, flags, mode);
        return {
          writeFile: async (bytes: Uint8Array) => {
            if (!fired && selected && boundary === "write") {
              fired = true;
              throw new Error("stage write");
            }
            await handle.writeFile(bytes);
          },
          sync: async () => {
            if (!fired && selected && boundary === "sync") {
              fired = true;
              throw new Error("stage sync");
            }
            await handle.sync();
          },
          close: async () => {
            await handle.close();
            if (!fired && selected && boundary === "close") {
              fired = true;
              throw new Error("stage close");
            }
          },
        };
      },
    };
    const result = await rotateMission(fs, f.input, operator());
    expect(fired).toBeTrue();
    expect(result.state).toBe("rolled-back");
    expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
    expect(
      (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
        (name) => name.endsWith(".jsonl")
      )
    ).toHaveLength(3);
    expect(await readdir(f.initialized.directory)).not.toContain(
      ".session-rotation"
    );
  }
);

test("matching-byte collision is never invocation-owned, even during rollback", async () => {
  const f = await fixture();
  let collision: string | undefined;
  let collisionBytes: Buffer | undefined;
  const fs = {
    ...nodeFileSystem,
    link: async (from: string, to: string) => {
      if (!collision && to.endsWith(".jsonl")) {
        collision = to;
        collisionBytes = await readFile(from);
        await writeFile(to, collisionBytes, { flag: "wx" });
      }
      await nodeFileSystem.link(from, to);
    },
  };
  const original = await readFile(f.initialized.sessionsFile);
  const result = await rotateMission(fs, f.input, operator());
  expect(result.state).toBe("rolled-back");
  if (!collision || !collisionBytes)
    throw new Error("Collision was not injected");
  expect((await readFile(collision)).toString("base64")).toEqual(
    collisionBytes.toString("base64")
  );
  expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
});

test("ambiguous manifest preserves both trees and requires manual intervention", async () => {
  const f = await fixture();
  const fs = {
    ...nodeFileSystem,
    rename: async (from: string, to: string) => {
      await nodeFileSystem.rename(from, to);
      if (to === f.initialized.sessionsFile) {
        await writeFile(to, "unexpected");
        throw new Error("ambiguous publication");
      }
    },
  };
  const result = await rotateMission(fs, f.input, operator());
  expect(result.state).toBe("recovery-required");
  expect(result.error).toContain("manifest=unknown");
  expect(
    (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
      (name) => name.endsWith(".jsonl")
    )
  ).toHaveLength(6);
  await expect(
    recoverRotation(nodeFileSystem, f.input, operator())
  ).rejects.toThrow();
});

test("old-active rollback residue recovers only owned artifacts, not another tree", async () => {
  const f = await fixture();
  let published = false;
  let residue: string | undefined;
  const fs = {
    ...nodeFileSystem,
    link: async (from: string, to: string) => {
      await nodeFileSystem.link(from, to);
      if (!published && to.endsWith(".jsonl")) {
        published = true;
        residue = to;
        throw new Error("link published then threw");
      }
    },
    unlink: async (path: string) => {
      if (path === residue) throw new Error("cleanup denied");
      await nodeFileSystem.unlink(path);
    },
  };
  const result = await rotateMission(fs, f.input, operator());
  expect(result.state).toBe("recovery-required");
  if (!residue) throw new Error("Residue was not injected");
  expect(result.remaining).toContain(residue);
  expect(
    (await recoverRotation(nodeFileSystem, f.input, operator())).state
  ).toBe("rolled-back");
  expect(
    (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
      (name) => name.endsWith(".jsonl")
    )
  ).toHaveLength(3);
});

test("changed descendant identity blocks cleanup and retains its parents", async () => {
  const f = await fixture();
  const direct = join(f.input.defaultSessionRoot, "child.jsonl");
  await child(direct, f.old.sessions.builder.sessionFile);
  let changed = false;
  const fs = {
    ...nodeFileSystem,
    rename: async (from: string, to: string) => {
      await nodeFileSystem.rename(from, to);
      if (to === f.initialized.sessionsFile) {
        changed = true;
        await child(direct);
      }
    },
  };
  const result = await rotateMission(fs, f.input, operator());
  expect(changed).toBeTrue();
  expect(result.state).toBe("recovery-required");
  expect(result.remaining).toContain(direct);
  for (const session of Object.values(f.old.sessions))
    expect(
      await readSessionHeader(nodeFileSystem, session.sessionFile)
    ).toBeDefined();
  expect(
    (await recoverRotation(nodeFileSystem, f.input, operator())).state
  ).toBe("recovery-required");
});

test("corrupt/mismatched cursors and unsupported mission shapes fail core preflight even with retention", async () => {
  const f = await fixture();
  await f.mailbox.initializeCursor(f.identity("builder"), []);
  const cursorPath = f.mission.paths.cursor(
    roleId("builder"),
    f.old.sessions.builder.sessionId
  );
  await writeFile(
    cursorPath,
    JSON.stringify({
      formatVersion: 1,
      role: "reviewer",
      session: f.old.sessions.builder.sessionId,
      returned: [],
      updated: new Date().toISOString(),
    })
  );
  expect(
    (
      await preflightRotation(nodeFileSystem, { ...f.input, saveHistory: true })
    ).refusals.join()
  ).toContain("identity does not match");
  await nodeFileSystem.unlink(cursorPath);
  const manifestBytes = await readFile(f.initialized.sessionsFile);
  await nodeFileSystem.unlink(f.initialized.sessionsFile);
  expect(
    (await preflightRotation(nodeFileSystem, f.input)).refusals.join()
  ).toContain("managed sessions.json");
  await writeFile(f.initialized.sessionsFile, manifestBytes);
  const peer = await initializeMission(nodeFileSystem, {
    mission: "peer",
    roles: ["builder"],
    includeCoordinator: false,
    cwd: f.cwd,
    sessionDirectory: join(f.root, "peer-sessions"),
    config: { ...DEFAULT_CONFIG, missionRoot: join(f.root, "missions") },
  });
  expect(
    (
      await preflightRotation(nodeFileSystem, {
        ...f.input,
        missionDirectory: peer.directory,
        saveHistory: true,
      })
    ).refusals.join()
  ).toContain("Coordinator-free");
});

test("readable orphaned/cyclic sessions do not block another mission or enter its deletion set", async () => {
  const f = await fixture();
  const scotty = join(f.input.defaultSessionRoot, "scotty");
  const orphan = join(scotty, "orphan.jsonl");
  // Even sharing a managed session directory does not establish membership.
  const orphanChild = join(
    dirname(f.old.sessions.coordinator.sessionFile),
    "orphan-child.jsonl"
  );
  const cycleA = join(scotty, "cycle-a.jsonl");
  const cycleB = join(scotty, "cycle-b.jsonl");
  await child(orphan, join(scotty, "missing-parent.jsonl"));
  await child(orphanChild, orphan);
  await child(cycleA, cycleB);
  await child(cycleB, cycleA);
  // Conversely, a different project directory cannot exclude a real child.
  const direct = join(scotty, "mission-child.jsonl");
  const transitive = join(
    f.input.defaultSessionRoot,
    "elsewhere",
    "child.jsonl"
  );
  await child(direct, f.old.sessions.builder.sessionFile);
  await child(transitive, direct);
  const untouched = new Map(
    await Promise.all(
      [orphan, orphanChild, cycleA, cycleB].map(
        async (path) => [path, await readFile(path)] as const
      )
    )
  );
  const expected = [
    ...Object.values(f.old.sessions).map((session) => session.sessionFile),
    direct,
    transitive,
  ].sort();
  const before = await snapshot(f.root);
  const report = await preflightRotation(nodeFileSystem, f.input);
  expect(report.discoveryProblems).toEqual([]);
  expect(report.refusals).toEqual([]);
  expect(report.family.map((file) => file.path).sort()).toEqual(expected);
  expect(await snapshot(f.root)).toEqual(before);
  const deleted: string[] = [];
  const fs: FileSystem = {
    ...nodeFileSystem,
    unlink: async (path) => {
      if (path.endsWith(".jsonl")) deleted.push(path);
      await nodeFileSystem.unlink(path);
    },
  };
  expect((await rotateMission(fs, f.input, operator())).state).toBe(
    "committed"
  );
  expect(deleted.sort()).toEqual(expected);
  for (const [path, bytes] of untouched)
    expect(await readFile(path)).toEqual(bytes);
});

test("incomplete roots, unreadable candidates and symlinked scan directories still forbid deletion", async () => {
  const f = await fixture();
  await symlink(
    dirname(f.old.sessions.coordinator.sessionFile),
    join(f.input.defaultSessionRoot, "linked-directory")
  );
  const unreadable = join(f.input.defaultSessionRoot, "unreadable.jsonl");
  await child(unreadable);
  const fs = {
    ...nodeFileSystem,
    readPrefix: async (path: string, size: number) => {
      if (path === unreadable) throw new Error("unreadable candidate");
      return nodeFileSystem.readPrefix(path, size);
    },
  };
  const report = await preflightRotation(fs, f.input);
  expect(report.discoveryProblems.join()).toContain("symlink");
  expect(report.discoveryProblems.join()).toContain("unreadable candidate");
  expect(report.family).toHaveLength(3);
  expect(report.refusals.join()).toContain("Incomplete");
  expect(
    (await preflightRotation(fs, { ...f.input, saveHistory: true })).refusals
  ).toEqual([]);
  expect(
    (
      await preflightRotation(nodeFileSystem, {
        ...f.input,
        defaultSessionRoot: join(f.root, "missing-root"),
      })
    ).refusals.join()
  ).toContain("Incomplete");
});

test("destructive cancellation leaves no preparation and partial cleanup recovery tolerates missing old descendants", async () => {
  const f = await fixture();
  const before = await snapshot(f.root);
  expect(
    (await rotateMission(nodeFileSystem, f.input, operator([true, false])))
      .state
  ).toBe("cancelled");
  expect(await snapshot(f.root)).toEqual(before);
  const direct = join(f.input.defaultSessionRoot, "child.jsonl");
  await child(direct, f.old.sessions.builder.sessionFile);
  let count = 0;
  const fs = {
    ...nodeFileSystem,
    unlink: async (path: string) => {
      if (path.endsWith(".jsonl") && ++count === 2)
        throw new Error("partial cleanup");
      await nodeFileSystem.unlink(path);
    },
  };
  const result = await rotateMission(fs, f.input, operator());
  expect(result.state).toBe("recovery-required");
  await expect(nodeFileSystem.lstat(direct)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(
    (await recoverRotation(nodeFileSystem, f.input, operator())).state
  ).toBe("committed");
});

test("all external participant directories are discovered and replacements use the old coordinator directory", async () => {
  const f = await fixture();
  const directory = join(f.root, "other-worker-directory");
  await mkdir(directory);
  const path = join(directory, "reviewer.jsonl");
  await nodeFileSystem.rename(f.old.sessions.reviewer.sessionFile, path);
  f.old.sessions.reviewer.sessionFile = path;
  await writeFile(f.initialized.sessionsFile, JSON.stringify(f.old));
  const descendant = join(directory, "child.jsonl");
  await child(descendant, path);
  const report = await preflightRotation(nodeFileSystem, f.input);
  expect(report.refusals).toEqual([]);
  expect(report.roots).toContain(directory);
  expect(report.family.map((file) => file.path)).toContain(descendant);
  expect((await rotateMission(nodeFileSystem, f.input, operator())).state).toBe(
    "committed"
  );
  const active = (await loadMission(nodeFileSystem, f.initialized.directory))
    .sessions;
  if (!active) throw new Error("Missing active manifest");
  for (const session of Object.values(active.sessions))
    expect(dirname(session.sessionFile)).toBe(
      dirname(f.old.sessions.coordinator.sessionFile)
    );
  expect(await readdir(directory)).toEqual([]);
});

test("unlink-success/directory-sync-failure reports only remaining files and recovery never replaces the committed tree", async () => {
  const f = await fixture();
  let deleted: string | undefined;
  let fired = false;
  const fs = {
    ...nodeFileSystem,
    unlink: async (path: string) => {
      await nodeFileSystem.unlink(path);
      if (path.endsWith(".jsonl")) deleted = path;
    },
    syncDirectory: async (path: string) => {
      if (deleted && !fired && path === dirname(deleted)) {
        fired = true;
        throw new Error("cleanup sync");
      }
      await nodeFileSystem.syncDirectory(path);
    },
  };
  const result = await rotateMission(fs, f.input, operator());
  expect(fired).toBeTrue();
  expect(result.state).toBe("recovery-required");
  expect(result.remaining).not.toContain(deleted);
  const active = await readFile(f.initialized.sessionsFile);
  expect(
    (await recoverRotation(nodeFileSystem, f.input, operator())).state
  ).toBe("committed");
  expect(await readFile(f.initialized.sessionsFile)).toEqual(active);
});

test.each(["session", "cursor"])(
  "committed %s stage-unlink failures retain exact ownership evidence and recover without deleting active finals",
  async (target) => {
    const f = await fixture();
    const stages = new Set<string>();
    const fs = {
      ...nodeFileSystem,
      unlink: async (path: string) => {
        const selected =
          path.endsWith(".tmp") &&
          (target === "session"
            ? path.includes(".jsonl.")
            : path.includes("/cursors/"));
        if (selected) {
          stages.add(path);
          throw new Error("stage cleanup denied");
        }
        await nodeFileSystem.unlink(path);
      },
    };
    const result = await rotateMission(fs, f.input, operator());
    expect(result.state).toBe("recovery-required");
    expect(result.remaining.sort()).toEqual([...stages].sort());
    for (const session of Object.values(f.old.sessions))
      expect(
        await readSessionHeader(nodeFileSystem, session.sessionFile)
      ).toBeDefined();
    const active = (await loadMission(nodeFileSystem, f.initialized.directory))
      .sessions;
    if (!active) throw new Error("Missing committed topology");
    const activeManifest = await readFile(f.initialized.sessionsFile);
    const activeBytes = new Map<string, Buffer>();
    for (const [role, session] of Object.entries(active.sessions)) {
      activeBytes.set(session.sessionFile, await readFile(session.sessionFile));
      const cursor = f.mission.paths.cursor(roleId(role), session.sessionId);
      activeBytes.set(cursor, await readFile(cursor));
    }
    const record = JSON.parse(
      await readFile(
        join(f.initialized.directory, ".session-rotation", "recovery.json"),
        "utf8"
      )
    );
    for (const stage of stages)
      expect(
        record.artifacts.some(
          (artifact: { path: string }) => artifact.path === stage
        )
      ).toBeTrue();
    expect(
      record.artifacts.some(
        (artifact: { path: string }) =>
          artifact.path === f.initialized.sessionsFile
      )
    ).toBeFalse();
    expect(
      (await recoverRotation(nodeFileSystem, f.input, operator())).state
    ).toBe("committed");
    expect(await readFile(f.initialized.sessionsFile)).toEqual(activeManifest);
    for (const [path, bytes] of activeBytes)
      expect((await readFile(path)).toString("base64")).toBe(
        bytes.toString("base64")
      );
    for (const stage of stages)
      await expect(nodeFileSystem.lstat(stage)).rejects.toMatchObject({
        code: "ENOENT",
      });
    for (const session of Object.values(f.old.sessions))
      await expect(
        nodeFileSystem.lstat(session.sessionFile)
      ).rejects.toMatchObject({ code: "ENOENT" });
  }
);

test.each(["rename-failure", "interrupted-before-rename"])(
  "old-active manifest stage %s is recorded and explicitly recoverable, never owning sessions.json",
  async (failure) => {
    const f = await fixture();
    const original = await readFile(f.initialized.sessionsFile);
    let stage: string | undefined;
    let interrupted = false;
    const fs = {
      ...nodeFileSystem,
      rename: async (from: string, to: string) => {
        if (to === f.initialized.sessionsFile) {
          stage = from;
          interrupted = true;
          throw new Error(failure);
        }
        await nodeFileSystem.rename(from, to);
      },
      unlink: async (path: string) => {
        if (
          path === stage ||
          (interrupted && failure === "interrupted-before-rename")
        )
          throw new Error("interrupted cleanup");
        await nodeFileSystem.unlink(path);
      },
    };
    const result = await rotateMission(fs, f.input, operator());
    if (!stage) throw new Error("Manifest staging fault did not fire");
    expect(result.state).toBe("recovery-required");
    expect(result.remaining).toContain(stage);
    if (failure === "rename-failure") expect(result.remaining).toEqual([stage]);
    expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
    const record = JSON.parse(
      await readFile(
        join(f.initialized.directory, ".session-rotation", "recovery.json"),
        "utf8"
      )
    );
    const expectedResidue: string[] = [];
    for (const artifact of [
      ...record.artifacts,
      ...record.directories,
    ] as Array<{ path: string }>) {
      if (
        await nodeFileSystem.lstat(artifact.path).then(
          () => true,
          () => false
        )
      )
        expectedResidue.push(artifact.path);
    }
    expect([...result.remaining].sort()).toEqual(
      [...new Set(expectedResidue)].sort()
    );
    expect(
      record.artifacts.some(
        (artifact: { path: string }) => artifact.path === stage
      )
    ).toBeTrue();
    expect(
      record.artifacts.some(
        (artifact: { path: string }) =>
          artifact.path === f.initialized.sessionsFile
      )
    ).toBeFalse();
    expect(
      (await recoverRotation(nodeFileSystem, f.input, operator())).state
    ).toBe("rolled-back");
    expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
    await expect(nodeFileSystem.lstat(stage)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
        (name) => name.endsWith(".jsonl")
      )
    ).toHaveLength(3);
  }
);

test("cancellation after manifest stage sync refuses the actual rename and never deletes old history", async () => {
  const f = await fixture();
  const original = await readFile(f.initialized.sessionsFile);
  const abort = new AbortController();
  let synced = false;
  let renamed = false;
  const oldUnlinks: string[] = [];
  const fs = {
    ...nodeFileSystem,
    open: async (path: string, flags: string, mode?: number) => {
      const handle = await nodeFileSystem.open(path, flags, mode);
      if (flags !== "wx" || !path.includes("/.sessions.json.")) return handle;
      return {
        writeFile: handle.writeFile.bind(handle),
        close: handle.close.bind(handle),
        sync: async () => {
          await handle.sync();
          synced = true;
          abort.abort(new Error("cancelled during manifest staging"));
        },
      };
    },
    rename: async (from: string, to: string) => {
      if (to === f.initialized.sessionsFile) renamed = true;
      await nodeFileSystem.rename(from, to);
    },
    unlink: async (path: string) => {
      if (
        Object.values(f.old.sessions).some(
          (session) => session.sessionFile === path
        )
      )
        oldUnlinks.push(path);
      await nodeFileSystem.unlink(path);
    },
  };
  const result = await rotateMission(fs, f.input, {
    ...operator(),
    signal: abort.signal,
  });
  expect(synced).toBeTrue();
  expect(renamed).toBeFalse();
  expect(result.state).toBe("rolled-back");
  expect(result.remaining).toEqual([]);
  expect(oldUnlinks).toEqual([]);
  expect(await readFile(f.initialized.sessionsFile)).toEqual(original);
  expect(
    (await readdir(dirname(f.old.sessions.coordinator.sessionFile))).filter(
      (name) => name.endsWith(".jsonl")
    )
  ).toHaveLength(3);
  expect(
    (await readdir(f.initialized.directory)).some(
      (name) =>
        name.startsWith(".sessions.json.") || name === ".session-rotation"
    )
  ).toBeFalse();
});

test("cancelled preflight cleanup failure reports the exact leftover operation lock", async () => {
  const f = await fixture();
  const operation = join(f.initialized.directory, ".session-rotation");
  const fs = {
    ...nodeFileSystem,
    rmdir: async (path: string) => {
      if (path === operation) throw new Error("lock cleanup");
      await nodeFileSystem.rmdir(path);
    },
  };
  const result = await rotateMission(fs, f.input, operator([true, false]));
  expect(result.state).toBe("recovery-required");
  expect(result.remaining).toEqual([operation]);
  expect(result.error).toContain("Old tree unchanged");
});

test("competing rotations have one owner; loser never removes winner's lock or sessions", async () => {
  const f = await fixture();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const acquired = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const first = rotateMission(nodeFileSystem, f.input, {
    ...operator(),
    confirm: async (question) => {
      if (question === DOWNTIME_QUESTION) return true;
      ready();
      await pending;
      return true;
    },
  });
  await acquired;
  await expect(
    rotateMission(nodeFileSystem, f.input, operator())
  ).rejects.toMatchObject({ code: "EEXIST" });
  release();
  expect((await first).state).toBe("committed");
});
