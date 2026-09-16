import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionFiles, ExtensionLogger } from "pi-extension-kit/files";
import { loadConfig } from "./config";
import type { FileSystem } from "./filesystem";
import { nodeFileSystem } from "./filesystem";
import { ValidationError } from "./identifiers";
import {
  defaultRepoAlias,
  type InitializedMission,
  initializeMission,
} from "./mission-init";

export interface InitCommand {
  action: "init";
  mission: string;
  roles: string[];
  repos?: string[];
  source?: string;
}

export type MycelialCommand = { action: "help" } | InitCommand;

export function parseMycelialCommand(input: string): MycelialCommand {
  const words = tokenize(input.trim());
  if (words.length === 0 || words[0] === "help" || words[0] === "--help")
    return { action: "help" };
  if (words[0] !== "init")
    throw new ValidationError(`Unknown /mycelial action: ${words[0]}`);
  const mission = words[1];
  if (!mission || mission.startsWith("--"))
    throw new ValidationError(
      "Usage: /mycelial init <mission-id> --roles <role,...> [--from <draft.md>] [--repos <alias,...>]"
    );

  let roles: string[] | undefined;
  let repos: string[] | undefined;
  let source: string | undefined;
  for (let index = 2; index < words.length; index++) {
    const option = words[index];
    const value = words[index + 1];
    if (!value || value.startsWith("--"))
      throw new ValidationError(`Missing value for ${option}`);
    if (option === "--roles") {
      if (roles)
        throw new ValidationError("--roles may be specified only once");
      roles = commaList(value, "roles");
    } else if (option === "--repos") {
      if (repos)
        throw new ValidationError("--repos may be specified only once");
      repos = commaList(value, "repos");
    } else if (option === "--from") {
      if (source)
        throw new ValidationError("--from may be specified only once");
      source = value;
    } else {
      throw new ValidationError(`Unknown /mycelial init option: ${option}`);
    }
    index++;
  }
  if (!roles)
    throw new ValidationError("/mycelial init requires --roles <role,...>");
  return {
    action: "init",
    mission,
    roles,
    ...(repos === undefined ? {} : { repos }),
    ...(source === undefined ? {} : { source }),
  };
}

export async function runMycelialCommand(
  input: string,
  ctx: ExtensionCommandContext,
  files: ExtensionFiles,
  logger: ExtensionLogger,
  fs: FileSystem = nodeFileSystem
): Promise<void> {
  const command = parseMycelialCommand(input);
  if (command.action === "help") {
    notify(
      ctx,
      "Usage: /mycelial init <mission-id> --roles <role,...> [--from <draft.md>] [--repos <alias,...>]",
      "info"
    );
    return;
  }

  try {
    const config = await loadConfig(files);
    const inferredRepo = defaultRepoAlias(ctx.cwd);
    const result = await initializeMission(fs, {
      mission: command.mission,
      roles: command.roles,
      repos:
        command.repos ?? (inferredRepo === undefined ? [] : [inferredRepo]),
      source: command.source,
      cwd: ctx.cwd,
      config,
    });
    await logger.info("mission initialized", {
      mission: result.mission,
      directory: result.directory,
    });
    notify(ctx, formatInitializedMission(result), "info");
  } catch (error) {
    await logger.error("mission initialization failed", error);
    notify(
      ctx,
      `Mycelial initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    throw error;
  }
}

export function formatInitializedMission(result: InitializedMission): string {
  return [
    `Mission created: ${result.mission}`,
    `Mission: ${result.missionFile}`,
    `Agents: ${result.agentsFile}`,
    `Repositories: ${result.reposFile}`,
    `Launcher: ${result.launcherFile}`,
    `Project shortcut: ${result.projectLauncherLink}`,
    `Run from Herdr: ${result.projectLauncherLink}`,
  ].join("\n");
}

function notify(
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "error"
): void {
  if (ctx.hasUI) ctx.ui.notify(message, level);
}

function commaList(value: string, label: string): string[] {
  const entries = value.split(",").map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0))
    throw new ValidationError(`${label} must be a comma-separated list`);
  return entries;
}

function tokenize(input: string): string[] {
  if (input.length === 0) return [];
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let started = false;
  for (const character of input) {
    if (escaping) {
      current += character;
      escaping = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += character;
    started = true;
  }
  if (escaping || quote)
    throw new ValidationError(
      "Unterminated quote or escape in /mycelial command"
    );
  if (started) words.push(current);
  return words;
}
