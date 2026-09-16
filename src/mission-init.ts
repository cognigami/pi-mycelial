import { basename, resolve, sep } from "node:path";
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
}

export async function initializeMission(
  fs: FileSystem,
  input: InitializeMissionInput
): Promise<InitializedMission> {
  const id = missionId(input.mission);
  const roles = input.roles.map(roleId);
  if (roles.length === 0 || new Set(roles).size !== roles.length)
    throw new ValidationError("Mission roles must be non-empty and unique");
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
  try {
    await fs.mkdir(directory, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (isExists(error))
      throw new ValidationError(`Mission already exists: ${directory}`);
    throw error;
  }

  try {
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
    throw new ValidationError(`Mission draft is not a regular file: ${source}`);
  const content = await fs.readFile(source);
  if (content.byteLength > input.config.readMaxBytes)
    throw new ValidationError(
      `Mission draft exceeds ${input.config.readMaxBytes} bytes`
    );
  const text = content.toString("utf8");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function missionTemplate(id: string, roles: readonly string[]): string {
  return `# ${id} Mission

## Goal

Describe the bounded mission outcome.

## Canonical artifacts

- Repository \`AGENTS.md\`

## Roles

${roles.map((role) => `- **${role}:** Describe this role's responsibility.`).join("\n")}

## Coordination

- Load the \`mycelial-coordination\` skill.
- Read the mission, refresh the roster, and check mail before starting work.
- Use durable Mycelial mail before any optional live wake-up.

## Exit criterion

Describe the observable condition that completes this mission.
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

for role in "\${STARTED_ROLES[@]}"; do
  herdr agent prompt "$role" \
    "You are the $role role for mission $MISSION_ID. Load the mycelial-coordination skill, call agent_mission_read, read the repository AGENTS.md, refresh agent_roster, then read agent_mail_read. Begin any responsibility explicitly assigned to your role by the mission; otherwise report ready and wait." \
    --wait --timeout 120000
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
