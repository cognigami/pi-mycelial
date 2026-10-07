import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseMycelialCommand } from "./command";
import { DEFAULT_CONFIG } from "./config";
import { nodeFileSystem } from "./filesystem";
import { roleId } from "./identifiers";
import { loadMission, resolveRecipients } from "./mission";
import { initializeMission } from "./mission-init";

const execFileAsync = promisify(execFile);
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test("command-to-files flow creates one dormant coordinator tree with unique multiplicity identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-integration-"));
  const cwd = join(root, "repo with spaces");
  const sessionDirectory = join(root, "custom sessions");
  try {
    await mkdir(cwd, { recursive: true });
    const command = parseMycelialCommand(
      "init release-42 --roles builder=2,reviewer"
    );
    if (command.action !== "init") throw new Error("expected init command");
    const result = await initializeMission(nodeFileSystem, {
      mission: command.mission,
      participants: command.participants,
      cwd,
      sessionDirectory,
      config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
    });
    const manifest = JSON.parse(await readFile(result.sessionsFile, "utf8"));
    expect(Object.keys(manifest.sessions).sort()).toEqual([
      "builder-1",
      "builder-2",
      "coordinator",
      "reviewer",
    ]);
    const coordinatorFile = manifest.sessions.coordinator.sessionFile;
    for (const participant of command.participants) {
      const record = manifest.sessions[participant.role];
      const manager = SessionManager.open(record.sessionFile, sessionDirectory);
      expect(manager.getSessionId()).toBe(record.sessionId);
      expect(manager.getCwd()).toBe(cwd);
      expect(manager.getSessionName()).toBe(`release-42: ${participant.role}`);
      expect(manager.getHeader()?.parentSession).toBe(
        participant.role === "coordinator" ? undefined : coordinatorFile
      );
      expect(manager.buildSessionContext().messages).toEqual([]);
    }
    const mission = await loadMission(nodeFileSystem, result.directory);
    expect(
      plain(resolveRecipients(mission, roleId("coordinator"), "builder-1"))
    ).toEqual({
      to: "builder-1",
      recipients: ["builder-1"],
    });
    expect(() =>
      resolveRecipients(mission, roleId("coordinator"), "builder")
    ).toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two same-mission initializations have one winner without deleting its artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-init-race-"));
  const cwd = join(root, "repo");
  const input = {
    mission: "race",
    roles: ["builder=2"],
    cwd,
    sessionDirectory: join(root, "sessions"),
    config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
  };
  try {
    await mkdir(cwd, { recursive: true });
    const settled = await Promise.allSettled([
      initializeMission(nodeFileSystem, input),
      initializeMission(nodeFileSystem, input),
    ]);
    expect(
      settled.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    const winner = settled.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("no winner");
    expect(
      JSON.parse(await readFile(winner.value.sessionsFile, "utf8"))
        .formatVersion
    ).toBe(1);
    expect(await readdir(input.sessionDirectory)).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stateful launcher starts each participant once, reuses reruns, and fails closed on a symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-launch-integration-"));
  const cwd = join(root, "repo");
  const fakeBin = join(root, "bin");
  const state = join(root, "state");
  const count = join(root, "count");
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const command = parseMycelialCommand(
      "init reusable --roles builder=2,reviewer"
    );
    if (command.action !== "init") throw new Error("expected init command");
    const result = await initializeMission(nodeFileSystem, {
      mission: command.mission,
      participants: command.participants,
      cwd,
      sessionDirectory: join(root, "sessions"),
      config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
    });
    const herdr = join(fakeBin, "herdr");
    await writeFile(
      herdr,
      `#!/bin/sh
if [ "$1 $2" = "agent get" ]; then grep -Fx "$3" "$STATE" >/dev/null 2>&1; exit $?; fi
if [ "$1 $2" = "tab create" ]; then n="$(cat "$COUNT" 2>/dev/null || printf 0)"; n=$((n+1)); printf '%s' "$n" > "$COUNT"; printf '{"tab_id":"t%s","pane_id":"p%s"}\\n' "$n" "$n"; exit 0; fi
if [ "$1 $2" = "agent start" ]; then printf '%s\\n' "$3" >> "$STATE"; exit 0; fi
exit 0
`
    );
    await nodeFileSystem.chmod(herdr, 0o700);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "workspace",
      STATE: state,
      COUNT: count,
    };
    await execFileAsync("bash", [result.launcherFile], { env });
    const second = await execFileAsync("bash", [result.launcherFile], { env });
    expect(second.stdout.match(/reused:/g)).toHaveLength(4);
    expect(await readFile(count, "utf8")).toBe("4");
    expect((await readFile(state, "utf8")).trim().split("\n").sort()).toEqual([
      "builder-1",
      "builder-2",
      "coordinator",
      "reviewer",
    ]);

    const manifest = JSON.parse(await readFile(result.sessionsFile, "utf8"));
    const expected = manifest.sessions["builder-1"].sessionFile as string;
    const saved = join(root, "saved.jsonl");
    await writeFile(saved, await readFile(expected));
    await nodeFileSystem.unlink(expected);
    await symlink(saved, expected);
    await expect(
      execFileAsync("bash", [result.launcherFile, "builder-1"], { env })
    ).rejects.toMatchObject({ code: 1 });

    const names = await readdir(result.directory);
    expect(
      names.some((name) => /rotation|context-monitor/iu.test(name))
    ).toBeFalse();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy missions load and route without sessions.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-legacy-"));
  try {
    await writeFile(join(root, "mission.md"), "# Legacy\n");
    await writeFile(join(root, "agents.json"), '["coordinator","builder"]');
    const mission = await loadMission(nodeFileSystem, root);
    expect(
      plain(resolveRecipients(mission, roleId("coordinator"), "builder"))
    ).toEqual({
      to: "builder",
      recipients: ["builder"],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
