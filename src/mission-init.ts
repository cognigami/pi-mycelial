import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { publishImmutable } from "./atomic-files";
import type { MycelialConfig } from "./config";
import type { FileSystem } from "./filesystem";
import { isExists, isMissing } from "./filesystem";
import { missionId, repoAlias, ValidationError } from "./identifiers";
import {
  expandParticipants,
  normalizeParticipant,
  type Participant,
} from "./participants";
import {
  materializeSessionTopology,
  prepareSessionTopology,
  SessionMaterializationError,
  serializeSessionManifest,
} from "./session-topology";

export interface InitializeMissionInput {
  mission: unknown;
  /** Legacy/programmatic declaration input; command callers pass participants. */
  roles?: unknown[];
  participants?: readonly Participant[];
  repos?: unknown[];
  source?: string;
  includeCoordinator?: boolean;
  cwd: string;
  sessionDirectory?: string;
  config: MycelialConfig;
}

export interface InitializedMission {
  mission: string;
  directory: string;
  missionFile: string;
  agentsFile: string;
  sessionsFile: string;
  reposFile: string;
  launcherFile: string;
  projectLauncherLink: string;
  repositoryGuidanceFile: string;
  repositoryGuidanceCreated: boolean;
}

export class InitializationRollbackError extends Error {
  readonly code = "INITIALIZATION_ROLLBACK_FAILED";
  constructor(
    cause: unknown,
    readonly cleanupResidue: readonly string[]
  ) {
    super(
      `Mission initialization failed and cleanup left residue: ${cleanupResidue.join(", ")}`,
      { cause }
    );
    this.name = "InitializationRollbackError";
  }
}

export async function initializeMission(
  fs: FileSystem,
  input: InitializeMissionInput
): Promise<InitializedMission> {
  const id = missionId(input.mission);
  const participants = normalizeInitializationParticipants(input);
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
  const sessionsFile = resolve(directory, "sessions.json");
  const reposFile = resolve(directory, "repos.json");
  const launcherFile = resolve(directory, "launch-herdr.sh");
  const projectLauncherLink = resolve(cwd, `launch-mycelial-${id}.sh`);
  const repositoryGuidanceFile = resolve(cwd, "AGENTS.md");
  await requireAbsent(fs, projectLauncherLink, "Project launcher link");
  const guidanceExists = await validateRepositoryGuidance(
    fs,
    repositoryGuidanceFile
  );
  const missionBody = await missionDocument(fs, input, id, participants);
  const launcher = renderHerdrLauncher({
    missionId: id,
    missionDirectory: directory,
    repositoryRoot: cwd,
  });

  await fs.mkdir(missionRoot, { recursive: true, mode: 0o700 });
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (isExists(error))
      throw new ValidationError(`Mission already exists: ${directory}`);
    throw error;
  }

  const createdSessions: string[] = [];
  let linked = false;
  let repositoryGuidanceCreated = false;
  try {
    const prepared = prepareSessionTopology({
      cwd,
      ...(input.sessionDirectory === undefined
        ? {}
        : { sessionDir: input.sessionDirectory }),
      mission: id,
      participants,
    });
    try {
      const materialized = await materializeSessionTopology(fs, prepared);
      createdSessions.push(...materialized.createdPaths);
    } catch (error) {
      if (error instanceof SessionMaterializationError)
        createdSessions.push(...error.createdPaths);
      throw error;
    }

    if (!guidanceExists) {
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
      Buffer.from(`${JSON.stringify({ agents: participants }, null, 2)}\n`)
    );
    await publishImmutable(
      fs,
      reposFile,
      Buffer.from(`${JSON.stringify({ repos }, null, 2)}\n`)
    );
    await publishImmutable(
      fs,
      sessionsFile,
      Buffer.from(serializeSessionManifest(prepared.manifest, participants))
    );
    await publishImmutable(fs, launcherFile, Buffer.from(launcher));
    await fs.chmod(launcherFile, 0o700);
    await fs.symlink(launcherFile, projectLauncherLink);
    linked = true;
    await fs.syncDirectory(cwd);
  } catch (error) {
    const residue = await rollbackInitialization(fs, {
      linked,
      projectLauncherLink,
      repositoryGuidanceCreated,
      repositoryGuidanceFile,
      directory,
      createdSessions,
    });
    if (residue.length > 0)
      throw new InitializationRollbackError(error, residue);
    throw error;
  }

  return {
    mission: id,
    directory,
    missionFile,
    agentsFile,
    sessionsFile,
    reposFile,
    launcherFile,
    projectLauncherLink,
    repositoryGuidanceFile,
    repositoryGuidanceCreated,
  };
}

function normalizeInitializationParticipants(
  input: InitializeMissionInput
): Participant[] {
  if (input.participants !== undefined && input.roles !== undefined)
    throw new ValidationError("Provide participants or roles, not both");
  if (input.participants !== undefined) {
    const participants = input.participants.map((participant) =>
      normalizeParticipant(participant)
    );
    const roles = participants.map((participant) => participant.role);
    if (
      participants.length === 0 ||
      new Set(roles).size !== roles.length ||
      roles.includes("all" as (typeof roles)[number])
    )
      throw new ValidationError(
        "Mission participants must be non-empty and unique"
      );
    return participants;
  }
  return expandParticipants(input.roles ?? [], {
    includeCoordinator: input.includeCoordinator,
  });
}

async function validateRepositoryGuidance(
  fs: FileSystem,
  path: string
): Promise<boolean> {
  try {
    const stat = await fs.lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new ValidationError(
        `Repository AGENTS.md is not a regular file: ${path}`
      );
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function rollbackInitialization(
  fs: FileSystem,
  state: {
    linked: boolean;
    projectLauncherLink: string;
    repositoryGuidanceCreated: boolean;
    repositoryGuidanceFile: string;
    directory: string;
    createdSessions: readonly string[];
  }
): Promise<string[]> {
  const residue: string[] = [];
  const cleanup = async (path: string, operation: () => Promise<void>) => {
    try {
      await operation();
    } catch {
      residue.push(path);
    }
  };
  if (state.linked)
    await cleanup(state.projectLauncherLink, () =>
      fs.unlink(state.projectLauncherLink)
    );
  if (state.repositoryGuidanceCreated)
    await cleanup(state.repositoryGuidanceFile, () =>
      fs.unlink(state.repositoryGuidanceFile)
    );
  await cleanup(state.directory, () =>
    fs.rm(state.directory, { recursive: true, force: true })
  );
  for (const path of [...state.createdSessions].reverse())
    await cleanup(path, () => fs.unlink(path));
  return residue;
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
  participants: readonly Participant[]
): Promise<string> {
  if (input.source === undefined) return missionTemplate(id, participants);
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
  return missionTemplate(id, participants, sourceReference(input.cwd, source));
}

function missionTemplate(
  id: string,
  participants: readonly Participant[],
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
  const hasCoordinator = participants.some(
    (participant) => participant.role === "coordinator"
  );
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

${participants.map(roleResponsibility).join("\n")}

## Coordination

- Load the \`mycelial-coordination\` skill.
- Read this mission and every canonical artifact before acting.
- Refresh the roster and check durable mail before starting work.
${coordination.join("\n")}

## Exit criterion

${exitCriterion}
`;
}

function roleResponsibility(participant: Participant): string {
  return participant.role === "coordinator"
    ? "- **coordinator** (capability: **coordinator**): Decompose and route work, track blockers, review reported validation, and accept the final mission result."
    : `- **${participant.role}** (capability: **${participant.capability}**): Accept scoped requests for this participant identity, claim work before starting, and report results with validation.`;
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
- Do not use \`/tmp\` for mission work; keep scratch artifacts in repository-approved locations or use a dedicated Pi scratch tool.
- Treat a sandbox denial as a workflow error. Do not bypass it through alternate commands, paths, shells, or wrappers; use the dedicated Pi tool, or stop and report the blocker.

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
SESSIONS_FILE="$MISSION_DIR/sessions.json"
AGENT_KIND="\${HERDR_AGENT_KIND:-pi}"
ROLES=()
PRESETS=()
SESSION_ROLES=()
SESSION_IDS=()
SESSION_FILES=()
SESSION_NAMES=()
SESSION_PARENTS=()
SELECTED_ROLES=()
STARTED_ROLES=()
REUSED_ROLES=()
CREATED_ROLES=()
TABS=()
PANES=()

[[ -f "$MISSION_DIR/mission.md" && ! -L "$MISSION_DIR/mission.md" ]] || fail "missing regular mission.md: $MISSION_DIR"
[[ -f "$AGENTS_FILE" && ! -L "$AGENTS_FILE" ]] || fail "missing regular agents.json: $AGENTS_FILE"
[[ -f "$SESSIONS_FILE" && ! -L "$SESSIONS_FILE" ]] || fail "missing regular sessions.json: $SESSIONS_FILE"
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

SESSION_ROWS="$(
  jq -er '
    if type != "object" or .formatVersion != 1 or (.sessions | type) != "object"
    then error("invalid sessions manifest")
    else .sessions | to_entries[] |
      if (.value | type) != "object" then error("invalid session entry") else
      [.key, .value.sessionId, .value.sessionFile, .value.name, (.value.parent // "")] | @tsv end
    end
  ' "$SESSIONS_FILE"
)" || fail "could not parse sessions.json"
while IFS=$'\\t' read -r role session_id session_file session_name parent; do
  [[ "$role" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid participant in sessions.json: $role"
  [[ "$session_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid session id for $role"
  [[ "$session_file" == /* && -n "$session_name" ]] || fail "invalid session metadata for $role"
  [[ -z "$parent" || "$parent" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid session parent for $role"
  SESSION_ROLES+=("$role")
  SESSION_IDS+=("$session_id")
  SESSION_FILES+=("$session_file")
  SESSION_NAMES+=("$session_name")
  SESSION_PARENTS+=("$parent")
done <<<"$SESSION_ROWS"

role_index() {
  local target="$1" index
  for ((index = 0; index < \${#ROLES[@]}; index++)); do
    [[ "\${ROLES[$index]}" == "$target" ]] && { printf '%s' "$index"; return 0; }
  done
  return 1
}
session_index() {
  local target="$1" index
  for ((index = 0; index < \${#SESSION_ROLES[@]}; index++)); do
    [[ "\${SESSION_ROLES[$index]}" == "$target" ]] && { printf '%s' "$index"; return 0; }
  done
  return 1
}

((\${#SESSION_ROLES[@]} == \${#ROLES[@]})) || fail "agents.json and sessions.json participant sets differ"
for ((left = 0; left < \${#ROLES[@]}; left++)); do
  for ((right = left + 1; right < \${#ROLES[@]}; right++)); do
    [[ "\${ROLES[$left]}" != "\${ROLES[$right]}" ]] || fail "duplicate role in agents.json: \${ROLES[$left]}"
  done
  session_index "\${ROLES[$left]}" >/dev/null || fail "participant missing from sessions.json: \${ROLES[$left]}"
done
for ((left = 0; left < \${#SESSION_ROLES[@]}; left++)); do
  for ((right = left + 1; right < \${#SESSION_ROLES[@]}; right++)); do
    [[ "\${SESSION_ROLES[$left]}" != "\${SESSION_ROLES[$right]}" ]] || fail "duplicate participant in sessions.json: \${SESSION_ROLES[$left]}"
    [[ "\${SESSION_IDS[$left]}" != "\${SESSION_IDS[$right]}" ]] || fail "duplicate session id in sessions.json"
    [[ "\${SESSION_FILES[$left]}" != "\${SESSION_FILES[$right]}" ]] || fail "duplicate session file in sessions.json"
  done
  role_index "\${SESSION_ROLES[$left]}" >/dev/null || fail "unknown sessions.json participant: \${SESSION_ROLES[$left]}"
  expected_parent=""
  if role_index coordinator >/dev/null && [[ "\${SESSION_ROLES[$left]}" != "coordinator" ]]; then
    expected_parent=coordinator
  fi
  [[ "\${SESSION_PARENTS[$left]}" == "$expected_parent" ]] || fail "invalid session parent for \${SESSION_ROLES[$left]}"
  [[ "\${SESSION_NAMES[$left]}" == "$MISSION_ID: \${SESSION_ROLES[$left]}" ]] || fail "invalid session name for \${SESSION_ROLES[$left]}"
done

if (($# == 0)); then
  SELECTED_ROLES=("\${ROLES[@]}")
else
  SELECTED_ROLES=("$@")
fi
for role in "\${SELECTED_ROLES[@]}"; do
  role_index "$role" >/dev/null || fail "role is not configured: $role"
done
for ((left = 0; left < \${#SELECTED_ROLES[@]}; left++)); do
  for ((right = left + 1; right < \${#SELECTED_ROLES[@]}; right++)); do
    [[ "\${SELECTED_ROLES[$left]}" != "\${SELECTED_ROLES[$right]}" ]] || fail "role selected more than once: \${SELECTED_ROLES[$left]}"
  done
done

validate_session() {
  local role="$1" index session_id session_file parent expected_parent_file header
  index="$(session_index "$role")"
  session_id="\${SESSION_IDS[$index]}"
  session_file="\${SESSION_FILES[$index]}"
  parent="\${SESSION_PARENTS[$index]}"
  [[ -f "$session_file" && ! -L "$session_file" ]] || fail "session file is missing or unsafe for $role: $session_file"
  expected_parent_file=""
  if [[ -n "$parent" ]]; then
    expected_parent_file="\${SESSION_FILES[$(session_index "$parent")]}"
  fi
  IFS= read -r header < "$session_file" || fail "could not read session header for $role"
  jq -e --arg id "$session_id" --arg cwd "$REPO_ROOT" --arg parent "$expected_parent_file" '
    type == "object" and .type == "session" and .id == $id and .cwd == $cwd and ((.parentSession // "") == $parent)
  ' <<<"$header" >/dev/null || fail "session header does not match sessions.json for $role"
}
for role in "\${SELECTED_ROLES[@]}"; do validate_session "$role"; done

on_error() {
  local status=$? index
  printf '\\nlaunch failed; created tabs remain available for inspection\\n' >&2
  for ((index = 0; index < \${#CREATED_ROLES[@]}; index++)); do
    printf '%s: tab=%s pane=%s\\n' "\${CREATED_ROLES[$index]}" "\${TABS[$index]}" "\${PANES[$index]}" >&2
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
  if herdr agent get "$role" >/dev/null 2>&1; then
    REUSED_ROLES+=("$role")
    continue
  fi
  role_position="$(role_index "$role")"
  session_position="$(session_index "$role")"
  preset="\${PRESETS[$role_position]}"
  session_file="\${SESSION_FILES[$session_position]}"
  create_agent_tab
  CREATED_ROLES+=("$role")
  TABS+=("$CREATED_TAB")
  PANES+=("$CREATED_PANE")
  sleep 0.25
  agent_args=(--session "$session_file" --mycelial-mission "$MISSION_ID" --mycelial-role "$role")
  if [[ -n "$preset" ]]; then agent_args+=(--presets:preset "$preset"); fi
  printf 'Starting %s in tab=%s pane=%s...\\n' "$role" "$CREATED_TAB" "$CREATED_PANE"
  herdr agent start "$role" --kind "$AGENT_KIND" --pane "$CREATED_PANE" -- "\${agent_args[@]}"
  STARTED_ROLES+=("$role")
done

coordinator_selected=false
for role in "\${SELECTED_ROLES[@]}"; do
  [[ "$role" == "coordinator" ]] && coordinator_selected=true
done
if ((\${#STARTED_ROLES[@]} > 0)); then
  for role in "\${STARTED_ROLES[@]}"; do
    if [[ "$role" == "coordinator" ]]; then
      herdr agent prompt "$role" \
        "Reconcile mission $MISSION_ID idempotently. Load the mycelial-coordination skill and agent_mission_read, follow repository AGENTS.md, read canonical artifacts, refresh agent_roster, read durable mail, requests, receipts, and claims, and create assignments only where durable state requires them. Never blindly repeat mission decomposition. Durable send automatically notifies recipients; use agent_wake only to retry a reported failure. Do not implement worker tasks." \
        --wait --timeout 120000
      break
    fi
  done
  if [[ "$coordinator_selected" == "false" ]]; then
    for role in "\${STARTED_ROLES[@]}"; do
      herdr agent prompt "$role" \
        "Resume as participant $role for mission $MISSION_ID. Load the mycelial-coordination skill and agent_mission_read, follow repository AGENTS.md, refresh agent_roster, read durable mail and current claims, continue only durable assigned work, and otherwise report ready and wait."
    done
  fi
fi

trap - ERR
printf '\\nMission launch reconciled: %s\\n' "$MISSION_ID"
if ((\${#REUSED_ROLES[@]} > 0)); then
  for role in "\${REUSED_ROLES[@]}"; do printf 'reused: %s\\n' "$role"; done
fi
for ((index = 0; index < \${#STARTED_ROLES[@]}; index++)); do
  printf 'started: %s tab=%s pane=%s\\n' "\${STARTED_ROLES[$index]}" "\${TABS[$index]}" "\${PANES[$index]}"
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
