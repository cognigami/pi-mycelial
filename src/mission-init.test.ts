import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "./config";
import { nodeFileSystem } from "./filesystem";
import { initializeMission, renderHerdrLauncher } from "./mission-init";

const execFileAsync = promisify(execFile);

test("initializes mission controls and an executable multi-tab launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-init-"));
  const missionRoot = join(root, "missions");
  const cwd = join(root, "repo's work");
  try {
    await mkdir(join(cwd, "docs"), { recursive: true });
    await writeFile(join(cwd, "docs", "mission draft.md"), "# Approved\n");

    const result = await initializeMission(nodeFileSystem, {
      mission: "release-42",
      roles: ["reviewer"],
      repos: ["app"],
      source: "docs/mission draft.md",
      cwd,
      config: { ...DEFAULT_CONFIG, missionRoot },
    });

    const mission = await readFile(result.missionFile, "utf8");
    expect(mission).toContain(
      "approved source artifact `docs/mission draft.md`"
    );
    expect(mission).not.toContain("# Approved");
    expect(mission).toContain("**coordinator:** Decompose and route work");
    expect(mission).toContain("**reviewer:** Accept scoped requests");
    expect(mission).toContain(
      "Every deliverable and acceptance check in the approved source artifact"
    );
    expect(JSON.parse(await readFile(result.agentsFile, "utf8"))).toEqual({
      agents: ["coordinator", "reviewer"],
    });
    expect(JSON.parse(await readFile(result.reposFile, "utf8"))).toEqual({
      repos: ["app"],
    });
    expect((await stat(result.launcherFile)).mode & 0o777).toBe(0o700);
    expect(
      (await lstat(result.projectLauncherLink)).isSymbolicLink()
    ).toBeTrue();
    expect(await readlink(result.projectLauncherLink)).toBe(
      result.launcherFile
    );
    expect(result.projectLauncherLink).toBe(
      join(cwd, "launch-mycelial-release-42.sh")
    );
    expect(result.repositoryGuidanceCreated).toBeTrue();
    expect(result.repositoryGuidanceFile).toBe(join(cwd, "AGENTS.md"));
    expect(await readFile(result.repositoryGuidanceFile, "utf8")).toContain(
      "# Project Guidance"
    );

    const launcher = await readFile(result.launcherFile, "utf8");
    expect(launcher).toContain("herdr tab create");
    expect(launcher).not.toContain("herdr pane split");
    expect(launcher).toContain("--presets:preset");
    expect(launcher).toContain("agent_mission_read");
    expect(launcher).toContain("Decompose the mission");
    expect(launcher).toContain("Durable send automatically notifies");
    expect(launcher).toContain("AGENTS.md already loaded by Pi");
    expect(launcher).toContain("repo'\"'\"'s work");
    await execFileAsync("bash", ["-n", result.launcherFile]);

    await expect(
      initializeMission(nodeFileSystem, {
        mission: "release-42",
        roles: ["coordinator"],
        cwd,
        config: { ...DEFAULT_CONFIG, missionRoot },
      })
    ).rejects.toThrow("already exists");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated launcher starts every configured role with optional presets", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-launch-"));
  const missionRoot = join(root, "missions");
  const cwd = join(root, "repo");
  const fakeBin = join(root, "bin");
  const herdrLog = join(root, "herdr.log");
  const herdrCount = join(root, "herdr.count");
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const result = await initializeMission(nodeFileSystem, {
      mission: "live-test",
      roles: ["coordinator", "implementer", "reviewer"],
      cwd,
      config: { ...DEFAULT_CONFIG, missionRoot },
    });
    await writeFile(
      result.agentsFile,
      JSON.stringify({
        coordinator: {},
        implementer: {},
        reviewer: { preset: "domain-auditor" },
      })
    );
    const fakeHerdr = join(fakeBin, "herdr");
    await writeFile(
      fakeHerdr,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$HERDR_FAKE_LOG"
if [ "$1 $2" = "agent get" ]; then exit 1; fi
if [ "$1 $2" = "tab create" ]; then
  count="$(cat "$HERDR_FAKE_COUNT" 2>/dev/null || printf 0)"
  count=$((count + 1))
  printf '%s' "$count" > "$HERDR_FAKE_COUNT"
  printf '{"result":{"tab":{"tab_id":"t%s"},"pane":{"pane_id":"p%s"}}}\\n' "$count" "$count"
  exit 0
fi
printf '{"result":{}}\\n'
`
    );
    await nodeFileSystem.chmod(fakeHerdr, 0o700);
    const fakeJq = join(fakeBin, "jq");
    await writeFile(
      fakeJq,
      `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
const query = args[1] ?? "";
const input = args.length >= 3
  ? await Bun.file(args.at(-1)).text()
  : await Bun.stdin.text();
const data = JSON.parse(input);

if (query.includes("def rows:")) {
  const agents = data.agents ?? data;
  const rows = Array.isArray(agents)
    ? agents.map((entry) =>
        typeof entry === "string"
          ? [entry, ""]
          : [entry.role ?? entry.name, entry.preset ?? ""]
      )
    : Object.entries(agents).map(([role, metadata]) => [
        role,
        metadata?.preset ?? "",
      ]);
  process.stdout.write(rows.map((row) => row.join("\\t")).join("\\n"));
} else {
  const key = query.includes(".tab_id?") ? "tab_id" : "pane_id";
  const findValue = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findValue(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (value && typeof value === "object") {
      if (typeof value[key] === "string") return value[key];
      for (const item of Object.values(value)) {
        const found = findValue(item);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  const result = findValue(data);
  if (result === undefined) process.exit(1);
  console.log(result);
}
`
    );
    await nodeFileSystem.chmod(fakeJq, 0o700);

    const execution = await execFileAsync("bash", [result.launcherFile], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        HERDR_ENV: "1",
        HERDR_WORKSPACE_ID: "workspace-1",
        HERDR_FAKE_LOG: herdrLog,
        HERDR_FAKE_COUNT: herdrCount,
      },
    });
    expect(execution.stdout).toContain("Mission launched: live-test");
    const calls = await readFile(herdrLog, "utf8");
    expect(calls.match(/tab create/g)).toHaveLength(3);
    expect(calls).toContain(
      "agent start coordinator --kind pi --pane p1 -- --mycelial-mission live-test --mycelial-role coordinator"
    );
    expect(calls).toContain(
      "agent start reviewer --kind pi --pane p3 -- --mycelial-mission live-test --mycelial-role reviewer --presets:preset domain-auditor"
    );
    expect(calls.match(/agent prompt/g)).toHaveLength(1);
    expect(calls).toContain("agent prompt coordinator");
    expect(calls).not.toContain("agent prompt implementer");
    expect(calls).not.toContain("agent prompt reviewer");
    expect(calls.match(/--wait --timeout 120000/g)).toHaveLength(1);

    await writeFile(herdrLog, "");
    await writeFile(herdrCount, "0");
    await execFileAsync("bash", [result.launcherFile, "reviewer"], {
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        HERDR_ENV: "1",
        HERDR_WORKSPACE_ID: "workspace-1",
        HERDR_FAKE_LOG: herdrLog,
        HERDR_FAKE_COUNT: herdrCount,
      },
    });
    const subsetCalls = await readFile(herdrLog, "utf8");
    expect(subsetCalls.match(/tab create/g)).toHaveLength(1);
    expect(subsetCalls).toContain("agent start reviewer");
    expect(subsetCalls).not.toContain("agent start coordinator");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves an existing AGENTS.md and permits coordinator opt-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-guidance-"));
  const missionRoot = join(root, "missions");
  const cwd = join(root, "repo");
  try {
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "AGENTS.md"), "# Existing guidance\n");

    const result = await initializeMission(nodeFileSystem, {
      mission: "peer-only",
      roles: ["builder"],
      includeCoordinator: false,
      cwd,
      config: { ...DEFAULT_CONFIG, missionRoot },
    });

    expect(JSON.parse(await readFile(result.agentsFile, "utf8"))).toEqual({
      agents: ["builder"],
    });
    expect(result.repositoryGuidanceCreated).toBeFalse();
    expect(await readFile(result.missionFile, "utf8")).toContain(
      "This mission has no designated coordinator"
    );
    expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(
      "# Existing guidance\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("shell-quotes generated launcher constants", async () => {
  const launcher = renderHerdrLauncher({
    missionId: "mission-1",
    missionDirectory: "/tmp/mycelial mission",
    repositoryRoot: "/tmp/repo's work",
  });
  expect(launcher).toContain("MISSION_DIR='/tmp/mycelial mission'");
  expect(launcher).toContain("REPO_ROOT='/tmp/repo'\"'\"'s work'");
});
