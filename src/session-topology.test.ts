import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type SessionEntry,
  type SessionHeader,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { nodeFileSystem } from "./filesystem";
import { expandParticipants } from "./participants";
import { MissionPaths } from "./paths";
import {
  materializeSessionTopology,
  parseSessionManifest,
  prepareSessionTopology,
  type SessionManifestV1,
  SessionMaterializationError,
  serializeSessionManifest,
  validateMaterializedSessionTopology,
  validateSessionTopology,
} from "./session-topology";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function makeRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function publishPublicSession(
  header: SessionHeader,
  entries: SessionEntry[],
  destination: string
): Promise<void> {
  const content = `${[header, ...entries]
    .map((entry) => JSON.stringify(entry))
    .join("\n")}\n`;
  await writeFile(destination, content, { flag: "wx", mode: 0o600 });
}

function newValidatedSessionId(): string {
  // SessionManager.create validates explicit IDs through its public options API.
  return randomUUID();
}

test("public Pi contracts materialize dormant named parent and child sessions", async () => {
  // SessionManager.create(cwd, sessionDir, options) and its public header/entry
  // readers are required from @earendil-works/pi-coding-agent >= 0.82.1.
  const root = await makeRoot("mycelial session proof '");
  const cwd = join(root, "repo with spaces and 'quotes'");
  const sessionDir = join(root, "custom sessions 'quoted'");

  const coordinator = SessionManager.create(cwd, sessionDir, {
    id: newValidatedSessionId(),
  });
  coordinator.appendSessionInfo("proof: coordinator");
  const coordinatorHeader = coordinator.getHeader();
  const coordinatorFile = coordinator.getSessionFile();
  expect(coordinatorHeader).not.toBeNull();
  expect(coordinatorFile).toBeString();
  await publishPublicSession(
    coordinatorHeader as SessionHeader,
    coordinator.getEntries(),
    coordinatorFile as string
  );

  const worker = SessionManager.create(cwd, sessionDir, {
    id: newValidatedSessionId(),
    parentSession: coordinatorFile,
  });
  worker.appendSessionInfo("proof: builder-1");
  const workerHeader = worker.getHeader();
  const workerFile = worker.getSessionFile();
  expect(workerHeader).not.toBeNull();
  expect(workerFile).toBeString();
  await publishPublicSession(
    workerHeader as SessionHeader,
    worker.getEntries(),
    workerFile as string
  );

  const reopenedCoordinator = SessionManager.open(
    coordinatorFile as string,
    sessionDir
  );
  expect(reopenedCoordinator.getSessionId()).toBe(coordinator.getSessionId());
  expect(reopenedCoordinator.getCwd()).toBe(cwd);
  expect(reopenedCoordinator.getSessionName()).toBe("proof: coordinator");
  expect(reopenedCoordinator.buildSessionContext().messages).toEqual([]);
  expect(
    reopenedCoordinator
      .getEntries()
      .filter((entry) => entry.type === "session_info")
  ).toHaveLength(1);

  const reopenedWorker = SessionManager.open(workerFile as string, sessionDir);
  expect(reopenedWorker.getSessionId()).toBe(worker.getSessionId());
  expect(reopenedWorker.getCwd()).toBe(cwd);
  expect(reopenedWorker.getSessionName()).toBe("proof: builder-1");
  expect(reopenedWorker.getHeader()?.parentSession).toBe(coordinatorFile);
  expect(reopenedWorker.buildSessionContext().messages).toEqual([]);

  const listed = await SessionManager.list(cwd, sessionDir);
  expect(listed).toHaveLength(2);
  expect(
    listed.find((session) => session.id === coordinator.getSessionId())
  ).toMatchObject({
    path: coordinatorFile,
    cwd,
    name: "proof: coordinator",
    messageCount: 0,
  });
  expect(
    listed.find((session) => session.id === worker.getSessionId())
  ).toMatchObject({
    path: workerFile,
    cwd,
    name: "proof: builder-1",
    parentSessionPath: coordinatorFile,
    messageCount: 0,
  });
});

test("exclusive dormant-session publication never overwrites a race winner", async () => {
  const root = await makeRoot("mycelial-session-race-");
  const destination = join(root, "session.jsonl");
  const winner = '{"winner":true}\n';
  await writeFile(destination, winner, { flag: "wx" });

  const header: SessionHeader = {
    type: "session",
    version: 3,
    id: newValidatedSessionId(),
    timestamp: new Date().toISOString(),
    cwd: root,
  };
  await expect(
    publishPublicSession(header, [], destination)
  ).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(destination, "utf8")).toBe(winner);
});

function topology(withCoordinator = true): {
  participants: ReturnType<typeof expandParticipants>;
  manifest: SessionManifestV1;
} {
  const participants = expandParticipants(["builder=2", "reviewer"], {
    includeCoordinator: withCoordinator,
  });
  const sessions = Object.fromEntries(
    participants.map((participant) => [
      participant.role,
      {
        sessionId: randomUUID(),
        sessionFile: `/sessions/${participant.role}.jsonl`,
        name: `mission: ${participant.role}`,
        parent:
          withCoordinator && participant.role !== "coordinator"
            ? "coordinator"
            : null,
      },
    ])
  );
  return {
    participants,
    manifest: { formatVersion: 1, sessions } as SessionManifestV1,
  };
}

describe("sessions.json v1 codec", () => {
  test("round-trips a validated manifest deterministically", () => {
    const value = topology();
    const encoded = serializeSessionManifest(
      value.manifest,
      value.participants
    );
    expect(parseSessionManifest(encoded, value.participants)).toEqual(
      JSON.parse(encoded)
    );
    expect(Object.keys(JSON.parse(encoded).sessions)).toEqual([
      "builder-1",
      "builder-2",
      "coordinator",
      "reviewer",
    ]);
  });

  test.each([
    [
      "unknown top-level field",
      '{"formatVersion":1,"sessions":{},"extra":true}',
    ],
    [
      "unknown session field",
      '{"formatVersion":1,"sessions":{"coordinator":{"sessionId":"id","sessionFile":"/session.jsonl","name":"mission: coordinator","parent":null,"extra":true}}}',
    ],
    ["unknown version", '{"formatVersion":2,"sessions":{}}'],
    [
      "duplicate participant",
      '{"formatVersion":1,"sessions":{"coordinator":{"sessionId":"one","sessionFile":"/one","name":"one","parent":null},"coordinator":{"sessionId":"two","sessionFile":"/two","name":"two","parent":null}}}',
    ],
  ])("rejects %s", (_label, encoded) => {
    const participants = expandParticipants(["coordinator"]);
    expect(() => parseSessionManifest(encoded, participants)).toThrow();
  });

  test("uses bounded diagnostics for malformed input", () => {
    const marker = "private-content-that-must-not-be-echoed";
    try {
      parseSessionManifest(`{${marker}`, expandParticipants(["builder"]));
      throw new Error("expected parse failure");
    } catch (error) {
      expect(String(error)).not.toContain(marker);
      expect(String(error).length).toBeLessThan(300);
    }
  });
});

describe("session topology invariants", () => {
  test("accepts one top-level coordinator and coordinator-parented workers", () => {
    const value = topology();
    expect(() =>
      validateSessionTopology(value.manifest, value.participants)
    ).not.toThrow();
  });

  test("accepts only top-level sessions without a coordinator", () => {
    const value = topology(false);
    expect(() =>
      validateSessionTopology(value.manifest, value.participants)
    ).not.toThrow();
  });

  test.each([
    [
      "missing participant",
      (manifest: SessionManifestV1) => delete manifest.sessions.reviewer,
    ],
    [
      "extra participant",
      (manifest: SessionManifestV1) => {
        manifest.sessions.extra = { ...manifest.sessions.reviewer };
      },
    ],
    [
      "relative file",
      (manifest: SessionManifestV1) => {
        manifest.sessions.reviewer.sessionFile = "relative.jsonl";
      },
    ],
    [
      "empty name",
      (manifest: SessionManifestV1) => {
        manifest.sessions.reviewer.name = "";
      },
    ],
    [
      "worker without coordinator parent",
      (manifest: SessionManifestV1) => {
        manifest.sessions.reviewer.parent = null;
      },
    ],
    [
      "coordinator with parent",
      (manifest: SessionManifestV1) => {
        manifest.sessions.coordinator.parent = "reviewer";
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const value = topology();
    mutate(value.manifest);
    expect(() =>
      validateSessionTopology(value.manifest, value.participants)
    ).toThrow();
  });
});

describe("dormant session topology materialization", () => {
  test("materializes custom-directory coordinator and child sessions and reports exact paths", async () => {
    const root = await makeRoot("mycelial materialize '");
    const cwd = join(root, "repo with spaces and 'quotes'");
    const sessionDir = join(root, "sessions with spaces and 'quotes'");
    const participants = expandParticipants(["builder=2", "reviewer"]);
    const prepared = prepareSessionTopology({
      cwd,
      sessionDir,
      mission: "release-42",
      participants,
    });

    const result = await materializeSessionTopology(nodeFileSystem, prepared);
    const expectedPaths = [
      prepared.manifest.sessions.coordinator.sessionFile,
      prepared.manifest.sessions["builder-1"].sessionFile,
      prepared.manifest.sessions["builder-2"].sessionFile,
      prepared.manifest.sessions.reviewer.sessionFile,
    ];
    expect(result.createdPaths).toEqual(expectedPaths);
    for (const participant of participants) {
      const session = prepared.manifest.sessions[participant.role];
      expect(session.name).toBe(`release-42: ${participant.role}`);
      expect(session.parent).toBe(
        participant.role === "coordinator" ? null : "coordinator"
      );
    }
    await validateMaterializedSessionTopology(
      nodeFileSystem,
      prepared.manifest,
      participants,
      cwd
    );
  });

  test("supports Pi's default directory and coordinator-free top-level sessions", async () => {
    const root = await makeRoot("mycelial-default-sessions-");
    const cwd = join(root, "repository");
    const participants = expandParticipants(["builder", "reviewer"], {
      includeCoordinator: false,
    });
    const prepared = prepareSessionTopology({
      cwd,
      mission: "peer-review",
      participants,
    });
    roots.push(prepared.sessionDir);

    const result = await materializeSessionTopology(nodeFileSystem, prepared);
    expect(result.createdPaths).toHaveLength(2);
    expect(
      Object.values(prepared.manifest.sessions).map((session) => session.parent)
    ).toEqual([null, null]);
    await validateMaterializedSessionTopology(
      nodeFileSystem,
      prepared.manifest,
      participants,
      cwd
    );
  });

  test("validation and repeated materialization do not append duplicate names", async () => {
    const root = await makeRoot("mycelial-reopen-");
    const participants = expandParticipants(["builder"]);
    const prepared = prepareSessionTopology({
      cwd: join(root, "repo"),
      sessionDir: join(root, "sessions"),
      mission: "stable",
      participants,
    });
    await materializeSessionTopology(nodeFileSystem, prepared);
    const coordinatorPath = prepared.manifest.sessions.coordinator.sessionFile;
    const before = await readFile(coordinatorPath);

    await validateMaterializedSessionTopology(
      nodeFileSystem,
      prepared.manifest,
      participants,
      prepared.cwd
    );
    const repeated = await materializeSessionTopology(nodeFileSystem, prepared);
    expect(repeated.createdPaths).toEqual([]);
    expect(await readFile(coordinatorPath)).toEqual(before);
    const reopened = SessionManager.open(coordinatorPath, prepared.sessionDir);
    expect(
      reopened.getEntries().filter((entry) => entry.type === "session_info")
    ).toHaveLength(1);
  });

  test("reports created predecessors when a later destination conflicts", async () => {
    const root = await makeRoot("mycelial-partial-");
    const participants = expandParticipants(["builder=2"]);
    const prepared = prepareSessionTopology({
      cwd: join(root, "repo"),
      sessionDir: join(root, "sessions"),
      mission: "partial",
      participants,
    });
    const conflictPath = prepared.manifest.sessions["builder-1"].sessionFile;
    const winner = Buffer.from('{"winner":true}\n');
    await writeFile(conflictPath, winner, { flag: "wx" });

    try {
      await materializeSessionTopology(nodeFileSystem, prepared);
      throw new Error("expected materialization failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionMaterializationError);
      expect((error as SessionMaterializationError).createdPaths).toEqual([
        prepared.manifest.sessions.coordinator.sessionFile,
      ]);
    }
    expect(await readFile(conflictPath)).toEqual(winner);
  });

  test("rejects unsafe paths and symlink destinations without replacing them", async () => {
    const value = topology();
    value.manifest.sessions.reviewer.sessionFile = "/sessions/../escape.jsonl";
    expect(() =>
      validateSessionTopology(value.manifest, value.participants)
    ).toThrow("absolute normalized path");

    const root = await makeRoot("mycelial-symlink-");
    const participants = expandParticipants(["builder"]);
    const prepared = prepareSessionTopology({
      cwd: join(root, "repo"),
      sessionDir: join(root, "sessions"),
      mission: "safe",
      participants,
    });
    const target = join(root, "winner");
    await writeFile(target, "winner");
    const coordinatorPath = prepared.manifest.sessions.coordinator.sessionFile;
    await mkdir(join(root, "sessions"), { recursive: true });
    await symlink(target, coordinatorPath);
    await expect(
      materializeSessionTopology(nodeFileSystem, prepared)
    ).rejects.toBeInstanceOf(SessionMaterializationError);
    expect(await readFile(target, "utf8")).toBe("winner");
  });
});

test("MissionPaths exposes the optional sessions control file", () => {
  const paths = new MissionPaths("/missions/release-42");
  expect(paths.sessionsFile()).toBe("/missions/release-42/sessions.json");
});
