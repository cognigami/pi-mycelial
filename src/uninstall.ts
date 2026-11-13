import { lstat, realpath, rm, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { createExtensionFiles } from "pi-extension-kit/files";
import { loadConfig } from "./config";
import { ValidationError } from "./identifiers";
import { requireOperatorShell } from "./rotation-cli";

export const UNINSTALL_HELP = `Usage: ~/mycelial/uninstall [--help]

Stop all Mycelial agents first, then run from an independent interactive shell.
Removes the installed extension/skill, package link, state/logs/cache, rotate,
and this uninstaller. Configuration and the configured missionRoot are each
optional deletions; press Enter to keep them. No unattended --yes option.

Uses PI_CODING_AGENT_DIR and the same PI_EXTENSIONS_*/XDG_* paths as Mycelial.
Use the same environment as installation. Shared extension-kit, Pi conversation
history, source checkouts, repository launchers and AGENTS.md are left alone.
Reinstall from the source checkout with just install, then restart Pi.
`;

interface Removal {
  path: string;
  kind: "directory" | "file" | "link";
}
export interface UninstallPlan {
  automatic: Removal[];
  configDirectory: string;
  missionDirectory?: string;
  installDirectory: string;
  protectedPaths: string[];
  warnings: string[];
}
export interface UninstallOperator {
  confirm(question: string): Promise<boolean>;
  report(message: string): void;
}

/** Resolve data before asking to remove config; never guess after a config error. */
export async function planUninstall(
  options: {
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    installDirectory?: string;
  } = {}
): Promise<UninstallPlan> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const expand = (path: string) =>
    resolve(path === "~" ? homeDir : path.replace(/^~(?=\/)/, homeDir));
  const agentDir = expand(
    env.PI_CODING_AGENT_DIR ?? join(homeDir, ".pi", "agent")
  );
  const installDirectory = resolve(
    options.installDirectory ??
      (basename(process.execPath) === "uninstall"
        ? dirname(process.execPath)
        : join(homeDir, "mycelial"))
  );
  const files = createExtensionFiles({
    extensionName: "mycelial",
    env,
    homeDir,
    includeProjectConfig: false,
  });
  const { configDir, stateDir, cacheDir } = files.paths;
  const warnings: string[] = [];
  let missionDirectory: string | undefined;
  try {
    missionDirectory = (await loadConfig(files)).missionRoot;
  } catch (error) {
    warnings.push(
      `Cannot resolve missionRoot; mission data will be kept: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    automatic: [
      {
        path: join(agentDir, "managed-extensions", "node_modules", "mycelial"),
        kind: "link",
      },
      {
        path: join(agentDir, "managed-extensions", "mycelial"),
        kind: "directory",
      },
      { path: stateDir, kind: "directory" },
      { path: cacheDir, kind: "directory" },
      { path: join(installDirectory, "rotate"), kind: "file" },
      // Last: keep the uninstaller available if any earlier removal fails.
      { path: join(installDirectory, "uninstall"), kind: "file" },
    ],
    configDirectory: configDir,
    missionDirectory,
    installDirectory,
    protectedPaths: [
      homeDir,
      agentDir,
      installDirectory,
      process.cwd(),
      dirname(configDir),
      dirname(stateDir),
      dirname(cacheDir),
      join(agentDir, "managed-extensions"),
    ],
    warnings,
  };
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonicalPath(parent), basename(path));
  }
}
function contains(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return (
    suffix === "" ||
    (suffix !== ".." &&
      !suffix.startsWith(`..${sep}`) &&
      !suffix.startsWith(sep))
  );
}
async function entry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Validate the whole selection before any deletion, including retained-data overlaps. */
async function validateRemovals(
  plan: UninstallPlan,
  removals: Removal[],
  retained: string[]
): Promise<void> {
  const protectedPaths = await Promise.all(
    plan.protectedPaths.map(canonicalPath)
  );
  const kept = await Promise.all(retained.map(canonicalPath));
  for (const removal of removals) {
    const info = await entry(removal.path);
    if (!info) continue;
    if (removal.kind === "link" && !info.isSymbolicLink())
      throw new ValidationError(
        `Refusing unexpected non-symlink package link: ${removal.path}`
      );
    if (removal.kind === "file" && !info.isFile() && !info.isSymbolicLink())
      throw new ValidationError(
        `Refusing unexpected non-file executable: ${removal.path}`
      );
    const path = await canonicalPath(removal.path);
    if (
      removal.kind === "directory" &&
      protectedPaths.some((protectedPath) => contains(path, protectedPath))
    )
      throw new ValidationError(
        `Refusing broad or shared removal path: ${removal.path}`
      );
    if (
      kept.some(
        (keptPath) => contains(path, keptPath) || contains(keptPath, path)
      )
    )
      throw new ValidationError(
        `Removal overlaps data you chose to keep: ${removal.path}`
      );
  }
}

export async function uninstall(
  plan: UninstallPlan,
  operator: UninstallOperator
): Promise<boolean> {
  for (const warning of plan.warnings) operator.report(`WARNING: ${warning}`);
  operator.report(
    `Installed artifacts to remove:\n${plan.automatic.map(({ path }) => `  ${path}`).join("\n")}`
  );
  operator.report(
    "Shared extension-kit, source checkouts, Pi conversations and repository files will be kept."
  );
  if (
    !(await operator.confirm(
      "Have you stopped all Mycelial agents and want to uninstall Mycelial?"
    ))
  )
    return false;
  const removeConfig = await operator.confirm(
    `Permanently delete configuration at ${plan.configDirectory}?`
  );
  const removeMissions =
    plan.missionDirectory !== undefined &&
    (await operator.confirm(
      `Permanently delete ALL mission data at ${plan.missionDirectory}? Repository launcher symlinks will be left dangling.`
    ));
  const optional: Removal[] = [];
  const retained: string[] = [];
  if (removeConfig)
    optional.push({ path: plan.configDirectory, kind: "directory" });
  else retained.push(plan.configDirectory);
  if (plan.missionDirectory) {
    if (removeMissions)
      optional.push({ path: plan.missionDirectory, kind: "directory" });
    else retained.push(plan.missionDirectory);
  }
  const removals = [...optional, ...plan.automatic];
  await validateRemovals(plan, removals, retained);
  for (const removal of removals) {
    await rm(removal.path, {
      recursive: removal.kind === "directory",
      force: true,
    });
    operator.report(`Removed: ${removal.path}`);
  }
  for (const path of retained) operator.report(`Kept: ${path}`);
  // Do not remove missions or unrelated files just to tidy the install directory.
  try {
    await rmdir(plan.installDirectory);
  } catch (error) {
    if (
      !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
        (error as NodeJS.ErrnoException).code ?? ""
      )
    )
      throw error;
  }
  operator.report(
    "Mycelial uninstalled. Restart Pi. Reinstall with just install from the source checkout."
  );
  return true;
}

export async function runUninstall(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(UNINSTALL_HELP);
    return 0;
  }
  if (args.length)
    throw new ValidationError(`Unknown uninstall option: ${args.join(" ")}`);
  // Reuse the rotation CLI's independent, interactive operator boundary.
  requireOperatorShell(
    process.env,
    !!process.stdin.isTTY && !!process.stdout.isTTY,
    "Uninstall"
  );
  const plan = await planUninstall();
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Uninstall cancelled"));
  const close = () => {
    if (!controller.signal.aborted) cancel();
  };
  process.on("SIGINT", cancel);
  terminal.on("SIGINT", cancel);
  terminal.on("close", close);
  try {
    await uninstall(plan, {
      confirm: async (question) => {
        controller.signal.throwIfAborted();
        const answer = await terminal.question(
          `${question}\nType yes to confirm [default: no]: `,
          { signal: controller.signal }
        );
        controller.signal.throwIfAborted();
        return answer.trim().toLowerCase() === "yes";
      },
      report: console.log,
    });
    return 0;
  } finally {
    process.off("SIGINT", cancel);
    terminal.close();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runUninstall(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
