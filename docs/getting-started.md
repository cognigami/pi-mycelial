# Getting Started Without pi-presets or Herdr

Mycelial works with ordinary, manually launched Pi sessions. A mission is a coordination namespace for one bounded effort and may span multiple repositories.

## What lives where

| Artifact | Purpose | Visibility |
| --- | --- | --- |
| Repository `AGENTS.md` | Durable repository and engineering rules | Loaded by Pi |
| Mission `mission.md` | Bounded goal, participants, conventions, and canonical artifact references | Not automatically loaded by current Mycelial |
| Design/implementation files | Canonical technical artifacts in their repositories | Read through normal file tools |
| Mail and receipts | Dynamic assignments, blockers, decisions, and handoffs | Mycelial tools |
| Claims | Current exclusive task ownership | Mycelial tools |
| Mycelial skill | Neutral mailbox/claim operating procedure | Loaded on demand |

`mission.md` supplements but never overrides repository `AGENTS.md`. Keep designs and plans in their canonical repositories and reference them from `mission.md`; do not duplicate them into mission storage. Although `mission.md` is a required control file, Mycelial does not place it in model context. Tell each agent to read it in the initial prompt.

## Install and create a mission

```sh
just install
mkdir -p ~/mycelial/missions/release-42
```

Create `~/mycelial/missions/release-42/mission.md` with the bounded goal, role responsibilities, coordination conventions, and links or paths to canonical repository artifacts. Then create the static roster:

```json
{
  "agents": ["coordinator", "implementer", "reviewer"]
}
```

Save it as `agents.json`. An optional `repos.json` lists validated repository aliases, for example `{ "repos": ["app", "shared-library"] }`. In v1 an alias is message metadata only; Mycelial does not resolve it to a filesystem path. See [`examples/mission/`](../examples/mission/) for a complete minimal mission.

## Launch agents manually

Start one Pi process per role from the appropriate repository:

```sh
pi --mycelial-mission release-42 --mycelial-role coordinator
pi --mycelial-mission release-42 --mycelial-role implementer
pi --mycelial-mission release-42 --mycelial-role reviewer
```

A useful initial prompt is:

> You are the implementer for mission `release-42`. Read `~/mycelial/missions/release-42/mission.md` and this repository's `AGENTS.md`. Load the `mycelial-coordination` skill, refresh `agent_roster`, then read `agent_mail_read` before starting work.

The footer shows the trusted binding as `implementer@release-42` when a compatible footer extension is present. The session ID is never displayed or added to model context.

## Coordinate work

Send one independently claimable task per request message. Unless the mission explicitly defines another safe identifier, use that request's message ID as both the task ID and the claim's source message ID. Claims—not roster presence or an `accepted` receipt—establish exclusive ownership.

Durable mail does not wake an idle agent by itself. When Herdr is available, first complete `agent_mail_send`; only after it succeeds, send a terse body-free poke to the role-named Herdr agent, such as “Mycelial mail waiting; read your inbox.” If that poke fails, the durable mailbox remains authoritative.

For record formats and concurrency semantics, see [`docs/design.md`](design.md).
