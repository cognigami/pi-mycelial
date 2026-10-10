# Reusable Mission Session Topology

## Status

Implemented with automated validation complete; live Herdr/session-picker
operator acceptance remains pending because validation was not run from a
Herdr-managed control shell. The implementation preserves the durable mailbox
protocol and does not make Mycelial a resident process supervisor. Execution is
tracked in
[`session-topology-implementation-plan.md`](session-topology-implementation-plan.md).

## Context

The generated mission launcher currently treats each configured role as all of
these things at once:

1. a capability such as builder or reviewer;
2. a unique mailbox participant;
3. a Herdr agent name; and
4. one newly created Pi conversation.

That model is simple, but it has two practical limitations. A mission cannot
express several builders with the same capability, and every launcher run starts
another unnamed Pi session instead of resuming the participant's existing
conversation. Repeated launches therefore pollute the session picker, while a
single builder declaration prevents the coordinator from exploiting safe
parallel work.

Pi already supports persistent named sessions, exact session reopening, and
parent-session relationships. Mycelial should compose those primitives during
mission initialization and launch. It should not add another session framework,
background supervisor, or context-lifecycle policy.

## Goals

- Let mission initialization declare more than one participant with the same
  capability.
- Give every participant a stable, human-readable Pi session.
- Present the coordinator as a top-level Pi session and workers as its children.
- Make the generated Herdr launcher idempotently reuse those sessions.
- Preserve trusted Mycelial identity and the existing mailbox and claim
  protocols.
- Preserve existing mission configuration forms and existing generated
  launchers.
- Keep parallel work safe enough for the existing shared-checkout model without
  requiring additional worktrees.

## Non-goals

- Dynamically create or retire workers during a running mission.
- Replace Pi's context compaction or monitor agents for semantic degradation.
- Kill or rotate sessions after an arbitrary context percentage or compaction
  count.
- Add a resident mission or process supervisor.
- Add capability-addressed mailbox delivery, load balancing, or a task queue.
- Add worktree management, file locks, or automated merge orchestration.
- Migrate or rewrite missions that were initialized by an earlier version.

## Terminology

- **Capability** describes what a participant is intended to do, such as
  `builder` or `reviewer`. Capabilities may repeat.
- **Participant** is one unique routable mission identity, such as `builder-1`.
  Mail, receipts, claims, roster records, Herdr names, and trusted runtime
  binding use the participant identity.
- **Pi session** is the persistent conversation assigned to one participant.
  Its process and terminal may stop and restart while the session remains.
- **Incarnation** is a running Pi process bound to a participant and its stable
  Pi session.

The existing protocol and CLI call the routable participant identity a `role`.
That field remains unchanged in this work for protocol compatibility. New
configuration may additionally record a `capability`; internally renaming every
protocol field is unnecessary.

## Participant multiplicity

The `--roles` grammar gains an optional positive count:

```text
/mycelial init release-42 --roles builder=3,reviewer
```

A role without a count, or with count one, retains its original identity:

```text
builder       -> builder
builder=1     -> builder
```

A role with count greater than one expands to stable participant identities:

```text
builder=3     -> builder-1, builder-2, builder-3
```

Every expanded identifier must pass the existing role identifier validation.
Expansion must reject collisions, including explicit names that collide with a
generated name, and must reject `all`, which remains the reserved broadcast
target. The coordinator remains a singleton: initialization adds one
`coordinator` participant by default, accepts an explicitly listed singleton,
and rejects coordinator multiplicity greater than one. `--no-coordinator`
continues to opt out.

The generated `agents.json` records unique participant identities and optional
capabilities. For example:

```json
{
  "agents": [
    { "role": "coordinator", "capability": "coordinator" },
    { "role": "builder-1", "capability": "builder" },
    { "role": "builder-2", "capability": "builder" },
    { "role": "reviewer", "capability": "reviewer" }
  ]
}
```

`role` remains the mailbox address. `capability` is planning and display
metadata only; it does not create a broadcast address. The coordinator assigns
independent requests directly to `builder-1`, `builder-2`, and so on. This keeps
delivery deterministic and avoids making several same-capability sessions race
over every message.

Existing string arrays, object-keyed agents, object entries using `role` or
`name`, and optional `preset` metadata remain valid. When `capability` is absent,
it defaults to the participant identity. Editing preset metadata remains safe,
but the initialized participant set is topology: adding or removing participant
identities by hand is unsupported because it would desynchronize agent and
session control files.

## Session control file

New missions add a package-owned `sessions.json` alongside `agents.json`. It
separates Pi conversation topology from mailbox participants and persona launch
metadata. Its conceptual shape is:

```json
{
  "formatVersion": 1,
  "sessions": {
    "coordinator": {
      "sessionId": "<pi-session-id>",
      "sessionFile": "<absolute-jsonl-path>",
      "name": "release-42: coordinator",
      "parent": null,
      "herdrName": "<mission-isolated-live-agent-name>"
    },
    "builder-1": {
      "sessionId": "<pi-session-id>",
      "sessionFile": "<absolute-jsonl-path>",
      "name": "release-42: builder-1",
      "parent": "coordinator",
      "herdrName": "<mission-isolated-live-agent-name>"
    }
  }
}
```

The exact session file path is recorded because Pi may be using a custom session
directory. Launch must reopen the created file rather than search whichever
session directory happens to be configured later. The session ID remains
recorded for validation and trusted runtime correlation. `herdrName` is an
explicit Herdr-global transport identity derived from the unique prepared Pi
session; legacy manifests may omit it and retain role-named launch behavior.

`sessions.json` is static initialization output in this design. It is not a
roster, liveness database, context monitor, or current-process registry. Runtime
presence remains in the existing Mycelial roster projection.

The launcher validates that `agents.json` and `sessions.json` contain the same
participant set, and that every selected session file is a regular file with the
expected session ID. Missing or inconsistent topology fails visibly; the
launcher must not silently create an unparented replacement conversation.

## Pi session hierarchy

Initialization pre-creates dormant, named Pi sessions with this topology:

```text
release-42: coordinator
├── release-42: builder-1
├── release-42: builder-2
└── release-42: reviewer
```

The coordinator has no parent session. In particular, the Pi conversation from
which `/mycelial init` was invoked is not part of the mission hierarchy. Worker
session headers point at the coordinator session file as their parent.

For a mission created with `--no-coordinator`, every participant is top-level.
No synthetic mission-root conversation is created.

Initialization uses the active Pi session directory when it is persistent,
including an explicit custom directory. If initialization runs from an
in-memory Pi session, it uses Pi's default persistent session directory for the
repository working directory. Every pre-created session uses the repository
working directory captured by mission initialization.

Pi normally delays writing sessions that contain only setup metadata. Mycelial
must explicitly materialize each dormant session as a valid JSONL file containing
its public session header and session-name entry. It must use Pi's public session
model to construct those records, write with exclusive creation, and avoid
private runtime state or copied ID-generation rules.

## Initialization atomicity and ownership

Pre-created sessions introduce artifacts outside the mission directory, so
initialization must retain its current all-or-nothing behavior across both
locations.

Before publication, initialization validates role expansion, participant
uniqueness, source artifacts, project shortcut absence, session directory, and
all destination paths. It constructs all session IDs, names, parent links, and
control-file content before publishing any of them.

During publication it tracks every exact artifact it creates. A failure removes
only those newly created session files, mission files, project links, and
repository guidance artifacts. It never removes a pre-existing path. Session
files use exclusive creation, and mission control publication remains
non-overwriting.

A successful mission owns its pre-created session files for launch purposes but
does not own their later transcript contents. Removing a mission must therefore
not imply deleting its Pi sessions. Mission deletion remains outside this
change.

## Idempotent Herdr launch

The generated launcher continues to be user-invoked composition. It does not
become a daemon or periodically reconcile processes.

For each selected participant, the launcher:

1. resolves the participant's preset from `agents.json` and exact Pi session
   plus explicit Herdr-global agent name from `sessions.json`;
2. checks whether that mission-isolated Herdr agent is already live;
3. reuses it instead of creating a duplicate process;
4. otherwise creates a tab and starts Pi by reopening the exact session file;
5. supplies the existing trusted `--mycelial-mission` and
   `--mycelial-role <participant>` bindings; and
6. passes `--presets:preset eng` unless the participant has a different
   `preset` in `agents.json`.

Participant identity remains the durable mailbox address. Herdr agent names are
separate transport identities derived from the prepared Pi session and recorded
in `sessions.json`, because Herdr names are global across concurrently live
workspaces and missions. The post-send notification adapter resolves the
participant through this mapping. Legacy manifests without the field continue
to use the participant name, preserving already-generated launchers. The
launcher reports each participant as `reused` or `started`, together with its
Herdr agent name and tab/pane information when newly started.

The launcher checks immediately before each start and treats a Herdr name
collision as a visible partial-launch failure, preserving the current policy of
leaving created tabs available for inspection. It does not add a second locking
or supervision system for an operator-only launch race that Herdr already
rejects by unique agent name.

Starting the same Pi session manually in another process remains unsupported.
Mycelial cannot make arbitrary external session writers safe.

## Startup and resume prompts

A relaunch cannot assume that a resumed coordinator is seeing the mission for
the first time. The coordinator startup prompt therefore becomes idempotent:
load the mission and canonical artifacts, refresh the roster, read durable mail,
reconcile existing requests and claims, and create assignments only where the
mission state requires them. It must not blindly decompose the mission again.

Workers are still normally awakened by durable assignment mail. Launching a
worker does not itself create a model turn when a coordinator is participating.
For coordinator-free or explicitly worker-only launches, the existing bounded
startup prompt becomes a resume prompt that first reads mission state and mail.

If the coordinator is already live and idle when the full mission launcher is
run, the launcher may submit the same idempotent reconciliation prompt. A
working or blocked coordinator is reported and left undisturbed. Live workers
are never prodded merely because the launcher was rerun; normal durable mail
notification remains responsible for actionable work.

## Parallel work in one checkout

Multiple participants share the same repository checkout unless the operator
explicitly provides another arrangement. Mycelial claims establish task
ownership, not filesystem isolation.

Generated mission guidance tells the coordinator to parallelize only requests
that are independent and to include non-overlapping path scopes when mutating
work is assigned concurrently. Work that touches the same files, repository-wide
formatting or generation, and version-control operations that mutate shared
working-copy state must be serialized. Read-only investigation and review may
run concurrently without path partitioning.

These are coordination rules rather than new locks. Mycelial does not infer file
ownership or attempt to merge concurrent edits.

## Context lifecycle

Stable session reuse delegates context-window management to Pi. Automatic
compaction remains the default response to growing context. Mycelial does not
publish context percentages in its roster, count compactions as a health
signal, or rotate sessions automatically.

Context utilization cannot reliably measure stale assumptions or degraded
judgment. Rotation also has protocol consequences: a new Mycelial session would
need a mailbox cursor handoff, must not inherit an active claim owned by the old
session, and must not run concurrently with it. A future explicit rotation
operation would need to define those semantics and preserve the old transcript.
It is intentionally outside this design.

## Compatibility

- Existing missions and their already generated launchers continue to work
  unchanged and need no `sessions.json`.
- The mailbox runtime continues accepting every currently supported
  `agents.json` form.
- New optional `capability` metadata is ignored by protocol routing.
- New launchers require the `sessions.json` they were generated with and fail
  visibly when it is missing or inconsistent.
- Message, receipt, claim, cursor, and roster record formats remain version 1.
- Trusted runtime session identity continues to come from the opened Pi session
  unless an authoritative explicit Mycelial session binding is supplied.

## Security and validation

Session IDs, participant IDs, and capabilities are validated before use.
`sessions.json` and referenced session files must be regular non-symlink files.
Parent links are generated by initialization rather than accepted from model
input. Launcher shell values remain quoted, and all JSON extraction remains
fail-closed.

The model never chooses its mission, participant identity, session file, or
parent relationship. Mail tools continue deriving identity from the trusted
runtime binding and do not gain identity parameters.

## Acceptance criteria

This design is satisfied when:

1. `/mycelial init` can expand a declaration such as `builder=2` into two unique
   routable participants.
2. Initialization creates a named top-level coordinator Pi session and named
   worker sessions parented to it.
3. The invoking init conversation is not a parent of the mission coordinator.
4. The generated launcher starts each absent participant in its exact
   pre-created session and reuses a matching live participant.
5. Re-running the launcher creates neither duplicate Pi conversations nor
   duplicate live participants.
6. Session names appear as `<mission>: <participant>`.
7. The coordinator can assign independent work to several same-capability
   participants while mailbox routing remains unambiguous.
8. Initialization failure leaves neither a partial mission nor orphaned session
   files created by that attempt.
9. Existing mission configurations, protocol records, and generated launchers
   retain their behavior.
10. Pi compaction remains the only automatic context-saturation mechanism.
