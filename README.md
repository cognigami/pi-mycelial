# mycelial

A durable, local mission mailbox and task-claim Pi extension. Mycelial stores immutable messages and receipts, rebuildable inbox markers, per-session read state and presence, and lock-protected task leases.

## Install

```sh
just build
just install
```

The managed artifact is `dist/index.js`. Set `PI_CODING_AGENT_DIR` to install into an isolated Pi agent directory.

## Mission setup

The default mission base is `~/agent-work/missions` (override `missionRoot` in `~/.config/pi-extensions/mycelial/*.jsonc`). A mission must already contain:

```text
<missionRoot>/<mission-id>/
  mission.md
  agents.json
  repos.json       # optional
```

`agents.json` may be an array of role names, an object keyed by role, or `{ "agents": [...] }`. `repos.json` accepts the corresponding alias forms. Generated protocol directories are created lazily. Symlinked protocol control paths are rejected.

Bind identity explicitly:

```sh
pi --mycelial-mission launch-42 --mycelial-role implementer
```

Environment equivalents are `PI_MYCELIAL_MISSION`, `PI_MYCELIAL_ROLE`, and optional `PI_MYCELIAL_SESSION`. Flags take precedence. Without both mission and role, the extension is inert and registers no mailbox tools. Role is never inferred from a persona or accepted in tool input.

## Configuration

Global JSONC fragments under `~/.config/pi-extensions/mycelial/` can set:

- `missionRoot`
- `heartbeatIntervalMs`, `presenceTtlMs`
- `defaultLeaseMs`, `minLeaseMs`, `maxLeaseMs`
- `readLimit`, `readMaxBytes`, `messageMaxBytes`
- `lockRetries`, `lockBackoffMs`

No project-local identity configuration is read. Immutable publication uses same-directory hard links for no-clobber semantics and therefore targets local POSIX filesystems in v1.

## Tools

`agent_mail_send`, `agent_mail_read`, `agent_mail_ack`, `agent_mail_reply`, `agent_task_claim`, `agent_task_release`, and `agent_roster` are available only after successful binding. Reads are non-destructive and session-scoped. `all` excludes the sender and records a static recipient snapshot. Task contention is a structured successful result rather than a tool exception.

Mycelial is polling-first. Notification watchers, Herdr launch integration, and persona policy are optional outer integrations and are not required by the mailbox protocol. Immutable `claim-events/` history is explicitly deferred in v1; claim files retain current state and monotonic transition versions.
