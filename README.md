# mycelial

A durable, local mission mailbox and task-claim Pi extension. Mycelial stores immutable messages and receipts, rebuildable inbox markers, per-session read state and presence, and lock-protected task leases.

**New users:** follow [Getting Started](docs/getting-started.md) for a standalone setup with manually launched Pi agents. A minimal mission is available in [`examples/mission/`](examples/mission/).

## Install

```sh
just build
just install
```

The managed artifact is `dist/index.js`. Set `PI_CODING_AGENT_DIR` to install into an isolated Pi agent directory. The package also declares the neutral `mycelial-coordination` skill through standard `pi.skills`; pi-extension-kit installs and contributes it only while the managed extension is enabled and loaded. A loaded but unbound extension may advertise the skill, but its procedures apply only when Mycelial tools are available or a mission has been declared.

## Mission setup

The default mission base is `~/agent-work/missions` (override `missionRoot` in `~/.config/pi-extensions/mycelial/*.jsonc`). A mission must already contain:

```text
<missionRoot>/<mission-id>/
  mission.md
  agents.json
  repos.json       # optional
```

`mission.md` is a required control file but is not injected into model context; direct agents to read it in their initial prompt. It supplements and never overrides repository `AGENTS.md`. Keep canonical designs and plans in their repositories and reference them from the mission.

`agents.json` may be an array of role names, an object keyed by role, or `{ "agents": [...] }`. `repos.json` accepts the corresponding alias forms. Repository aliases are metadata and do not resolve to filesystem paths in v1. Generated protocol directories are created lazily. Symlinked protocol control paths are rejected.

Bind identity explicitly:

```sh
pi --mycelial-mission launch-42 --mycelial-role implementer
```

Environment equivalents are `PI_MYCELIAL_MISSION`, `PI_MYCELIAL_ROLE`, and optional `PI_MYCELIAL_SESSION`. Flags take precedence. Without both mission and role, the extension is inert and registers no mailbox tools. Role is never inferred from a persona or accepted in tool input. A compatible footer displays the trusted binding as `<role>@<mission>` without exposing the session ID.

## Configuration

Global JSONC fragments under `~/.config/pi-extensions/mycelial/` can set:

- `missionRoot`
- `heartbeatIntervalMs`, `presenceTtlMs`
- `defaultLeaseMs`, `minLeaseMs`, `maxLeaseMs`
- `readLimit`, `readMaxBytes`, `messageMaxBytes`
- `lockRetries`, `lockBackoffMs`

No project-local identity configuration is read. Immutable publication uses same-directory hard links for no-clobber semantics and therefore targets local POSIX filesystems in v1.

## Tools and coordination

`agent_mail_send`, `agent_mail_read`, `agent_mail_ack`, `agent_mail_reply`, `agent_task_claim`, `agent_task_release`, and `agent_roster` are available only after successful binding. Reads are non-destructive and session-scoped. `all` excludes the sender and records a static recipient snapshot. Task contention is a structured successful result rather than a tool exception.

Use one request message per independently claimable task and use its message ID as the default task ID and source message ID. Claims—not roster presence or accepted receipts—establish ownership.

Mycelial does not poll, watch inboxes, or wake idle agents. When Herdr is available, send durable mail first and then optionally issue a terse body-free poke to the role-named agent. The mailbox remains authoritative if the poke fails. Herdr process control and persona policy remain outside this package. Immutable `claim-events/` history is explicitly deferred in v1; claim files retain current state and monotonic transition versions.

See [the protocol design](docs/design.md) for record and concurrency details.
