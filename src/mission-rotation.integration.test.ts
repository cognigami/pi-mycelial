import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "./config";
import { nodeFileSystem } from "./filesystem";
import { roleId } from "./identifiers";
import { loadMission, resolveHerdrAgentName } from "./mission";
import { initializeMission } from "./mission-init";
import { preflightRotation, rotateMission } from "./mission-rotation";
import { createWakeDispatcher, WAKE_PROMPT } from "./tool/wake";

const execute = promisify(execFile);

test("unchanged launcher rereads rotated manifest, reuses fresh agents, preserves eng default and routes new wakes (fake Herdr)", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mycelial-rotation-integration-"))
  );
  try {
    const cwd = join(root, "repo");
    const bin = join(root, "bin");
    const defaultRoot = join(root, "default-sessions");
    await mkdir(cwd);
    await mkdir(bin);
    await mkdir(defaultRoot);
    const initialized = await initializeMission(nodeFileSystem, {
      mission: "mission",
      roles: ["builder", "reviewer"],
      cwd,
      sessionDirectory: join(root, "sessions"),
      config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
    });
    const launcher = await readFile(initialized.launcherFile);
    const old = (await loadMission(nodeFileSystem, initialized.directory))
      .sessions;
    if (!old) throw new Error("Missing old topology");
    const state = join(root, "agents");
    const calls = join(root, "calls");
    const count = join(root, "count");
    await writeFile(
      join(bin, "herdr"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1 $2" = "agent get" ]; then grep -Fx "$3" "$STATE" >/dev/null 2>&1; exit $?; fi
if [ "$1 $2" = "tab create" ]; then n="$(cat "$COUNT" 2>/dev/null || printf 0)"; n=$((n+1)); printf '%s' "$n" > "$COUNT"; printf '{"tab_id":"t%s","pane_id":"p%s"}\\n' "$n" "$n"; exit 0; fi
if [ "$1 $2" = "agent start" ]; then printf '%s\\n' "$3" >> "$STATE"; exit 0; fi
exit 0
`
    );
    await nodeFileSystem.chmod(join(bin, "herdr"), 0o700);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "disposable",
      STATE: state,
      CALLS: calls,
      COUNT: count,
    };
    await execute("bash", [initialized.launcherFile], { env });
    await execute("bash", [initialized.launcherFile], { env });
    expect(await readFile(count, "utf8")).toBe("3");
    const input = {
      missionDirectory: initialized.directory,
      defaultSessionRoot: defaultRoot,
      saveHistory: true,
    };
    expect((await preflightRotation(nodeFileSystem, input)).refusals).toEqual(
      []
    );
    expect(
      (
        await rotateMission(nodeFileSystem, input, {
          confirm: async () => true,
          report: () => {},
          phase: () => {},
        })
      ).state
    ).toBe("committed");
    const first = await execute("bash", [initialized.launcherFile], { env });
    const second = await execute("bash", [initialized.launcherFile], { env });
    expect(first.stdout.match(/started:/g)).toHaveLength(3);
    expect(second.stdout.match(/reused:/g)).toHaveLength(3);
    expect(await readFile(count, "utf8")).toBe("6");
    expect(await readFile(initialized.launcherFile)).toEqual(launcher);
    const mission = await loadMission(nodeFileSystem, initialized.directory);
    const lines = (await readFile(calls, "utf8")).trim().split("\n");
    if (!mission.sessions) throw new Error("Missing fresh topology");
    for (const [role, session] of Object.entries(mission.sessions.sessions)) {
      const start = lines.filter((line) =>
        line.startsWith(`agent start ${session.herdrName} `)
      );
      expect(start).toHaveLength(1);
      expect(start[0]).toContain(
        `--session ${session.sessionFile} --mycelial-mission mission --mycelial-role ${role} --presets:preset eng`
      );
      expect(start[0]).not.toContain(old.sessions[role].sessionFile);
    }
    const dispatcher = createWakeDispatcher(
      async (command, args) => {
        await execute(command, args, { env });
        return { code: 0, killed: false };
      },
      (role) => resolveHerdrAgentName(mission, role)
    );
    expect((await dispatcher.wake(roleId("builder"))).status).toBe("sent");
    expect(await readFile(calls, "utf8")).toContain(
      `agent prompt ${mission.sessions?.sessions.builder.herdrName} ${WAKE_PROMPT}`
    );
    expect(mission.roles.map(String)).toEqual([
      "builder",
      "coordinator",
      "reviewer",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
