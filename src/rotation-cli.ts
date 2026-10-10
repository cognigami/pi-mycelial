import { basename, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { nodeFileSystem } from "./filesystem";
import { ValidationError } from "./identifiers";
import {
  preflightRotation,
  type RotationInput,
  type RotationOperator,
  type RotationReport,
  recoverRotation,
  rotateMission,
} from "./mission-rotation";
import { absolutePath } from "./rotation-paths";

export interface RotationCliOptions extends RotationInput {
  dryRun: boolean;
  recover: boolean;
}
export function parseRotationArgs(args: readonly string[]): RotationCliOptions {
  const options: RotationCliOptions = {
    missionDirectory: "",
    dryRun: false,
    recover: false,
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index] as string;
    if (seen.has(flag)) throw new ValidationError(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--mission-dir")
      options.missionDirectory = absolutePath(args[++index]);
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--save-history") options.saveHistory = true;
    else if (flag === "--recover") options.recover = true;
    else throw new ValidationError(`Unknown rotation option: ${flag}`);
  }
  absolutePath(options.missionDirectory);
  if (options.recover && (options.dryRun || options.saveHistory))
    throw new ValidationError(
      "Recovery uses the recorded policy; --dry-run/--save-history cannot alter it"
    );
  return options;
}
export function formatRotationReport(
  report: RotationReport,
  dryRun = false
): string {
  const managedNames = new Map(
    Object.values(report.mission?.sessions?.sessions ?? {}).map((session) => [
      session.sessionFile,
      session.name,
    ])
  );
  const familyByPath = new Map(report.family.map((file) => [file.path, file]));
  const descendants = report.family.filter(
    (file) => !managedNames.has(file.path)
  ).length;
  const lines = [
    `Mission: ${report.missionId}; participants: ${report.roles.length}; descendants: ${descendants}`,
    `Discovery roots:\n${report.roots.map((path) => `  ${path}`).join("\n")}`,
    `${report.retention ? "Retain" : "Delete LAST"}: ${report.family.length} verified old session files (descendants first)`,
  ];
  let previousDirectory: string | undefined;
  for (const file of report.family) {
    const directory = dirname(file.path);
    if (directory !== previousDirectory) {
      lines.push(`Sessions in ${directory}:`);
      previousDirectory = directory;
    }
    let label = managedNames.get(file.path);
    if (!label) {
      // Discovery already guarantees that each descendant reaches a managed
      // session. Use that known name rather than scanning transcript bodies.
      let parent = file.header.parentSession;
      while (parent) {
        const name = managedNames.get(parent);
        if (name) {
          label = `Descendant of ${name}`;
          break;
        }
        parent = familyByPath.get(parent)?.header.parentSession;
      }
    }
    lines.push(`  ${label ?? "Session"} — ${basename(file.path)}`);
  }
  lines.push(
    ...report.warnings.map((warning) => `WARNING: ${warning}`),
    ...report.discoveryProblems.map(
      (problem) => `DISCOVERY INCOMPLETE: ${problem}`
    ),
    ...report.refusals.map((refusal) => `REFUSED: ${refusal}`)
  );
  if (dryRun)
    lines.push(
      "Dry run only; nothing changed. A real run repeats preflight and requires confirmed downtime."
    );
  return lines.join("\n");
}
export function requireOperatorShell(
  env: NodeJS.ProcessEnv,
  tty: boolean
): void {
  if (!tty)
    throw new ValidationError(
      "Rotation/recovery requires an interactive operator TTY; no unattended confirmation bypass"
    );
  if (
    env.PI_CODING_AGENT === "true" ||
    env.AI_AGENT === "pi" ||
    env.PI_SESSION_ID ||
    env.PI_SESSION_FILE
  )
    throw new ValidationError(
      "Run rotation from an independent operator control shell, not a Pi agent shell tool"
    );
}

export async function runRotationCli(args: string[]): Promise<number> {
  const options = parseRotationArgs(args);
  if (options.dryRun) {
    const report = await preflightRotation(nodeFileSystem, options);
    console.log(formatRotationReport(report, true));
    return report.refusals.length ? 1 : 0;
  }
  requireOperatorShell(
    process.env,
    !!process.stdin.isTTY && !!process.stdout.isTTY
  );
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Operator cancelled"));
  process.on("SIGINT", cancel);
  const operator: RotationOperator = {
    confirm: async (question) => {
      if (controller.signal.aborted) return false;
      try {
        return (
          (
            await terminal.question(`${question}\nType yes to confirm: `, {
              signal: controller.signal,
            })
          ).trim() === "yes"
        );
      } catch {
        return false;
      }
    },
    report: (report) => console.log(formatRotationReport(report)),
    phase: (phase) => console.log(`Phase: ${phase}`),
    signal: controller.signal,
  };
  try {
    const result = await (options.recover ? recoverRotation : rotateMission)(
      nodeFileSystem,
      options,
      operator
    );
    console.log(`Rotation: ${result.state}`);
    if (result.error) console.error(result.error);
    for (const path of result.remaining) console.error(`Remaining: ${path}`);
    return result.state === "committed" || result.state === "cancelled" ? 0 : 1;
  } finally {
    process.off("SIGINT", cancel);
    terminal.close();
  }
}
if (import.meta.main) {
  try {
    process.exitCode = await runRotationCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
