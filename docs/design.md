# Lightweight Pi Agent Mailbox Design

## Status

Implemented for the package-owned v1 protocol and standalone-adoption surface.
The design addresses read-modify-write races, shared role-level cursors,
non-append-only receipts, trusted identity binding, delayed ULID publication,
partial fan-out recovery, and lock-owner fencing. Package-owned neutral guidance
and trusted footer status are included; Herdr wake-ups and persona policy remain
optional external integrations, and immutable claim events remain deferred.

## Goal

A small, durable messaging layer for Pi agents that scales beyond pairwise
handoffs: several agents, multiple repositories, explicit delivery/interrupt
semantics, provenance-accurate task ownership, and a genuine audit trail —
without becoming a full orchestration platform.

## Non-goals

- Do not build a chat server or a full task database.
- Do not replace Herdr for live pane/agent control, or pi-presets for
  persona/role selection.
- Do not rely on ephemeral terminal output as the source of truth.
- Do not couple mailbox storage to supervisor policy.
- Do not trust the model to self-report identity (see Identity, below).

## Layering

1. **Optional Herdr integration** — a best-effort live wake-up after durable send.
2. **Operating guidance** — the package skill, repository guidance, or optional personas.
3. **File-backed mission mailbox** — durable coordination state and source of truth.

The mailbox has no preset dependency. Protocol-operating guidance stays outside
the storage layer and may come from the neutral package skill, project guidance,
or optional persona instructions.

## Identity and startup binding

Mission, role, and session identity are supplied by the operator or launcher at
process start — never inferred by the model and never accepted as tool
arguments from the model:

```text
--mycelial-mission <mission-id>
--mycelial-role <role>
```

(Environment variable equivalents are fine.) The session ID comes from Herdr's
own session identity when available, or is generated once by the launcher and
held in runtime state otherwise — not chosen by the agent process itself.

Tool implementations read identity from this trusted runtime context directly.
`agent_mail_send` and friends do not accept `from`, `from_session`, `mission`,
or `role` as model-supplied parameters — a tool call that tried to specify its
own identity would be rejected. This closes the gap where injected content
encountered mid-task could otherwise induce a forged sender.

Role is not inferred from the pi-presets preset name. If preset-to-role
inference is wanted later, it needs an explicit status/change event contract
from pi-presets, not a name-string convention.

All mission, role, task, and message identifiers are validated (charset,
length) before being used to construct a filesystem path, since they become
path segments.

## Mission layout

Immutable records are separated from mutable projections. Mutable projections
are either rebuildable from immutable records, or scoped per-session so only
one writer ever touches them.

```text
~/agent-work/missions/<mission-id>/
  mission.md
  agents.json                     # static role/persona config
  repos.json                      # cross-codebase aliases

  messages/
    <message-id>.md                # immutable, one writer (the sender), never edited

  inbox/
    <role>/<message-id>.json       # delivery marker per recipient

  receipts/
    <message-id>/
      <timestamp>_<agent>_<session>_<event-id>.yaml   # immutable, one per event

  claims/
    <task-id>.yaml                 # current claim state, lock-protected
    <task-id>.lock/                # mkdir-based mutex, held during claim ops
  claim-events/
    <task-id>/<event-id>.yaml      # optional audit history of claim transitions

  roster/
    <role>/<session-id>.json       # presence + heartbeat/expiry, one writer

  cursors/
    <role>/<session-id>.json       # scan-position optimization only, one writer

  artifacts/
  decisions/
```

`index.json` is deliberately not included in v1. Reading scans `messages/`
(or the per-role `inbox/<role>/` delivery markers) and parses only messages
newer than the session's own cursor. This is simpler and safe at the expected
scale (single digits of agents); a rebuildable index can be added later if a
real bottleneck shows up under measurement, not in anticipation of one.

## Message format

```yaml
---
formatVersion: 1
id: 01J8Z3K9QATG5V2N7X4R6M1B0C
from: reviewer
from_session: pi-sess-4c02be
to: implementer
recipients:
  - implementer
repo: pi-presets
kind: blocker
priority: P1
interrupt: safe
requires_ack: true
thread: preset-handoff
deadline: 2026-09-13T18:00:00Z
created: 2026-09-13T17:32:00Z
---

Found a failing case in `src/runtime.ts`.
Please patch the regression, run focused tests, then ask `tester` to verify.
```

`id` is a ULID: 128 bits total, consisting of a 48-bit timestamp and 80 random
bits. It is sortable by creation time and collision-resistant at this mission's
scale. It is used for message and event identifiers; task identifiers are
validated path-safe names.

`from` and `from_session` are written by the mailbox tool from trusted runtime
identity, not supplied by the model (see Identity, above).

### Required fields
`formatVersion`, `id`, `from`, `from_session`, `to`, `recipients`, `kind`,
`priority`, `interrupt`, `requires_ack`, and `created`.

`to` is either one named role or `all`. `all` expands at send time against the
static roles in `agents.json`, excludes the sender in v1, and stores that sorted,
deduplicated recipient snapshot in `recipients`. The snapshot is immutable
delivery truth; inbox markers are rebuildable projections. Named channels are
deferred until they have a membership schema.

### Optional fields
`repo`, `thread`, `in_reply_to`, `deadline`, `paths`. Replies set `in_reply_to`
and inherit the original thread, or use the original message ID as the thread
root.

## Message kinds, priority, and interrupt semantics

Unchanged from v2:

| Priority | Default behavior |
| --- | --- |
| `P0` emergency | Stop after current safe point. Read and respond immediately. |
| `P1` blocker | Finish current atomic subtask, then handle. Ack promptly. |
| `P2` normal | Finish current task or turn, then process. |
| `P3` FYI | Mark seen at next checkpoint. No interruption required. |

> Mail never interrupts a running shell command, file edit, or model turn
> mid-token. It interrupts only at safe boundaries.

`interrupt`: `now`, `safe`, `task-boundary`, `next-checkpoint` — mapped to Pi
delivery behavior as in v2.

## Receiving mail

- **Reads are non-destructive.** Reading a message never mutates shared state
  other than the reading session's own cursor. Whether a message has been
  acknowledged is determined by receipts, not by whether it's been "consumed."
- **Cursors are per-session, not per-role**: `cursors/<role>/<session-id>.json`.
  Since a role can have multiple live sessions, a shared cursor would let one
  instance silently consume mail meant for both. Each session tracks returned
  message IDs rather than a ULID high-water mark, so a sender that allocates an
  earlier ULID and publishes late is still discovered. Sibling reads in one Pi
  process are serialized because tool calls can execute concurrently.
- **Roster is per-session, not per-role**: `roster/<role>/<session-id>.json`,
  with a heartbeat and expiry. "The current session for role X" is derived by
  finding the live (non-expired) entry, not by trusting whichever process
  wrote last to a single shared file.

Mycelial does not add a receiver-side polling notifier or inbox watcher. Durable
mail alone does not wake an idle agent. When Herdr is available, a sender may
issue a terse, body-free poke to the role-named agent only after durable send
succeeds. The mailbox remains authoritative if that optional poke fails.

## Task ownership: claims

Claims are the one piece of genuinely contended mutable state — multiple
agents can legitimately race to claim the same task, so this is the one place
that needs real locking, not just per-session scoping:

1. Acquire the per-task mutex: `mkdir claims/<task-id>.lock/` (atomic; fails
   if it already exists — that failure means contention, not an error to
   surface to the user).
2. Read `claims/<task-id>.yaml` (or note its absence). Check `version` and
   `expires`.
3. Write lock-owner metadata containing an unguessable token, PID, session, and
   acquisition time. Before each claim mutation and release, verify that token
   is still present in the canonical lock directory.
4. To claim or take over: write a new version to a tempfile, `rename()` into
   place, incrementing `version`. A takeover records the expired prior version.
5. Release only a mutex whose owner token still matches. Never time-break a
   lock: recover only when local process liveness proves its owner is dead, and
   rename the lock to a unique quarantine path before removing it.

```yaml
formatVersion: 1
task: task_regression_runtime_ts
message: 01J8Z3K9QATG5V2N7X4R6M1B0C
agent: implementer
session: pi-sess-8f21ac
status: claimed
version: 3
expires: 2026-09-13T18:10:00Z
created: 2026-09-13T17:35:00Z
updated: 2026-09-13T17:40:00Z
observed_prior_version: 2
```

An optional immutable trail lives in `claim-events/<task-id>/<event-id>.yaml`
if full claim history is wanted beyond current state.

## Receipts

Append-only for real this time: one immutable file per event, not one file
per `(message, agent)` pair.

```text
receipts/<message-id>/<timestamp>_<agent>_<session>_<event-id>.yaml
```

```yaml
formatVersion: 1
id: 01J8Z3K9QATG5V2N7X4R6M1B0D
message: 01J8Z3K9QATG5V2N7X4R6M1B0C
agent: implementer
session: pi-sess-8f21ac
event: accepted
created: 2026-09-13T17:35:00Z
note: Accepted. Patching src/runtime.ts after the current safe point.
```

A latest-state projection (`accepted` vs `done` vs ...) can be derived by
scanning a message's receipt directory when needed; it does not need its own
mutable file for v1.

## Minimal tool surface

- `agent_mail_send`
- `agent_mail_read` — scans `messages/`/`inbox/<role>/` against the calling
  session's cursor; non-destructive.
- `agent_mail_ack` — writes a receipt event.
- `agent_mail_reply`
- `agent_task_claim` — lock-protected claim acquire/renew/takeover.
- `agent_task_release`
- `agent_roster` — reads roster; writes only the calling session's own entry.

None of these accept `from`, `from_session`, `mission`, or `role` as
parameters — those come from trusted runtime identity.

## Operating policy stays outside storage

Acknowledgement expectations, claim checkpoints, escalation, and role-specific
routing policy do not belong in mailbox execution. Neutral protocol procedure is
provided by the package skill; repositories may add project guidance, and users
may optionally add persona-specific policy without coupling Mycelial to presets.

## Implementation shape

```text
src/
  index.ts
  runtime.ts            # resolves trusted identity (mission/role/session)
  footer-slot.ts         # best-effort operator-only trusted binding
  mailbox-store.ts       # immutable records: messages, receipts, claim-events
  projections.ts         # mutable, rebuildable/scoped: claims, roster, cursors
  identity.ts
  tool/
    send.ts
    read.ts
    ack.ts
    reply.ts
    task-claim.ts
    task-release.ts
    roster.ts
```

Mycelial starts heartbeat ownership in `session_start` and stops it idempotently
in `session_shutdown`. It does not start an inbox poller or file watcher.

## Initial implementation recommendation

1. Mission directory per the layout above; identity resolved from
   `--mycelial-mission`/`--mycelial-role` at launch, session ID from Herdr or
   a launcher-generated UUID.
2. Messages as immutable Markdown+frontmatter with ULID IDs.
3. Send/read/ack/reply tools; read is non-destructive and cursor-scoped.
4. Claims with mkdir-based locking and version-checked takeover.
5. Receipts as one-file-per-event; skip a latest-state cache until needed.
6. Package-owned neutral skill guidance requiring mail checks at task boundaries.
7. Optional sender-side Herdr poke only after durable send; no receiver-side
   notifier or process-control implementation in this package.
8. Optional external persona guidance may add role-specific policy.

## References

- **Message format / bash helper** — [yangyang0507/herdr-skill](https://github.com/yangyang0507/herdr-skill)
- **Lightweight peer messaging** — [aashishd/herdr-agent-messenger](https://github.com/aashishd/herdr-agent-messenger)
- **Role set + resumable task state** — [SecretAardvark/pi-overseer](https://github.com/SecretAardvark/pi-overseer)
- **Claims/leases** — [MinhDuyDEV/pi-subagents](https://github.com/MinhDuyDEV/pi-subagents)
- **Append-only logs + durable resource claims** — [bon5co/bermuda](https://github.com/bon5co/bermuda)
- **Turn-completion / crash detection** — [joelhooks/herdr-pings](https://github.com/joelhooks/herdr-pings)
- **Cross-machine mail (if needed later)** — [getbeb/herdr-beb](https://github.com/getbeb/herdr-beb)
- **Session vs pane identity precedent** — [wyattjoh/herdr-plugin-renamer](https://github.com/wyattjoh/herdr-plugin-renamer)
