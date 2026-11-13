import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { planUninstall, type UninstallPlan, uninstall } from "./uninstall";

async function fixture() {
  const root = await mkdtemp(resolve("node_modules/.mycelial-uninstall-"));
  const homeDir = join(root, "home");
  const env = {
    PI_CODING_AGENT_DIR: join(root, "isolated-agent"),
    PI_EXTENSIONS_CONFIG_HOME: join(root, "config"),
    PI_EXTENSIONS_STATE_HOME: join(root, "state"),
    PI_EXTENSIONS_CACHE_HOME: join(root, "cache"),
  };
  const configDirectory = join(env.PI_EXTENSIONS_CONFIG_HOME, "mycelial");
  const missionDirectory = join(root, "custom-missions");
  const installDirectory = join(homeDir, "mycelial");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, "10-main.jsonc"),
    JSON.stringify({ missionRoot: missionDirectory })
  );
  const plan = await planUninstall({ env, homeDir, installDirectory });
  for (const removal of plan.automatic) {
    await mkdir(dirname(removal.path), { recursive: true });
    if (removal.kind === "directory") {
      await mkdir(removal.path, { recursive: true });
      await writeFile(join(removal.path, "installed"), "artifact");
    } else if (removal.kind === "link") {
      await symlink(
        join(env.PI_CODING_AGENT_DIR, "managed-extensions", "mycelial"),
        removal.path
      );
    } else await writeFile(removal.path, "executable");
  }
  await mkdir(missionDirectory);
  await writeFile(join(missionDirectory, "mail"), "durable data");
  const shared = join(
    env.PI_CODING_AGENT_DIR,
    "extensions",
    "extension-kit.js"
  );
  await mkdir(dirname(shared), { recursive: true });
  await writeFile(shared, "shared loader");
  const runtime = join(
    env.PI_CODING_AGENT_DIR,
    "managed-extensions",
    "node_modules",
    "pi-extension-kit"
  );
  await mkdir(runtime);
  await writeFile(join(runtime, "package.json"), "{}");
  const conversation = join(
    env.PI_CODING_AGENT_DIR,
    "sessions",
    "conversation.jsonl"
  );
  await mkdir(dirname(conversation), { recursive: true });
  await writeFile(conversation, "history");
  return { root, homeDir, env, plan, shared, runtime, conversation };
}
function operator(answers: boolean[]) {
  const questions: string[] = [];
  const messages: string[] = [];
  return {
    questions,
    messages,
    confirm: async (question: string) => {
      questions.push(question);
      if (answers.length === 0) throw new Error("Unexpected question");
      return answers.shift() as boolean;
    },
    report: (message: string) => {
      messages.push(message);
    },
  };
}
async function missing(path: string) {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}

test.each(
  [false, true].flatMap((config) =>
    [false, true].map((missions) => ({ config, missions }))
  )
)(
  "uninstall removes artifacts, config=$config missions=$missions; keeps shared resources",
  async ({ config, missions }) => {
    const f = await fixture();
    try {
      const op = operator([true, config, missions]);
      expect(await uninstall(f.plan, op)).toBe(true);
      expect(op.questions).toHaveLength(3);
      expect(op.questions[2]).toContain(f.plan.missionDirectory as string);
      for (const { path } of f.plan.automatic) await missing(path);
      if (config) await missing(f.plan.configDirectory);
      else
        expect(await readdir(f.plan.configDirectory)).toEqual([
          "10-main.jsonc",
        ]);
      if (missions) await missing(f.plan.missionDirectory as string);
      else
        expect(
          await readFile(
            join(f.plan.missionDirectory as string, "mail"),
            "utf8"
          )
        ).toBe("durable data");
      expect(await readFile(f.shared, "utf8")).toBe("shared loader");
      expect(await readFile(join(f.runtime, "package.json"), "utf8")).toBe(
        "{}"
      );
      expect(await readFile(f.conversation, "utf8")).toBe("history");
      await missing(f.plan.installDirectory);
      // Partial/missing installations and an already-removed executable are fine.
      expect(await uninstall(f.plan, operator([true, config, missions]))).toBe(
        true
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
);

test("declined uninstall and interrupted prompts change nothing", async () => {
  const f = await fixture();
  try {
    expect(await uninstall(f.plan, operator([false]))).toBe(false);
    const op = operator([true, true]);
    await expect(uninstall(f.plan, op)).rejects.toThrow("Unexpected question");
    for (const { path } of f.plan.automatic)
      expect(await lstat(path)).toBeDefined();
    expect(await readdir(f.plan.configDirectory)).toEqual(["10-main.jsonc"]);
    expect(
      await readFile(join(f.plan.missionDirectory as string, "mail"), "utf8")
    ).toBe("durable data");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("retained mission storage inside automatic state/cache artifacts prevents all deletion", async () => {
  const f = await fixture();
  try {
    f.plan.missionDirectory = join(f.plan.automatic[2]?.path, "missions");
    await mkdir(f.plan.missionDirectory);
    await expect(
      uninstall(f.plan, operator([true, true, false]))
    ).rejects.toThrow("overlaps data you chose to keep");
    expect(await lstat(f.plan.configDirectory)).toBeDefined();
    expect(await lstat(f.plan.automatic[0]?.path)).toBeDefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("broad mission paths, symlink aliases and config/missions overlap are refused before deletion", async () => {
  const f = await fixture();
  try {
    for (const broad of [
      "/",
      homedir(),
      f.homeDir,
      f.root,
      f.plan.installDirectory,
    ]) {
      const plan = { ...f.plan, missionDirectory: broad };
      // homedir need not contain fixture paths on every host; explicitly protect it.
      plan.protectedPaths = [...plan.protectedPaths, homedir()];
      await expect(
        uninstall(plan, operator([true, false, true]))
      ).rejects.toThrow();
    }
    const alias = join(f.root, "alias");
    await symlink(f.homeDir, alias);
    await expect(
      uninstall(
        { ...f.plan, missionDirectory: alias },
        operator([true, false, true])
      )
    ).rejects.toThrow("broad or shared");
    const nested: UninstallPlan = {
      ...f.plan,
      missionDirectory: dirname(f.plan.configDirectory),
    };
    await expect(
      uninstall(nested, operator([true, false, true]))
    ).rejects.toThrow();
    for (const { path } of f.plan.automatic)
      expect(await lstat(path)).toBeDefined();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("unexpected package directory refuses uninstall; unrelated files in install directory are retained", async () => {
  const f = await fixture();
  try {
    const link = f.plan.automatic[0]?.path;
    await rm(link);
    await mkdir(link);
    await expect(
      uninstall(f.plan, operator([true, false, false]))
    ).rejects.toThrow("non-symlink package link");
    expect(
      await lstat(join(f.plan.installDirectory, "uninstall"))
    ).toBeDefined();
    await rm(link, { recursive: true });
    const unrelated = join(f.plan.installDirectory, "notes.md");
    await writeFile(unrelated, "keep");
    await uninstall(f.plan, operator([true, false, false]));
    expect(await readFile(unrelated, "utf8")).toBe("keep");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("invalid config preserves unknown mission storage but does not prevent artifact uninstall", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.plan.configDirectory, "10-main.jsonc"), "{invalid");
    const plan = await planUninstall({
      env: f.env,
      homeDir: f.homeDir,
      installDirectory: f.plan.installDirectory,
    });
    expect(plan.missionDirectory).toBeUndefined();
    expect(plan.warnings[0]).toContain("mission data will be kept");
    const op = operator([true, true]);
    await uninstall(plan, op);
    expect(op.questions).toHaveLength(2);
    await missing(f.plan.configDirectory);
    expect(
      await readFile(join(f.plan.missionDirectory as string, "mail"), "utf8")
    ).toBe("durable data");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("planning uses kit XDG paths and global config rather than project config", async () => {
  const f = await fixture();
  try {
    expect(f.plan.missionDirectory).toBe(join(f.root, "custom-missions"));
    expect(f.plan.automatic[1]?.path).toBe(
      join(f.env.PI_CODING_AGENT_DIR, "managed-extensions", "mycelial")
    );
    const plan = await planUninstall({
      homeDir: f.homeDir,
      env: {
        XDG_CONFIG_HOME: join(f.root, "xdg-config"),
        XDG_STATE_HOME: join(f.root, "xdg-state"),
        XDG_CACHE_HOME: join(f.root, "xdg-cache"),
      },
    });
    expect(plan.configDirectory).toBe(
      join(f.root, "xdg-config", "pi-extensions", "mycelial")
    );
    expect(plan.automatic[2]?.path).toBe(
      join(f.root, "xdg-state", "pi-extensions", "mycelial")
    );
    expect(plan.automatic[3]?.path).toBe(
      join(f.root, "xdg-cache", "pi-extensions", "mycelial")
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("installed compiled uninstaller works without runtime dependencies; recipes restore both executables", async () => {
  const f = await fixture();
  const exec = promisify(execFile);
  try {
    const checkout = join(f.root, "checkout");
    const output = join(checkout, "cli-dist", "uninstall");
    await mkdir(dirname(output), { recursive: true });
    await exec(process.execPath, [
      "build",
      "--compile",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      resolve("src/uninstall.ts"),
      "--outfile",
      output,
    ]);
    await writeFile(
      join(checkout, "Justfile"),
      await readFile(resolve("Justfile"))
    );
    await writeFile(
      join(checkout, "cli-dist", "rotate"),
      "#!/bin/sh\nexit 0\n"
    );
    const installed = join(f.plan.installDirectory, "uninstall");
    const env = { ...process.env, ...f.env, HOME: f.homeDir };
    for (let iteration = 0; iteration < 2; iteration++) {
      for (const recipe of ["install-rotate", "install-uninstall"]) {
        await exec("just", ["--justfile", join(checkout, "Justfile"), recipe], {
          env,
        });
      }
      const help = await exec(installed, ["--help"], { cwd: f.homeDir, env });
      expect(help.stdout).toContain("Usage: ~/mycelial/uninstall");
      expect((await lstat(installed)).mode & 0o111).toBe(0o111);
      expect(
        (await lstat(join(f.plan.installDirectory, "rotate"))).mode & 0o111
      ).toBe(0o111);
      await expect(
        exec(installed, [], { cwd: f.homeDir, env })
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Uninstall requires an interactive operator TTY"
        ),
      });
      // In-process test operator only touches the isolated fixture paths.
      await uninstall(f.plan, operator([true, false, false]));
      await missing(installed);
    }
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test.each([
  { args: ["--yes"], error: "Unknown uninstall option" },
  { args: ["--help", "--yes"], error: "Unknown uninstall option" },
  { args: [], error: "Uninstall requires an interactive operator TTY" },
])(
  "CLI refuses $args without prompts or filesystem changes",
  async ({ args, error }) => {
    const f = await fixture();
    try {
      // execFile uses pipes, never the operator's terminal. Isolate all data paths
      // as well: CLI tests must not inherit the runner's home or Pi environment.
      await expect(
        promisify(execFile)(
          process.execPath,
          [resolve("src/uninstall.ts"), ...args],
          {
            cwd: f.homeDir,
            env: { ...f.env, HOME: f.homeDir, PATH: process.env.PATH },
            timeout: 2_000,
          }
        )
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(error),
      });
      for (const { path } of f.plan.automatic)
        expect(await lstat(path)).toBeDefined();
      expect(await readdir(f.plan.configDirectory)).toEqual(["10-main.jsonc"]);
      expect(
        await readFile(join(f.plan.missionDirectory as string, "mail"), "utf8")
      ).toBe("durable data");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
);
