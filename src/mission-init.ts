import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { publishImmutable } from "./atomic-files";
import type { MycelialConfig } from "./config";
import type { FileSystem } from "./filesystem";
import { isExists, isMissing } from "./filesystem";
import { missionId, repoAlias, roleId, ValidationError } from "./identifiers";

export interface InitializeMissionInput {
  mission: unknown;
  roles: unknown[];
  repos?: unknown[];
  source?: string;
  includeCoordinator?: boolean;
  cwd: string;
  config: MycelialConfig;
}

export interface InitializedMission {
  mission: string;
  directory: string;
  missionFile: string;
  agentsFile: string;
  reposFile: string;
  launcherFile: string;
  projectLauncherLink: string;
  repositoryGuidanceFile: string;
  repositoryGuidanceCreated: boolean;
}

export async function initializeMission(
  fs: FileSystem,
  input: InitializeMissionInput
): Promise<InitializedMission> {
  const id = missionId(input.mission);
  const requestedRoles = input.roles.map(roleId);
  if (
    requestedRoles.length === 0 ||
    new Set(requestedRoles).size !== requestedRoles.length
  )
    throw new ValidationError("Mission roles must be non-empty and unique");
  const coordinator = roleId("coordinator");
  const roles =
    input.includeCoordinator === false || requestedRoles.includes(coordinator)
      ? requestedRoles
      : [coordinator, ...requestedRoles];
  const repos = (input.repos ?? []).map(repoAlias);
  if (new Set(repos).size !== repos.length)
    throw new ValidationError("Mission repository aliases must be unique");

  const missionRoot = resolve(input.config.missionRoot);
  const directory = resolve(missionRoot, id);
  if (!directory.startsWith(`${missionRoot}${sep}`))
    throw new ValidationError("Mission directory escapes mission root");
  const cwd = resolve(input.cwd);
  const missionFile = resolve(directory, "mission.md");
  const agentsFile = resolve(directory, "agents.json");
  const reposFile = resolve(directory, "repos.json");
  const launcherFile = resolve(directory, "launch-herdr.sh");
  const projectLauncherLink = resolve(cwd, `launch-mycelial-${id}.sh`);
  const repositoryGuidanceFile = resolve(cwd, "AGENTS.md");
  await requireAbsent(fs, projectLauncherLink, "Project launcher link");
  const missionBody = await missionDocument(fs, input, id, roles);
  const launcher = renderHerdrLauncher({
    missionId: id,
    missionDirectory: directory,
    repositoryRoot: cwd,
  });

  await fs.mkdir(missionRoot, { recursive: true, mode: 0o700 });
  let created = false;
  let linked = false;
  let repositoryGuidanceCreated = false;
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (isExists(error))
      throw new ValidationError(`Mission already exists: ${directory}`);
    throw error;
  }

  try {
    try {
      const guidanceStat = await fs.lstat(repositoryGuidanceFile);
      if (!guidanceStat.isFile() || guidanceStat.isSymbolicLink())
        throw new ValidationError(
          `Repository AGENTS.md is not a regular file: ${repositoryGuidanceFile}`
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
      const result = await publishImmutable(
        fs,
        repositoryGuidanceFile,
        Buffer.from(repositoryGuidanceTemplate())
      );
      repositoryGuidanceCreated = result === "created";
    }
    await publishImmutable(fs, missionFile, Buffer.from(missionBody));
    await publishImmutable(
      fs,
      agentsFile,
      Buffer.from(`${JSON.stringify({ agents: roles }, null, 2)}\n`)
    );
    await publishImmutable(
      fs,
      reposFile,
      Buffer.from(`${JSON.stringify({ repos }, null, 2)}\n`)
    );
    await publishImmutable(fs, launcherFile, Buffer.from(launcher));
    await fs.chmod(launcherFile, 0o700);
    await fs.symlink(launcherFile, projectLauncherLink);
    linked = true;
    await fs.syncDirectory(cwd);
  } catch (error) {
    if (linked)
      try {
        await fs.unlink(projectLauncherLink);
      } catch {}
    if (repositoryGuidanceCreated)
      try {
        await fs.unlink(repositoryGuidanceFile);
      } catch {}
    if (created) await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    mission: id,
    directory,
    missionFile,
    agentsFile,
    reposFile,
    launcherFile,
    projectLauncherLink,
    repositoryGuidanceFile,
    repositoryGuidanceCreated,
  };
}

async function requireAbsent(
  fs: FileSystem,
  path: string,
  label: string
): Promise<void> {
  try {
    await fs.lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new ValidationError(`${label} already exists: ${path}`);
}

async function missionDocument(
  fs: FileSystem,
  input: InitializeMissionInput,
  id: string,
  roles: readonly string[]
): Promise<string> {
  if (input.source === undefined) return missionTemplate(id, roles);
  const source = resolve(input.cwd, input.source);
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ValidationError(
      `Source artifact is not a regular file: ${source}`
    );
  const content = await fs.readFile(source);
  if (content.byteLength > input.config.readMaxBytes)
    throw new ValidationError(
      `Source artifact exceeds ${input.config.readMaxBytes} bytes`
    );
  return missionTemplate(id, roles, sourceReference(input.cwd, source));
}

function missionTemplate(
  id: string,
  roles: readonly string[],
  source?: string
): string {
  const goal = source
    ? `Deliver the bounded outcome described by the approved source artifact \`${markdownCode(source)}\`.`
    : "Describe the bounded mission outcome.";
  const artifacts = [
    "- Repository `AGENTS.md`",
    ...(source === undefined
      ? []
      : [`- Approved source artifact: \`${markdownCode(source)}\``]),
  ];
  const hasCoordinator = roles.includes("coordinator");
  const coordination = hasCoordinator
    ? [
        "- The coordinator decomposes the mission and its canonical artifacts into independently claimable requests, sends those requests through Mycelial, tracks blockers, and accepts final results.",
        "- Other roles acknowledge and claim a request before working, then report results and validation through the original thread before releasing the claim.",
        "- Durable send and reply automatically attempt to wake delivered recipients. Use `agent_wake` only to retry a notification failure reported by those tools.",
      ]
    : [
        "- This mission has no designated coordinator; roles must create explicit durable requests before starting independently claimable work.",
        "- A role acknowledges and claims a request before working, then reports results and validation through the original thread before releasing the claim.",
        "- Durable send and reply automatically attempt to wake delivered recipients. Use `agent_wake` only to retry a notification failure reported by those tools.",
      ];
  const exitCriterion = source
    ? `Every deliverable and acceptance check in the approved source artifact is complete, validated, and accepted${hasCoordinator ? " by the coordinator" : " through durable mission mail"}.`
    : "Describe the observable condition that completes this mission.";
  return `# ${id} Mission

## Goal

${goal}

## Canonical artifacts

${artifacts.join("\n")}

## Roles

${roles.map(roleResponsibility).join("\n")}

## Coordination

- Load the \`mycelial-coordination\` skill.
- Read this mission and every canonical artifact before acting.
- Refresh the roster and check durable mail before starting work.
${coordination.join("\n")}

## Exit criterion

${exitCriterion}
`;
}

function roleResponsibility(role: string): string {
  return role === "coordinator"
    ? "- **coordinator:** Decompose and route work, track blockers, review reported validation, and accept the final mission result."
    : `- **${role}:** Accept scoped requests for this role, claim work before starting, and report results with validation.`;
}

function sourceReference(cwd: string, source: string): string {
  const candidate = relative(resolve(cwd), source);
  return candidate.length > 0 &&
    !isAbsolute(candidate) &&
    candidate !== ".." &&
    !candidate.startsWith(`..${sep}`)
    ? candidate
    : source;
}

function markdownCode(value: string): string {
  return value.replaceAll("`", "\\`").replace(/[\r\n]+/gu, " ");
}

function repositoryGuidanceTemplate(): string {
  return `# Project Guidance

## Repository workflow

- Keep durable designs, plans, and engineering decisions in repository Markdown files.
- Document the repository's supported build, test, lint, and formatting commands here before relying on them.
- Do not invent project commands; ask the operator when the supported workflow is unclear.

## Mycelial missions

- Load the \`mycelial-coordination\` skill when working in a bound Mycelial mission.
- Call \`agent_mission_read\`, refresh \`agent_roster\`, and read \`agent_mail_read\` before starting mission work.
- Treat durable mail as coordination truth and use claims for exclusive work ownership.
`;
}

export interface HerdrLauncherInput {
  missionId: string;
  missionDirectory: string;
  repositoryRoot: string;
}

export function renderHerdrLauncher(input: HerdrLauncherInput): string {
  const mission = shellQuote(input.missionId);
  const missionDirectory = shellQuote(resolve(input.missionDirectory));
  const repositoryRoot = shellQuote(resolve(input.repositoryRoot));
  return `#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'error: %s\\n' "$*" >&2
  exit 1
}

command -v herdr >/dev/null || fail "herdr is not in PATH"
command -v jq >/dev/null || fail "jq is required to parse mission and Herdr responses"
[[ "\${HERDR_ENV:-}" == "1" ]] || fail "run this launcher from a Herdr-managed control shell"
[[ -n "\${HERDR_WORKSPACE_ID:-}" ]] || fail "HERDR_WORKSPACE_ID is unavailable"

MISSION_ID=${mission}
MISSION_DIR=${missionDirectory}
REPO_ROOT=${repositoryRoot}
AGENTS_FILE="$MISSION_DIR/agents.json"
AGENT_KIND="\${HERDR_AGENT_KIND:-pi}"
ROLES=()
PRESETS=()
STARTED_ROLES=()
TABS=()
PANES=()

[[ -f "$MISSION_DIR/mission.md" ]] || fail "missing mission.md: $MISSION_DIR"
[[ -f "$AGENTS_FILE" ]] || fail "missing agents.json: $AGENTS_FILE"
[[ -d "$REPO_ROOT" ]] || fail "repository root is unavailable: $REPO_ROOT"

AGENT_ROWS="$(
  jq -er '
    def rows:
      if type == "array" then
        .[] |
          if type == "string" then [., ""]
          elif type == "object" then [(.role // .name // error("agent entry has no role")), (.preset // "")]
          else error("invalid agent entry") end
      elif type == "object" and has("agents") then
        .agents | rows
      elif type == "object" then
        to_entries[] |
          [.key,
           (if .value == null then ""
            elif (.value | type) == "object" then (.value.preset // "")
            else error("invalid role metadata") end)]
      else error("agents.json must be an array or object") end;
    rows | @tsv
  ' "$AGENTS_FILE"
)" || fail "could not parse agents.json"

while IFS=$'\\t' read -r role preset; do
  [[ "$role" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid role in agents.json: $role"
  if [[ -n "$preset" ]]; then
    [[ "$preset" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid preset in agents.json: $preset"
  fi
  ROLES+=("$role")
  PRESETS+=("$preset")
done <<<"$AGENT_ROWS"

((\${#ROLES[@]} > 0)) || fail "agents.json defines no roles"
for ((left = 0; left < \${#ROLES[@]}; left++)); do
  for ((right = left + 1; right < \${#ROLES[@]}; right++)); do
    [[ "\${ROLES[$left]}" != "\${ROLES[$right]}" ]] || fail "duplicate role in agents.json: \${ROLES[$left]}"
  done
done

role_index() {
  local target="$1" index
  for ((index = 0; index < \${#ROLES[@]}; index++)); do
    if [[ "\${ROLES[$index]}" == "$target" ]]; then
      printf '%s' "$index"
      return 0
    fi
  done
  return 1
}

if (($# == 0)); then
  SELECTED_ROLES=("\${ROLES[@]}")
else
  SELECTED_ROLES=("$@")
  for role in "\${SELECTED_ROLES[@]}"; do
    role_index "$role" >/dev/null || fail "role is not configured: $role"
  done
fi
for ((left = 0; left < \${#SELECTED_ROLES[@]}; left++)); do
  for ((right = left + 1; right < \${#SELECTED_ROLES[@]}; right++)); do
    [[ "\${SELECTED_ROLES[$left]}" != "\${SELECTED_ROLES[$right]}" ]] || fail "role selected more than once: \${SELECTED_ROLES[$left]}"
  done
done

for role in "\${SELECTED_ROLES[@]}"; do
  if herdr agent get "$role" >/dev/null 2>&1; then
    fail "a live Herdr agent is already named $role"
  fi
done

on_error() {
  local status=$? index
  printf '\\nlaunch failed; created tabs remain available for inspection\\n' >&2
  for ((index = 0; index < \${#STARTED_ROLES[@]}; index++)); do
    printf '%s: tab=%s pane=%s\\n' "\${STARTED_ROLES[$index]}" "\${TABS[$index]}" "\${PANES[$index]}" >&2
  done
  exit "$status"
}
trap on_error ERR

create_agent_tab() {
  local response tab_id pane_id pane_list
  response="$(herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$REPO_ROOT" --no-focus)"
  tab_id="$(jq -er '[.. | objects | .tab_id? // empty][0]' <<<"$response")"
  pane_id="$(jq -er '[.. | objects | .pane_id? // empty][0]' <<<"$response" 2>/dev/null || true)"
  if [[ -z "$pane_id" ]]; then
    pane_list="$(herdr pane list --workspace "$HERDR_WORKSPACE_ID" --tab "$tab_id")"
    pane_id="$(jq -er '[.. | objects | .pane_id? // empty][0]' <<<"$pane_list")"
  fi
  CREATED_TAB="$tab_id"
  CREATED_PANE="$pane_id"
}

cd "$REPO_ROOT"
for role in "\${SELECTED_ROLES[@]}"; do
  index="$(role_index "$role")"
  preset="\${PRESETS[$index]}"
  create_agent_tab
  STARTED_ROLES+=("$role")
  TABS+=("$CREATED_TAB")
  PANES+=("$CREATED_PANE")
  sleep 0.25

  agent_args=(--mycelial-mission "$MISSION_ID" --mycelial-role "$role")
  if [[ -n "$preset" ]]; then
    agent_args+=(--presets:preset "$preset")
  fi
  printf 'Starting %s in tab=%s pane=%s...\\n' "$role" "$CREATED_TAB" "$CREATED_PANE"
  herdr agent start "$role" --kind "$AGENT_KIND" --pane "$CREATED_PANE" -- "\${agent_args[@]}"
done

coordinator_started=false
for role in "\${STARTED_ROLES[@]}"; do
  if [[ "$role" == "coordinator" ]]; then
    coordinator_started=true
    herdr agent prompt "$role" \
      "You are the coordinator for mission $MISSION_ID. Load the mycelial-coordination skill, call agent_mission_read, follow the repository AGENTS.md already loaded by Pi, read every canonical artifact named by the mission, refresh agent_roster, and read agent_mail_read. Decompose the mission into independently claimable requests and send initial assignments to the live worker roles. Durable send automatically notifies delivered recipients; inspect its notification results and use agent_wake only to retry a reported failure. Do not implement worker tasks." \
      --wait --timeout 120000
    break
  fi
done

for role in "\${STARTED_ROLES[@]}"; do
  [[ "$role" == "coordinator" ]] && continue
  [[ "$coordinator_started" == "true" ]] && continue
  herdr agent prompt "$role" \
    "You are the $role role for mission $MISSION_ID. Load the mycelial-coordination skill, call agent_mission_read, follow the repository AGENTS.md already loaded by Pi, read every canonical artifact named by the mission, refresh agent_roster, then begin any responsibility explicitly assigned to your role by the mission; otherwise report ready and wait."
done

trap - ERR
printf '\\nMission launched: %s\\n' "$MISSION_ID"
for ((index = 0; index < \${#STARTED_ROLES[@]}; index++)); do
  printf '%s: tab=%s pane=%s\\n' "\${STARTED_ROLES[$index]}" "\${TABS[$index]}" "\${PANES[$index]}"
done
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function defaultRepoAlias(cwd: string): string | undefined {
  const candidate = basename(resolve(cwd));
  try {
    return repoAlias(candidate);
  } catch {
    return undefined;
  }
}
