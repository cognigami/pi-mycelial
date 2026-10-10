import { join } from "node:path";
import { createExtensionFiles } from "pi-extension-kit/files";
import { loadConfig } from "./config";
import { missionId, ValidationError } from "./identifiers";
import { parseRotationArgs, runRotationCli } from "./rotation-cli";

export const ROTATE_HELP = `Usage:
  ~/mycelial/rotate <mission-id> [--dry-run] [--save-history] [--recover]
  ~/mycelial/rotate --mission-dir /absolute/path [--dry-run] [--save-history] [--recover]
  ~/mycelial/rotate --help

Mission IDs use the global Mycelial missionRoot setting (default: ~/mycelial/missions).
Recovery uses the recorded policy and cannot be combined with --dry-run or --save-history.
Mutation requires an independent interactive operator shell and explicit confirmation.
`;

/** Resolve only the installed CLI's mission-ID shorthand; rotation owns all policy parsing. */
export async function resolveInstalledRotationArgs(
  args: readonly string[]
): Promise<string[]> {
  const flags: string[] = [];
  let id: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] as string;
    if (argument === "--mission-dir") {
      flags.push(argument, args[++index] as string);
    } else if (argument.startsWith("--")) {
      flags.push(argument);
    } else {
      if (id !== undefined)
        throw new ValidationError("Expected one mission ID");
      id = missionId(argument);
    }
  }
  if (id === undefined) {
    parseRotationArgs(flags);
    return flags;
  }
  if (flags.includes("--mission-dir"))
    throw new ValidationError(
      "Use either a mission ID or --mission-dir, not both"
    );
  // Reject unsupported policies before reading config. The existing strict parser
  // remains authoritative; this placeholder is never passed to rotation.
  parseRotationArgs(["--mission-dir", "/unused", ...flags]);
  const config = await loadConfig(
    createExtensionFiles({
      extensionName: "mycelial",
      includeProjectConfig: false,
    })
  );
  return ["--mission-dir", join(config.missionRoot, id), ...flags];
}

export async function runInstalledRotation(args: string[]): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    console.log(ROTATE_HELP);
    return 0;
  }
  return runRotationCli(await resolveInstalledRotationArgs(args));
}

if (import.meta.main) {
  try {
    process.exitCode = await runInstalledRotation(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
