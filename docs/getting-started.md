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

Start Pi in the repository where agents should work. After a discovery conversation produces an optional Markdown draft, approve mission creation with:

```text
/mycelial init release-42 --roles coordinator,implementer,reviewer --from docs/release-42.md
```

Omit `--from` to generate a minimal editable `mission.md`. The command creates `mission.md`, `agents.json`, `repos.json`, and an executable `launch-herdr.sh` under `~/mycelial/missions/release-42/`. It also creates `./launch-mycelial-release-42.sh` in the current repository as a symlink to the canonical launcher, then reports every path. It refuses to overwrite an existing mission or project shortcut.

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

The launcher leaves the control tab intact, opens one tab per role, starts role-named Pi agents with trusted bindings, forwards optional presets, and prompts each agent to read the mission, refresh the roster, and check mail. Pass role names to launch only a subset:

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

Durable mail does not wake an idle agent by itself. When Herdr is available, first complete `agent_mail_send`; only after it succeeds, send a terse body-free poke to the role-named Herdr agent, such as “Mycelial mail waiting; read your inbox.” If that poke fails, the durable mailbox remains authoritative.

For record formats and concurrency semantics, see [`docs/design.md`](design.md).
