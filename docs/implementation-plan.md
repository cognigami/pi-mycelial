# Pi Mycelial Implementation Plan

## Status

Implemented for the package-owned v1 layers (work packages 0–10). Work package
11 remains intentionally deferred because it belongs in separate Herdr and
pi-presets changes. The approved standalone-adoption follow-up is complete: the
package now includes managed neutral guidance, a sample mission and short setup
guide, operator-only trusted footer binding, and actionable read formatting.
It adds no receiver-side polling notifier or process-control integration. The work is ordered from
the logically innermost correctness loops—validated records and filesystem
publication—outward through mailbox workflows, Pi tools, lifecycle integration,
and finally Herdr/persona integration.

## Delivery decision

Implement `pi-mycelial` as a managed local Pi extension using
`../pi-extension-kit` for package tooling, config, logging, test helpers, and
optional tool chrome. Keep the mission protocol and its concurrency primitives
package-owned; the kit's XDG storage helpers do not provide mailbox fan-out,
receipt semantics, per-task locking, or claim fencing.

The package should still be a normal Pi package with a `pi.extensions` entry and
a built `dist/index.js`. Managed installation is the local deployment mechanism,
not a dependency of the mailbox domain model.

## Design closure before behavioral implementation

Resolve these points in code contracts and, ideally, reflect them back into
`docs/design.md` before declaring the protocol stable:

1. **ULID wording:** a ULID is 128 bits total, with 80 random bits; it does not
   provide 128 bits of entropy.
2. **Routing:** v1 supports a named role and `all`. `all` expands against the
   static roles in `agents.json`, and the expanded recipient snapshot is stored
   in the immutable message. Named channels remain deferred until their
   membership schema is designed.
3. **Reply linkage:** add `in_reply_to` to replies. A reply inherits the original
   thread, or uses the original message ID as the thread root.
4. **Cursor semantics:** do not use a single ULID high-water mark. A sender can
   allocate an earlier ULID, pause, and publish after a later message has already
   advanced the cursor. For v1, store the bounded set of message IDs returned to
   each session and reconcile it against inbox markers. Serialize concurrent
   reads from the same Pi session in process.
5. **Abandoned locks:** never break a lock based only on elapsed wall-clock time.
   Store an owner token, PID, session, and acquisition time in the lock directory.
   Recover only when the owner is proven dead; otherwise report contention and
   leave the lock intact. `version` detects bad transitions but is not itself a
   filesystem compare-and-swap primitive.
6. **Delivery projection:** the immutable message's recipient snapshot is the
   delivery truth. `inbox/<role>/<id>.json` is a rebuildable projection. This
   permits recovery if the process stops after publishing the message but before
   publishing every inbox marker.

These are protocol details, not optional optimizations. Tests for delayed
publication, partial fan-out, parallel tool calls, and abandoned locks should be
written with the layer that implements each rule.

## Target package shape

```text
package.json
Justfile
biome.json
tsconfig.json
README.md
src/
  index.ts                  # thin Pi composition root
  config.ts                 # global kit-backed runtime config
  identity.ts               # trusted launcher/session binding
  identifiers.ts            # validation and ULID generation
  protocol.ts               # shared record types and enums
  message-codec.ts          # Markdown/frontmatter parsing and formatting
  receipt-codec.ts
  claim-codec.ts
  mission.ts                # agents/repos loading and recipient resolution
  paths.ts                  # validated mission path construction
  filesystem.ts             # injectable filesystem contract and Node adapter
  atomic-files.ts           # immutable publish and mutable atomic replace
  task-lock.ts              # per-task lock acquisition/recovery/release
  mailbox-store.ts          # immutable messages, markers, receipts
  projections.ts            # cursors, claims, and roster records
  runtime.ts                # session lifecycle and heartbeat ownership
  tool/
    send.ts
    read.ts
    ack.ts
    reply.ts
    task-claim.ts
    task-release.ts
    roster.ts
```

Tests should be co-located with their owning modules. Use memory fakes for pure
workflow and tool tests, and real temporary directories only for behavior whose
subject is filesystem atomicity, locking, permissions, or crash recovery.

## Dependency direction

```text
identifiers + protocol + codecs
              ↓
paths + filesystem + atomic-files + task-lock
              ↓
mission + mailbox-store + projections
              ↓
send/read/ack/reply and claim/release workflows
              ↓
Pi tool definitions
              ↓
identity + runtime lifecycle
              ↓
managed package composition
              ↓
personas, notifications, and Herdr integration
```

No inner layer imports Pi APIs. The storage layer does not know about prompts,
interrupt policy, or personas.

## Work package 0 — Package bootstrap

This is mechanical enablement, not the first domain layer.

- Add the standard kit-backed package metadata and Justfile recipes.
- Use package name `mycelial` unless a different installed identity is desired.
- Declare Pi host packages and `pi-extension-kit` as peers; make the kit an
  optional peer and a `file:../pi-extension-kit` development dependency.
- Add the `pi.extensions: ["./dist/index.js"]` manifest entry.
- Start with an empty composition root that loads without registering tools.
- Add one package-load smoke test.

**Exit criterion:** `just build` produces `dist/index.js`, and the empty package
can be loaded through a temporary Pi agent directory.

## Work package 1 — Pure protocol kernel

Build the deterministic, side-effect-free core first.

### 1.1 Identifiers and time

- Define validated mission, role, session, task, repository-alias, and message
  identifier types.
- Centralize charset and length limits. Reject separators, dot segments, control
  characters, empty strings, and platform-ambiguous names.
- Inject `Clock` and `IdGenerator` interfaces rather than calling `Date.now()` or
  ULID generation throughout the code.
- Use a maintained ULID implementation rather than writing Crockford encoding by
  hand.

### 1.2 Record contracts

Define versioned records for:

- immutable messages, including semantic `to`, expanded `recipients`, optional
  `in_reply_to`, and trusted sender identity;
- delivery markers;
- receipt events;
- current claims;
- cursor state;
- roster presence;
- task-lock ownership metadata.

Keep transport values such as priorities, interrupt modes, message kinds,
receipt events, and claim statuses as closed enums. Add a `formatVersion` field
where future incompatible changes would otherwise be ambiguous.

### 1.3 Codecs

- Parse and format Markdown plus YAML frontmatter for messages.
- Parse and format receipt and claim YAML deterministically.
- Validate both newly created records and records read from disk.
- Preserve message bodies exactly apart from one documented trailing-newline
  rule.
- Return typed corruption errors containing the offending path but not arbitrary
  unbounded file content.

### Tests

- Round-trip every record type.
- Reject missing, extra, malformed, and path-unsafe fields.
- Verify UTC timestamps and deterministic output.
- Cover frontmatter delimiters inside message bodies.
- Verify sender, session, mission, and role are absent from model-facing input
  schemas later; those values belong only in these trusted records.

**Exit criterion:** protocol records can be created, serialized, parsed, and
validated without Pi or filesystem dependencies.

## Work package 2 — Filesystem correctness substrate

This layer owns the guarantees on which every higher loop depends.

### 2.1 Filesystem port and mission paths

- Define the smallest injectable filesystem interface needed by the stores.
- Implement a Node filesystem adapter.
- Resolve one configured mission root and construct paths only from validated
  identifiers.
- Reject unexpected symlinks for protocol control files and directories where a
  symlink could escape the mission boundary.
- Require `mission.md` and valid `agents.json`; create only generated protocol
  directories lazily. Do not silently invent a mission or static role roster.

### 2.2 Atomic primitives

Implement two distinct operations:

- `publishImmutable(path, bytes)`: write and sync a unique temporary file, then
  publish without replacing an existing final record. On local POSIX filesystems,
  a same-directory hard link is a practical no-clobber publication primitive;
  document or replace it if other filesystem support is required.
- `replaceMutable(path, bytes)`: write and sync a unique temporary file, then
  atomically rename it over the mutable projection.

Both operations clean temporary files best-effort after failure. Immutable
publication treats an existing destination as an idempotency/collision case and
must compare or reject it; it never overwrites it.

### 2.3 Process-local serialization

Pi may execute sibling tool calls concurrently. Add a keyed in-process mutex for
operations that can target the same session cursor, roster record, or task. Do
not assume “one writer per session” means “one call at a time.”

### Tests

- Concurrent immutable publication never overwrites a winner.
- Mutable replacement never exposes partial content.
- Failed writes and failed publication clean temporary files.
- Path traversal and symlink escapes are rejected.
- Two independent store instances can operate in the same temporary mission.

**Exit criterion:** higher layers can rely on explicit immutable-publication and
mutable-replacement contracts rather than open-coding filesystem writes.

## Work package 3 — Mission loading and routing

- Parse `agents.json` and `repos.json` into validated snapshots.
- Validate the bound role against `agents.json` during session activation.
- Resolve a direct role to one recipient.
- Resolve `all` to a sorted, deduplicated snapshot of configured roles; decide
  explicitly whether the sender is included, with v1 defaulting to exclusion.
- Validate an optional `repo` against `repos.json`.
- Store expanded recipients in the message so later config edits do not change
  historical delivery meaning.

### Tests

- Unknown sender/recipient/repository aliases fail before any write.
- `all` resolution is deterministic and records a stable snapshot.
- Changes to `agents.json` after send do not alter existing message recipients.

**Exit criterion:** routing is a pure operation over a validated mission
snapshot.

## Work package 4 — Immutable send loop

Implement the smallest complete durable operation:

```text
trusted identity + validated send input
  → immutable message
  → rebuildable delivery markers
  → concise result
```

- Generate the message ID and timestamp once.
- Publish the canonical message before any delivery marker.
- Publish one marker per expanded recipient, idempotently.
- If marker fan-out is interrupted, preserve the canonical message and report the
  incomplete recipients. A retry/reconciliation pass must be able to publish the
  missing markers from the message's recipient snapshot.
- Add a reconciliation operation used internally by reads and startup checks;
  do not expose a separate model tool initially.
- Enforce message-body and metadata size limits at send time.

### Tests

- Direct and `all` delivery.
- Duplicate publication does not overwrite another message.
- Failure after canonical publication is recoverable.
- Concurrent senders to one role lose no messages.
- A recipient added after send does not receive historical `all` mail.

**Exit criterion:** once a canonical message exists, every intended inbox marker
can always be reconstructed.

## Work package 5 — Read, receipt, and reply loop

### 5.1 Reading and cursor projection

- Scan the bound role's marker filenames and reconcile missing markers from
  canonical messages when required.
- Compare against the calling session's returned-ID state, not a ULID high-water
  mark.
- Sort deterministically by message creation time and ID.
- Read only the messages selected for the bounded result.
- Update cursor state only for messages actually returned, under the keyed
  process-local mutex.
- Provide an explicit replay/since option so durable records remain recoverable
  even after cursor advancement.
- Bound message count and aggregate output bytes to stay below Pi tool-output
  limits. Never advance past messages omitted by truncation.

### 5.2 Receipts

- Append one immutable receipt event per acknowledgement call.
- Derive latest receipt state by `(message, role/session)` only when requested.
- Validate that the bound role is a recipient before accepting a receipt.
- Define deterministic ordering for equal timestamps using event ULID.
- Keep state-transition policy minimal: reject structurally impossible events,
  but leave workflow routing policy to personas.

### 5.3 Replies

- Load the referenced message.
- Address the reply to the original sender role.
- Set `in_reply_to` and inherit/create the thread.
- Delegate publication to the same immutable send path rather than implementing
  a second writer.

### Tests

- Reads do not alter messages or shared receipt state.
- Two live sessions of one role maintain independent returned-ID state.
- Parallel reads in one session do not lose cursor updates.
- A delayed lower ULID remains discoverable.
- Read limits do not hide omitted messages permanently.
- Receipt events append rather than overwrite.
- Reply linkage and recipient selection are correct.

**Exit criterion:** two identities can complete send → read → acknowledge → reply
using only package APIs and a temporary mission directory.

## Work package 6 — Claim and release loop

Build claims only after immutable audit and filesystem primitives are proven.

### 6.1 Task mutex

- Acquire with atomic `mkdir claims/<task>.lock/`.
- Write lock owner metadata containing a random owner token, process PID,
  session, and acquisition timestamp.
- Return structured contention with bounded retry/backoff; contention is not a
  thrown tool failure.
- Before mutating a claim, verify that the canonical lock still contains the
  caller's token.
- Release only a lock whose token matches.
- Recover an abandoned lock only when local process liveness proves its owner is
  gone. Rename the abandoned directory to a unique quarantine path before
  removing it, so recovery contenders cannot remove a newly acquired lock.
- Log and surface locks whose owner cannot be proven dead; do not guess.

### 6.2 Claim transitions

Under the task mutex:

- absent/released → claimed;
- same agent and session → renewed;
- live claim owned by another session → contended;
- expired claim → takeover with observed prior version recorded;
- owner release → released;
- non-owner release → rejected without mutation.

Increment `version` for every successful mutable transition. Use injected time
and enforce configured minimum/maximum lease durations.

Implement `claim-events/` in the same work package if complete task ownership
history is a v1 requirement. If it remains optional, explicitly defer it rather
than making current-state mutation depend on a best-effort second write.

### Tests

- Many concurrent claimers produce exactly one initial owner.
- Owner renewal extends expiry and increments version.
- Non-owner renewal/release cannot mutate state.
- Expired takeover records the observed prior version.
- A crashed/dead owner lock can be recovered.
- A live or unprovable owner lock is never time-broken.
- Lock release occurs on every success and error path.

**Exit criterion:** claim ownership remains correct under contention, expiry,
errors, and proven-dead-owner recovery.

## Work package 7 — Presence and trusted runtime identity

### 7.1 Config and identity

Use `pi-extension-kit/files` for global JSONC config and logging. Initial config:

- mission root, defaulting to `~/agent-work/missions`;
- heartbeat interval and presence TTL;
- default and allowed claim lease durations;
- read count/body limits;
- lock retry/backoff limits.

Do not accept project-local config for identity. Resolve identity with explicit
precedence:

1. `--mycelial-mission` / `--mycelial-role` and an optional explicit session;
2. `PI_MYCELIAL_MISSION` / `PI_MYCELIAL_ROLE` / session equivalent;
3. Pi's trusted `ctx.sessionManager.getSessionId()` as the session fallback.

Never infer role from a preset and never generate a replacement identity inside
a tool execution.

If mission or role binding is absent, keep the extension inert and do not add
mailbox tools to ordinary Pi sessions. If binding is present but invalid, report
one startup diagnostic and remain inert.

### 7.2 Roster lifecycle

- Write the calling session's presence record on `session_start`.
- Start a session-scoped heartbeat timer only after successful binding.
- Serialize heartbeat and manual roster refreshes with the process-local mutex.
- On `session_shutdown`, stop the timer idempotently and write a short final
  expiry/best-effort offline state.
- Roster reads return all non-expired sessions per role; do not collapse multiple
  live sessions into a fictitious single owner.

### Tests

- Flag/environment precedence.
- Partial or forged bindings fail closed.
- Missing binding leaves the extension inert.
- Heartbeats update only the bound session's file.
- Multiple sessions of one role remain visible independently.
- Shutdown cleanup is idempotent.

**Exit criterion:** runtime identity is immutable for one extension instance and
presence accurately reflects multiple sessions.

## Work package 8 — Pi tool adapters

Create one concrete tool definition per `src/tool/*` module, following the
`pi-extension-kit` extension structure standard. Each module owns its schema,
metadata, execution, rendering, and tests.

### Model-facing schemas

- Set `additionalProperties: false` on every object schema.
- Exclude mission, role, sender, and session fields entirely.
- `agent_mail_send`: `to`, body, and optional message metadata.
- `agent_mail_read`: bounded filters/replay controls only.
- `agent_mail_ack`: message ID, receipt event, optional note/delegation detail.
- `agent_mail_reply`: source message ID, body, optional priority/interrupt
  overrides.
- `agent_task_claim`: task ID, optional source message ID and lease duration.
- `agent_task_release`: task ID and optional note.
- `agent_roster`: read/refresh behavior without arbitrary roster writes.

Tool methods derive trusted identity from the injected bound runtime. Errors
should distinguish malformed input, corrupt mission state, contention, and I/O
failure. Expected contention is a successful structured result; corrupt state or
I/O failure throws.

Keep collapsed rendering concise. Full message bodies belong in read results,
not send/ack call rows. Add prompt guidance naming each tool explicitly.

### Tests

- Capture each registered tool with kit testing helpers.
- Characterize names, labels, descriptions, schemas, and registration order.
- Prove extra identity fields are rejected.
- Execute tools against fake stores and fixed identities.
- Cover concise rendering and expanded diagnostics.

**Exit criterion:** every package-owned tool contract is independently
reviewable and tested without host filesystem access.

## Work package 9 — Composition and managed installation

- Keep `src/index.ts` declarative: create kit files/logger, register flags,
  construct runtime, bind lifecycle, and register tools after successful session
  identity resolution.
- Avoid a forwarding aggregate registrar.
- Ensure dynamic registration occurs once per extension instance and does not
  alter unrelated active tools.
- Add structured lifecycle and corruption/repair logging without logging message
  bodies by default.
- Add README setup covering managed install, launcher flags/environment, config,
  mission prerequisites, and the inert unbound state.
- Validate `just build` and install against a temporary `PI_CODING_AGENT_DIR`.

**Exit criterion:** the managed artifact loads, remains invisible when unbound,
and exposes the seven tools when bound to a valid mission.

## Work package 10 — End-to-end and fault-injection gate

Construct one real-filesystem scenario with coordinator, implementer, and
reviewer identities:

1. Start three independent store/runtime instances.
2. Register three roster entries.
3. Send direct and `all` messages concurrently.
4. Read from two sessions sharing one role and verify independent state.
5. Append `seen`, `accepted`, and `done` receipts.
6. Reply across a thread.
7. Race multiple claimers, renew the winner, expire it, take it over, and release.
8. Interrupt fan-out and repair missing delivery markers.
9. Simulate a dead lock owner and recover it without disturbing a live lock.
10. Restart a role under a new session and verify durable mail and receipt
    history remain available.

Also fuzz validated path segments and malformed on-disk records. Verify no
operation writes outside the temporary mission root and no output exceeds its
configured model-facing limit.

**Exit criterion:** build, unit tests, concurrency tests, integration tests, and
Biome all pass in one `just build` run.

## Work package 11 — Outer integrations

These are deliberately last because they consume the stable mailbox API.

### Persona guidance

Update pi-presets persona sources in a separate change, using the
persona-maintenance workflow. Teach each role:

- when to poll;
- acknowledgement expectations by priority;
- claim renewal/release checkpoints;
- escalation and handoff behavior.

Do not encode these policies in mailbox tool execution.

### Notification delivery

- First inspect and characterize the existing Herdr turn-completion watcher.
- Add a narrow adapter that emits body-free mailbox notifications.
- Map `now`/`safe` to Pi steering, `task-boundary` to follow-up, and
  `next-checkpoint` to no triggered turn.
- Deduplicate notifications independently per receiving session.
- Keep the mailbox extension usable through explicit polling when the watcher is
  absent.

### Herdr launcher integration

- Pass mission and role binding explicitly when starting Pi.
- Pass or expose the authoritative Herdr session identity when available.
- Use roster state only for discovery/status; mailbox addressing remains by
  role.
- Add fallback prompting only after native notification behavior is stable.

**Exit criterion:** removing Herdr and pi-presets integrations still leaves a
fully functional durable mailbox extension.

## Suggested change sequence

Keep the implementation reviewable as a stack of independently valid changes:

1. Package bootstrap and pure protocol contracts.
2. Filesystem/path/atomic publication primitives.
3. Mission loading, routing, immutable messages, and marker reconciliation.
4. Read cursors, receipts, and replies.
5. Task mutexes and claim transitions.
6. Identity, roster, heartbeat, and inert-unbound lifecycle.
7. Seven Pi tool definitions and composition.
8. End-to-end fault/concurrency hardening and documentation.
9. Persona guidance, watcher adapter, and Herdr launcher integration as separate
   cross-repository changes.

Do not begin an outer change while an inner layer still has unresolved
concurrency or recovery semantics.

## Definition of done for v1

- All identity-bearing fields come from trusted runtime state.
- Every path segment is validated before path construction.
- Messages and receipts are immutable and no-clobber.
- Delivery markers are reconstructable from immutable messages.
- Reads from concurrent sessions do not consume each other's mail or skip
  delayed publication.
- Claim acquisition has one winner and abandoned-lock recovery never steals from
  a live owner.
- Roster presence represents multiple sessions accurately.
- Tool output is bounded and schemas reject identity injection.
- The extension is inert outside explicitly bound mission sessions.
- Managed build/install, tests, lint, and the full multi-agent scenario pass.
- Notification and persona policy remain optional outer integrations rather than
  storage dependencies.
