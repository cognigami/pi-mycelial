import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";

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
  expect(listed.find((session) => session.id === coordinator.getSessionId())).toMatchObject({
    path: coordinatorFile,
    cwd,
    name: "proof: coordinator",
    messageCount: 0,
  });
  expect(listed.find((session) => session.id === worker.getSessionId())).toMatchObject({
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
  await expect(publishPublicSession(header, [], destination)).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(destination, "utf8")).toBe(winner);
});
