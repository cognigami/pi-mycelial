#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

command -v herdr >/dev/null || fail "herdr is not in PATH"
command -v jq >/dev/null || fail "jq is required to parse Herdr responses"
command -v just >/dev/null || fail "just is not in PATH"
[[ "${HERDR_ENV:-}" == "1" ]] || fail "run this script from a Herdr-managed shell pane"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MISSION_ID="${1:-message-ordering-dogfood-$(date +%Y%m%d-%H%M%S)}"
MISSION_ROOT="${MYCELIAL_MISSION_ROOT:-$HOME/mycelial/missions}"
MISSION_DIR="$MISSION_ROOT/$MISSION_ID"
AGENT_KIND="${HERDR_AGENT_KIND:-pi}"
COORDINATOR_TAB=""
COORDINATOR_PANE=""
IMPLEMENTER_TAB=""
IMPLEMENTER_PANE=""

[[ "$MISSION_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || fail "invalid mission id: $MISSION_ID"
[[ ! -e "$MISSION_DIR" ]] || fail "mission already exists: $MISSION_DIR"

if herdr agent get coordinator >/dev/null 2>&1; then
  fail "a live Herdr agent is already named coordinator"
fi
if herdr agent get implementer >/dev/null 2>&1; then
  fail "a live Herdr agent is already named implementer"
fi

on_error() {
  local status=$?
  printf '\nlaunch failed; created tabs were left available for inspection\n' >&2
  [[ -n "$COORDINATOR_TAB" ]] && printf 'coordinator tab: %s\n' "$COORDINATOR_TAB" >&2
  [[ -n "$COORDINATOR_PANE" ]] && printf 'coordinator pane: %s\n' "$COORDINATOR_PANE" >&2
  [[ -n "$IMPLEMENTER_TAB" ]] && printf 'implementer tab: %s\n' "$IMPLEMENTER_TAB" >&2
  [[ -n "$IMPLEMENTER_PANE" ]] && printf 'implementer pane: %s\n' "$IMPLEMENTER_PANE" >&2
  exit "$status"
}
trap on_error ERR

cd "$REPO_ROOT"
printf 'Building and installing Mycelial...\n'
just install

if (cd examples/dogfood-project && just check >/dev/null 2>&1); then
  fail "the dogfood exercise already passes; restore its intentionally incomplete implementation before launching"
fi

mkdir -p "$MISSION_DIR"
cp docs/dogfood-project-mission.md "$MISSION_DIR/mission.md"
printf '%s\n' '{"agents":["coordinator","implementer"]}' > "$MISSION_DIR/agents.json"
printf '%s\n' '{"repos":["pi-mycelial"]}' > "$MISSION_DIR/repos.json"

create_agent_tab() {
  local variable_prefix="$1"
  local response tab_id pane_id pane_list

  response="$(
    herdr tab create \
      --workspace "$HERDR_WORKSPACE_ID" \
      --cwd "$REPO_ROOT" \
      --no-focus
  )"
  tab_id="$(jq -er '[.. | objects | .tab_id? // empty][0]' <<<"$response")"
  pane_id="$(
    jq -er '[.. | objects | .pane_id? // empty][0]' <<<"$response" 2>/dev/null || true
  )"

  if [[ -z "$pane_id" ]]; then
    pane_list="$(
      herdr pane list --workspace "$HERDR_WORKSPACE_ID" --tab "$tab_id"
    )"
    pane_id="$(jq -er '[.. | objects | .pane_id? // empty][0]' <<<"$pane_list")"
  fi

  printf -v "${variable_prefix}_TAB" '%s' "$tab_id"
  printf -v "${variable_prefix}_PANE" '%s' "$pane_id"
}

printf 'Creating Herdr tabs...\n'
create_agent_tab COORDINATOR
create_agent_tab IMPLEMENTER

# Give each newly created tab's shell a brief opportunity to reach its prompt.
sleep 0.5

printf 'Starting coordinator in %s...\n' "$COORDINATOR_PANE"
herdr agent start coordinator --kind "$AGENT_KIND" --pane "$COORDINATOR_PANE" -- \
  --mycelial-mission "$MISSION_ID" \
  --mycelial-role coordinator

printf 'Starting implementer in %s...\n' "$IMPLEMENTER_PANE"
herdr agent start implementer --kind "$AGENT_KIND" --pane "$IMPLEMENTER_PANE" -- \
  --mycelial-mission "$MISSION_ID" \
  --mycelial-role implementer

printf 'Initializing implementer...\n'
herdr agent prompt implementer \
  "You are the implementer for the $MISSION_ID mission. Read $MISSION_DIR/mission.md and the repository guidance. Load the mycelial-coordination skill, refresh agent_roster, read agent_mail_read, and if no assignment is present report ready and wait." \
  --wait --timeout 120000

printf 'Asking coordinator to create the durable assignment...\n'
herdr agent prompt coordinator \
  "You are the coordinator for the $MISSION_ID mission. Read $MISSION_DIR/mission.md and the repository guidance. Load the mycelial-coordination skill and refresh agent_roster. Send implementer one P1 request requiring acknowledgement to implement examples/dogfood-project/README.md and run just check there. Use Mycelial for the assignment and then end this turn with the durable message ID. Do not perform the implementation and do not poke implementer; this launcher will wake it after your durable send succeeds." \
  --wait --timeout 120000

printf 'Waking implementer after durable assignment...\n'
herdr agent prompt implementer \
  "Mycelial mail is waiting. Use agent_mail_read and follow the mission through acknowledgement, claim, implementation, validation, reply, done, and release. Do not poke coordinator; this launcher will wake it after your durable reply succeeds." \
  --wait --timeout 600000

printf 'Waking coordinator to triage the durable reply...\n'
herdr agent prompt coordinator \
  "A Mycelial reply is waiting. Use agent_mail_read, inspect the reported result, verify the acceptance check as needed, acknowledge the result, and report the mission verdict." \
  --wait --timeout 300000

trap - ERR
printf '\nDogfood run complete.\n'
printf 'Mission: %s\n' "$MISSION_DIR"
printf 'Coordinator tab: %s\n' "$COORDINATOR_TAB"
printf 'Coordinator pane: %s\n' "$COORDINATOR_PANE"
printf 'Implementer tab: %s\n' "$IMPLEMENTER_TAB"
printf 'Implementer pane: %s\n' "$IMPLEMENTER_PANE"
