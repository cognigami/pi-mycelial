import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "./config";
import { nodeFileSystem } from "./filesystem";
import { initializeMission } from "./mission-init";

const execute = promisify(execFile);
let root: string;
let binary: string;
let cwd: string;
let home: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mycelial-native-cli-")));
  binary = join(root, "rotate");
  cwd = join(root, "unrelated");
  home = join(root, "home");
  await mkdir(cwd);
  await mkdir(home);
  await mkdir(join(root, "agent", "sessions"), { recursive: true });
  env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(root, "config"),
    PI_EXTENSIONS_CONFIG_HOME: "",
    PI_EXTENSIONS_STATE_HOME: join(root, "state"),
    PI_EXTENSIONS_CACHE_HOME: join(root, "cache"),
    PI_CODING_AGENT_DIR: join(root, "agent"),
    PI_CODING_AGENT: "",
    AI_AGENT: "",
    PI_SESSION_ID: "",
    PI_SESSION_FILE: "",
    BUN_INSTALL_CACHE_DIR: join(root, "bun-cache"),
    // No runtime executable on PATH: rotation must be standalone.
    PATH: "/usr/bin:/bin",
  };
  await execute(
    "just",
    ["--justfile", resolve("Justfile"), "build-rotate", binary],
    { timeout: 60_000 }
  );
  await mkdir(join(cwd, ".pi"));
  await writeFile(
    join(cwd, ".pi", "mycelial.jsonc"),
    '{"missionRoot":"/must-not-use-local-config"}'
  );
  await writeFile(join(cwd, ".env"), "HOME=/must-not-load-dotenv\n");
  await writeFile(join(cwd, "bunfig.toml"), '[install]\nauto = "force"\n');
}, 60_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function invoke(args: string[]) {
  try {
    return {
      ...(await execute(binary, args, { cwd, env, timeout: 10_000 })),
      code: 0,
    };
  } catch (error) {
    return error as { stdout: string; stderr: string; code: number };
  }
}

async function snapshot() {
  const files: Record<string, string> = {};
  for (const path of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    const absolute = join(path.parentPath, path.name);
    if (absolute === binary) continue;
    files[absolute] = path.isDirectory()
      ? "directory"
      : (await readFile(absolute)).toString("base64");
  }
  return files;
}

test("native help/errors work outside checkout without creating config, state, cache or dependencies", async () => {
  const before = await snapshot();
  for (const args of [[], ["--help"]]) {
    const result = await invoke(args);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("~/mycelial/rotate <mission-id>");
  }
  expect((await invoke(["../escape", "--dry-run"])).code).toBe(1);
  expect((await invoke(["mission", "--yes"])).code).toBe(1);
  expect(
    (await invoke(["--mission-dir", join(root, "absent"), "--dry-run"])).code
  ).toBe(1);
  expect(await snapshot()).toEqual(before);
});

test("native ID lookup uses default then global JSONC config, ignores caller overlays and preserves dry-run/refusal safety", async () => {
  const defaults = await initializeMission(nodeFileSystem, {
    mission: "default-mission",
    roles: ["builder"],
    cwd,
    sessionDirectory: join(root, "default-sessions"),
    config: {
      ...DEFAULT_CONFIG,
      missionRoot: join(home, "mycelial", "missions"),
    },
  });
  let before = await snapshot();
  const defaultRun = await invoke([
    "default-mission",
    "--dry-run",
    "--save-history",
  ]);
  expect(defaultRun.code).toBe(0);
  expect(defaultRun.stdout).toContain(
    "Mission: default-mission; participants: 2"
  );
  expect(defaultRun.stdout).toContain(join(root, "default-sessions"));
  expect(await snapshot()).toEqual(before);

  const globalRoot = join(home, "configured-missions");
  const configured = await initializeMission(nodeFileSystem, {
    mission: "configured",
    roles: ["builder", "reviewer"],
    cwd,
    sessionDirectory: join(root, "configured-sessions"),
    config: { ...DEFAULT_CONFIG, missionRoot: globalRoot },
  });
  const configDirectory = join(root, "config", "pi-extensions", "mycelial");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, "settings.jsonc"),
    `{
    // Existing global loader owns JSONC and home expansion.
    "missionRoot": "~/configured-missions",
    "$piExtensionKit": { "projectOverlays": [{
      "when": { "path": ${JSON.stringify(cwd)} },
      "config": { "missionRoot": "/must-not-use-central-overlay" }
    }] },
  }`
  );
  before = await snapshot();
  const byId = await invoke(["configured", "--dry-run", "--save-history"]);
  const byDirectory = await invoke([
    "--mission-dir",
    configured.directory,
    "--dry-run",
    "--save-history",
  ]);
  expect(byId.code).toBe(0);
  expect(byId.stdout).toContain("Mission: configured; participants: 3");
  expect(byId.stdout).toContain("configured: builder — ");
  expect(byId.stdout).toContain("configured: coordinator — ");
  expect(byId.stdout).toContain("configured: reviewer — ");
  expect(byId.stdout).toContain("Dry run only; nothing changed.");
  expect(byId.stdout).toBe(byDirectory.stdout);
  // Explicit directories do not depend on the configured missionRoot.
  expect(
    (
      await invoke([
        "--mission-dir",
        defaults.directory,
        "--dry-run",
        "--save-history",
      ])
    ).code
  ).toBe(0);
  for (const policy of [[], ["--save-history"], ["--recover"]]) {
    const refused = await invoke(["configured", ...policy]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("interactive operator TTY");
  }
  expect(await snapshot()).toEqual(before);
});
