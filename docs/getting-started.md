# Getting Started

Mycelial can launch configured roles through Herdr or work with ordinary, manually launched Pi sessions. A mission is a coordination namespace for one bounded effort and may span multiple repositories.

## What lives where

| Artifact | Purpose | Visibility |
| --- | --- | --- |
| Repository `AGENTS.md` | Durable repository and engineering rules | Loaded by Pi |
| Mission `mission.md` | Bounded goal, participants, conventions, and canonical artifact references | Read explicitly with `agent_mission_read` |
| Design/implementation files | Canonical technical artifacts in their repositories | Read through normal file tools |
| Mail and receipts | Dynamic assignments, blockers, decisions, and handoffs | Mycelial tools |
| Claims | Current exclusive task ownership | Mycelial tools |
| Mycelial skill | Neutral mailbox/claim operating procedure | Loaded on demand |

`mission.md` supplements but never overrides repository `AGENTS.md`. Keep designs and plans in their canonical repositories and reference them from `mission.md`; do not duplicate them into mission storage. Mycelial does not inject the document into every turn; a bound agent loads it explicitly through the pathless `agent_mission_read` tool.

## Install and initialize a mission

Install Mycelial from its package repository:

```sh
just install
```

Start Pi in the repository where agents should work. After a discovery conversation identifies an optional approved design or implementation plan, initialize the mission with:

```text
/mycelial init release-42 --roles implementer,reviewer --from docs/release-42-plan.md
```

With `--from`, the source file remains the canonical repository artifact and the generated `mission.md` references it as mission input; it is not copied into mission storage. Omit `--from` to generate a minimal editable mission. The command adds a `coordinator` role by default, creates `mission.md`, `agents.json`, `repos.json`, and an executable `launch-herdr.sh` under `~/mycelial/missions/release-42/`, and creates `./launch-mycelial-release-42.sh` as a symlink to the canonical launcher. Pass `--no-coordinator` only for deliberately peer-coordinated work.

Initialization also creates a minimal repository `AGENTS.md` when that exact file is absent. It never modifies an existing `AGENTS.md`. The command refuses to overwrite an existing mission or project shortcut and reports every created or reused path.

Repository aliases default to the current repository directory name. Supply `--repos app,shared-library` to override them. In v1 an alias is message metadata only; Mycelial does not resolve it to a filesystem path. See [`examples/mission/`](../examples/mission/) for a complete minimal mission.

To assign a preset independently from mailbox identity, edit `agents.json` into the object form:

```json
{
  "coordinator": {},
  "implementer": {},
  "reviewer": {
    "preset": "domain-auditor"
  }
}
```

## Launch all roles through Herdr

From a Herdr-managed control shell in the repository, run:

```sh
./launch-mycelial-release-42.sh
```

The launcher leaves the control tab intact, opens one tab per role, starts role-named Pi agents with trusted bindings, and forwards optional presets. When the default coordinator is present, it receives the first startup prompt and creates durable initial assignments; the launcher then notifies workers to read and claim their mail without waiting for their implementation turns to finish. Pass role names to launch only a subset:

```sh
./launch-mycelial-release-42.sh coordinator reviewer
```

## Launch manually without Herdr

The generated files remain usable without Herdr. Start one Pi process per role from the appropriate repository:

```sh
pi --mycelial-mission release-42 --mycelial-role coordinator
pi --mycelial-mission release-42 --mycelial-role implementer
pi --mycelial-mission release-42 --mycelial-role reviewer
```

A useful initial prompt is:

> You are the implementer for mission `release-42`. Load the `mycelial-coordination` skill, call `agent_mission_read`, read this repository's `AGENTS.md`, refresh `agent_roster`, then read `agent_mail_read` before starting work.

The footer shows the trusted binding as `implementer@release-42` when a compatible footer extension is present. The session ID is never displayed or added to model context.

## Coordinate work

Send one independently claimable task per request message. Unless the mission explicitly defines another safe identifier, use that request's message ID as both the task ID and the claim's source message ID. Claims—not roster presence or an `accepted` receipt—establish exclusive ownership.

Durable mailbox storage does not itself wake an idle agent. After `agent_mail_send` or `agent_mail_reply` publishes durable mail, the tool automatically attempts a fixed, content-free Herdr wake-up for each delivered recipient and reports the notification outcome separately. If that attempt fails, durable mail remains authoritative; use `agent_wake` only to retry the reported failure.

For record formats and concurrency semantics, see [`docs/design.md`](design.md).
