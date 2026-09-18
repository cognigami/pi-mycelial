# mycelial

A durable, local mission mailbox and task-claim Pi extension. Mycelial stores immutable messages and receipts, rebuildable inbox markers, per-session read state and presence, and lock-protected task leases.

**New users:** follow [Getting Started](docs/getting-started.md) to initialize a mission, launch all configured roles through Herdr, or use ordinary manually launched Pi agents. A minimal mission is available in [`examples/mission/`](examples/mission/).

## Install

```sh
just build
just install
```

The managed artifact is `dist/index.js`. Set `PI_CODING_AGENT_DIR` to install into an isolated Pi agent directory. The package also declares the neutral `mycelial-coordination` skill through standard `pi.skills`; pi-extension-kit installs and contributes it only while the managed extension is enabled and loaded. A loaded but unbound extension may advertise the skill, but its procedures apply only when Mycelial tools are available or a mission has been declared.

## Mission setup

The default mission base is `~/mycelial/missions` (override `missionRoot` in `~/.config/pi-extensions/mycelial/*.jsonc`). From a Pi session in the target repository, initialize a mission with:

```text
/mycelial init release-42 --roles implementer,reviewer [--from docs/release-42-plan.md]
```

The command refuses overwrite and creates:

```text
<missionRoot>/<mission-id>/
  mission.md
  agents.json
  repos.json
  launch-herdr.sh
```

It also creates `./launch-mycelial-<mission-id>.sh` in the repository as a non-overwriting symlink to the canonical launcher. If the repository has no `AGENTS.md`, initialization creates a non-overwriting guidance scaffold; an existing `AGENTS.md` is never modified.

A `coordinator` role is added by default and receives the first startup prompt so it can create durable initial assignments before workers are notified. Pass `--no-coordinator` only for a deliberately peer-coordinated mission.

With `--from`, the source Markdown remains a canonical repository artifact and generated `mission.md` references it; Mycelial does not copy the source into mission storage. Without `--from`, initialization generates an editable mission scaffold. Bound agents read `mission.md` explicitly with `agent_mission_read`. It supplements and never overrides repository `AGENTS.md`.

`agents.json` may be an array of role names, an object keyed by role, or `{ "agents": [...] }`. An object entry may define optional launcher metadata, for example `"reviewer": { "preset": "domain-auditor" }`. `repos.json` accepts the corresponding alias forms. Repository aliases are metadata and do not resolve to filesystem paths in v1. Generated protocol directories are created lazily. Symlinked protocol control paths are rejected.

From a Herdr-managed control shell in the repository, run `./launch-mycelial-<mission-id>.sh` with no arguments to launch every configured role in its own tab, or pass role names to launch a subset. A configured preset is forwarded as `--presets:preset`; Mycelial does not select models or providers.

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

`agent_mission_read`, `agent_mail_send`, `agent_mail_read`, `agent_mail_ack`, `agent_mail_reply`, `agent_task_claim`, `agent_task_release`, `agent_roster`, and `agent_wake` are available only after successful binding. Reads are non-destructive and session-scoped. `all` excludes the sender and records a static recipient snapshot. Task contention is a structured successful result rather than a tool exception.

Use one request message per independently claimable task and use its message ID as the default task ID and source message ID. Claims—not roster presence or accepted receipts—establish ownership.

Mycelial does not poll or watch inboxes. Its generated, user-invoked launcher composes Herdr and Pi without moving process supervision into mailbox runtime code. After durable send or reply succeeds, `agent_wake` can issue a fixed, content-free notification to the role-named Herdr agent. The target must be another configured mission role, and the mailbox remains authoritative if the best-effort wake-up fails. Automatic runtime notification adapters and persona policy remain outside the mailbox layer. Immutable `claim-events/` history is explicitly deferred in v1; claim files retain current state and monotonic transition versions.

See [the protocol design](docs/design.md) for record and concurrency details.
