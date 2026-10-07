import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "./config";
import { type FileSystem, nodeFileSystem } from "./filesystem";
import {
  InitializationRollbackError,
  initializeMission,
  renderHerdrLauncher,
} from "./mission-init";

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
      sessionDirectory: join(root, "sessions"),
      config: { ...DEFAULT_CONFIG, missionRoot },
    });

    const mission = await readFile(result.missionFile, "utf8");
    expect(mission).toContain(
      "approved source artifact `docs/mission draft.md`"
    );
    expect(mission).not.toContain("# Approved");
    expect(mission).toContain(
      "**coordinator** (capability: **coordinator**): Decompose and route work"
    );
    expect(mission).toContain(
      "**reviewer** (capability: **reviewer**): Accept scoped requests"
    );
    expect(mission).toContain(
      "Every deliverable and acceptance check in the approved source artifact"
    );
    expect(JSON.parse(await readFile(result.agentsFile, "utf8"))).toEqual({
      agents: [
        { role: "coordinator", capability: "coordinator" },
        { role: "reviewer", capability: "reviewer" },
      ],
    });
    expect(
      JSON.parse(await readFile(result.sessionsFile, "utf8"))
    ).toMatchObject({
      formatVersion: 1,
      sessions: {
        coordinator: { name: "release-42: coordinator", parent: null },
        reviewer: { name: "release-42: reviewer", parent: "coordinator" },
      },
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
    const guidance = await readFile(result.repositoryGuidanceFile, "utf8");
    expect(guidance).toContain("# Project Guidance");
    expect(guidance).toContain("Do not use `/tmp` for mission work");
    expect(guidance).toContain("Treat a sandbox denial as a workflow error");

    const launcher = await readFile(result.launcherFile, "utf8");
    expect(launcher).toContain("herdr tab create");
    expect(launcher).not.toContain("herdr pane split");
    expect(launcher).toContain("--presets:preset");
    expect(launcher).toContain("agent_mission_read");
    expect(launcher).toContain("Reconcile mission $MISSION_ID idempotently");
    expect(launcher).toContain("Durable send automatically notifies");
    expect(launcher).toContain("follow repository AGENTS.md");
    expect(launcher).toContain("repo'\"'\"'s work");
    await execFileAsync("bash", ["-n", result.launcherFile]);

    await expect(
      initializeMission(nodeFileSystem, {
        mission: "release-42",
        roles: ["coordinator"],
        cwd,
        sessionDirectory: join(root, "sessions"),
        config: { ...DEFAULT_CONFIG, missionRoot },
      })
    ).rejects.toThrow("already exists");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated launcher starts exact sessions and idempotently reuses live agents", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-launch-"));
  const missionRoot = join(root, "missions");
  const cwd = join(root, "repo");
  const fakeBin = join(root, "bin");
  const herdrLog = join(root, "herdr.log");
  const herdrCount = join(root, "herdr.count");
  const herdrState = join(root, "herdr.state");
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const result = await initializeMission(nodeFileSystem, {
      mission: "live-test",
      roles: ["coordinator", "implementer", "reviewer"],
      cwd,
      sessionDirectory: join(root, "sessions"),
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
    const manifest = JSON.parse(await readFile(result.sessionsFile, "utf8"));
    const coordinatorAgent = manifest.sessions.coordinator.herdrName;
    const implementerAgent = manifest.sessions.implementer.herdrName;
    const reviewerAgent = manifest.sessions.reviewer.herdrName;
    const fakeHerdr = join(fakeBin, "herdr");
    await writeFile(
      fakeHerdr,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$HERDR_FAKE_LOG"
if [ "$1 $2" = "agent get" ]; then
  grep -Fx "$3" "$HERDR_FAKE_STATE" >/dev/null 2>&1
  exit $?
fi
if [ "$1 $2" = "tab create" ]; then
  count="$(cat "$HERDR_FAKE_COUNT" 2>/dev/null || printf 0)"
  count=$((count + 1))
  printf '%s' "$count" > "$HERDR_FAKE_COUNT"
  printf '{"result":{"tab":{"tab_id":"t%s"},"pane":{"pane_id":"p%s"}}}\\n' "$count" "$count"
  exit 0
fi
if [ "$1 $2" = "agent start" ]; then
  [ "\${HERDR_FAKE_RACE_AGENT:-}" = "$3" ] && exit 9
  printf '%s\\n' "$3" >> "$HERDR_FAKE_STATE"
  exit 0
fi
printf '{"result":{}}\\n'
`
    );
    await nodeFileSystem.chmod(fakeHerdr, 0o700);
    const environment = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "workspace-1",
      HERDR_FAKE_LOG: herdrLog,
      HERDR_FAKE_COUNT: herdrCount,
      HERDR_FAKE_STATE: herdrState,
    };

    const first = await execFileAsync("bash", [result.launcherFile], {
      env: environment,
    });
    expect(first.stdout).toContain("Mission launch reconciled: live-test");
    expect(first.stdout.match(/started:/g)).toHaveLength(3);
    let calls = await readFile(herdrLog, "utf8");
    expect(calls.match(/tab create/g)).toHaveLength(3);
    expect(calls).toContain(
      `agent start ${coordinatorAgent} --kind pi --pane p1 -- --session ${manifest.sessions.coordinator.sessionFile} --mycelial-mission live-test --mycelial-role coordinator`
    );
    expect(calls).toContain(
      `agent start ${reviewerAgent} --kind pi --pane p3 -- --session ${manifest.sessions.reviewer.sessionFile} --mycelial-mission live-test --mycelial-role reviewer --presets:preset domain-auditor`
    );
    expect(calls.match(/agent prompt/g)).toHaveLength(1);
    expect(calls).toContain(`agent prompt ${coordinatorAgent}`);
    expect(calls).toContain("Reconcile mission live-test idempotently");

    await writeFile(herdrLog, "");
    const second = await execFileAsync("bash", [result.launcherFile], {
      env: environment,
    });
    expect(second.stdout.match(/reused:/g)).toHaveLength(3);
    calls = await readFile(herdrLog, "utf8");
    expect(calls).not.toContain("tab create");
    expect(calls).not.toContain("agent start");
    expect(calls).not.toContain("agent prompt");
    await expect(
      execFileAsync("bash", [result.launcherFile, "reviewer", "reviewer"], {
        env: environment,
      })
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      execFileAsync("bash", [result.launcherFile, "unknown"], {
        env: environment,
      })
    ).rejects.toMatchObject({ code: 1 });

    await writeFile(herdrState, `${coordinatorAgent}\n${implementerAgent}\n`);
    await writeFile(herdrLog, "");
    const mixed = await execFileAsync("bash", [result.launcherFile], {
      env: environment,
    });
    expect(mixed.stdout).toContain("reused: coordinator");
    expect(mixed.stdout).toContain("started: reviewer");
    calls = await readFile(herdrLog, "utf8");
    expect(calls.match(/tab create/g)).toHaveLength(1);
    expect(calls).not.toContain("agent prompt");

    await writeFile(herdrState, `${coordinatorAgent}\n${implementerAgent}\n`);
    await writeFile(herdrLog, "");
    await execFileAsync("bash", [result.launcherFile, "reviewer"], {
      env: environment,
    });
    calls = await readFile(herdrLog, "utf8");
    expect(calls.match(/tab create/g)).toHaveLength(1);
    expect(calls).toContain(`agent start ${reviewerAgent}`);
    expect(calls).not.toContain(`agent start ${coordinatorAgent}`);
    expect(calls).toContain(`agent prompt ${reviewerAgent}`);
    expect(calls).toContain("Resume as participant reviewer");

    await writeFile(herdrState, `${coordinatorAgent}\n${implementerAgent}\n`);
    await writeFile(herdrLog, "");
    await expect(
      execFileAsync("bash", [result.launcherFile, "reviewer"], {
        env: { ...environment, HERDR_FAKE_RACE_AGENT: reviewerAgent },
      })
    ).rejects.toMatchObject({ code: 9 });
    calls = await readFile(herdrLog, "utf8");
    expect(calls).toContain("tab create");
    expect(calls).toContain(`agent start ${reviewerAgent}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  "missing session",
  "mismatched header",
  "participant set mismatch",
  "symlinked session",
] as const)("launcher fails closed for a %s", async (failure) => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-preflight-"));
  const cwd = join(root, "repo");
  const fakeBin = join(root, "bin");
  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    const result = await initializeMission(nodeFileSystem, {
      mission: "preflight",
      roles: ["reviewer"],
      cwd,
      sessionDirectory: join(root, "sessions"),
      config: { ...DEFAULT_CONFIG, missionRoot: join(root, "missions") },
    });
    const manifest = JSON.parse(await readFile(result.sessionsFile, "utf8"));
    const reviewerFile = manifest.sessions.reviewer.sessionFile as string;
    if (failure === "missing session") {
      await nodeFileSystem.unlink(reviewerFile);
    } else if (failure === "mismatched header") {
      const lines = (await readFile(reviewerFile, "utf8"))
        .trimEnd()
        .split("\n");
      const header = JSON.parse(lines[0]);
      header.id = "wrong-session";
      lines[0] = JSON.stringify(header);
      await writeFile(reviewerFile, `${lines.join("\n")}\n`);
    } else if (failure === "participant set mismatch") {
      delete manifest.sessions.reviewer;
      await writeFile(result.sessionsFile, JSON.stringify(manifest));
    } else {
      const target = join(root, "saved-reviewer.jsonl");
      await writeFile(target, await readFile(reviewerFile));
      await nodeFileSystem.unlink(reviewerFile);
      await symlink(target, reviewerFile);
    }
    const fakeHerdr = join(fakeBin, "herdr");
    await writeFile(fakeHerdr, "#!/bin/sh\nexit 0\n");
    await nodeFileSystem.chmod(fakeHerdr, 0o700);
    await expect(
      execFileAsync("bash", [result.launcherFile], {
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          HERDR_ENV: "1",
          HERDR_WORKSPACE_ID: "workspace-1",
        },
      })
    ).rejects.toMatchObject({ code: 1 });
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
      sessionDirectory: join(root, "sessions"),
      config: { ...DEFAULT_CONFIG, missionRoot },
    });

    expect(JSON.parse(await readFile(result.agentsFile, "utf8"))).toEqual({
      agents: [{ role: "builder", capability: "builder" }],
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

test.each([
  "coordinator session",
  "worker session",
  "session manifest",
  "launcher",
  "project symlink",
] as const)(
  "rolls back exactly created artifacts after a %s failure",
  async (boundary) => {
    const root = await mkdtemp(join(tmpdir(), "mycelial-rollback-"));
    const cwd = join(root, "repo");
    const missionRoot = join(root, "missions");
    const sessionDirectory = join(root, "sessions");
    const missionDirectory = join(missionRoot, "rollback");
    let sessionLinks = 0;
    try {
      await mkdir(cwd, { recursive: true });
      await mkdir(sessionDirectory, { recursive: true });
      await writeFile(join(cwd, "AGENTS.md"), "# Existing\n");
      await writeFile(join(sessionDirectory, "pre-existing.jsonl"), "keep\n");
      const failing: FileSystem = {
        ...nodeFileSystem,
        async link(from, to) {
          if (to.endsWith(".jsonl")) {
            sessionLinks++;
            if (
              (boundary === "coordinator session" && sessionLinks === 1) ||
              (boundary === "worker session" && sessionLinks === 2)
            )
              throw new Error(`injected ${boundary} failure`);
          }
          if (
            (boundary === "session manifest" && to.endsWith("sessions.json")) ||
            (boundary === "launcher" && to.endsWith("launch-herdr.sh"))
          )
            throw new Error(`injected ${boundary} failure`);
          await nodeFileSystem.link(from, to);
        },
        async symlink(target, path) {
          if (boundary === "project symlink")
            throw new Error("injected project symlink failure");
          await nodeFileSystem.symlink(target, path);
        },
      };

      await expect(
        initializeMission(failing, {
          mission: "rollback",
          roles: ["builder"],
          cwd,
          sessionDirectory,
          config: { ...DEFAULT_CONFIG, missionRoot },
        })
      ).rejects.toThrow();

      await expect(lstat(missionDirectory)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        lstat(join(cwd, "launch-mycelial-rollback.sh"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(cwd, "AGENTS.md"), "utf8")).toBe(
        "# Existing\n"
      );
      expect(
        await readFile(join(sessionDirectory, "pre-existing.jsonl"), "utf8")
      ).toBe("keep\n");
      const remaining = (await readdir(sessionDirectory)).filter((path) =>
        path.endsWith(".jsonl")
      );
      expect(remaining).toEqual(["pre-existing.jsonl"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test("preserves the primary failure and reports cleanup residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycelial-residue-"));
  const cwd = join(root, "repo");
  const missionRoot = join(root, "missions");
  const sessionDirectory = join(root, "sessions");
  try {
    await mkdir(cwd, { recursive: true });
    const failing: FileSystem = {
      ...nodeFileSystem,
      async link(from, to) {
        if (to.endsWith("launch-herdr.sh"))
          throw new Error("primary launcher failure");
        await nodeFileSystem.link(from, to);
      },
      async unlink(path) {
        if (path.endsWith(".jsonl"))
          throw new Error("injected cleanup failure");
        await nodeFileSystem.unlink(path);
      },
    };
    let failure: unknown;
    try {
      await initializeMission(failing, {
        mission: "residue",
        roles: ["builder"],
        cwd,
        sessionDirectory,
        config: { ...DEFAULT_CONFIG, missionRoot },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(InitializationRollbackError);
    const rollback = failure as InitializationRollbackError;
    expect((rollback.cause as Error).message).toContain(
      "primary launcher failure"
    );
    expect(rollback.cleanupResidue.length).toBeGreaterThan(0);
    expect(
      rollback.cleanupResidue.every((path) => path.endsWith(".jsonl"))
    ).toBeTrue();
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
