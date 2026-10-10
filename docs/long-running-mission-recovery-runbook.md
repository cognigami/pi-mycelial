# Offline mission conversation rotation (operator preview)

Automated implementation is available; **release acceptance is not complete**.
Do not use live Benny history for acceptance. First exercise an operator-controlled
disposable mission with retention, then default deletion and a known child tree.
See [implementation evidence](long-running-mission-recovery-status.md).

## Before rotating

Review the existing repository execution/status document as the handoff. Do not
create a second mission-status document, copy model context, or replay every old
message. Stop every mission Pi process **including subagents**, and prevent any
manual/launcher starts until the operation finishes. A false downtime confirmation
can cause lost transcript writes, cursor divergence, or concurrent claim work.
Neither the operation lock, Herdr absence, nor roster expiry proves downtime.

Before invoking rotation, explicitly prepare dependencies and validate this
checkout using the supported `just build` workflow. Setup may install dependencies
and write its sync stamp; it is separate from rotation and dry run. The `rotate`
recipe has **no sync/install prerequisite** and invokes Bun with `--no-install`
to disable import-time automatic installation before CLI safeguards run. Missing Bun or dependencies produce
an ordinary startup refusal; rotation never installs them or refreshes a stale
sync stamp automatically.

Then, from an independent operator control shell in this package checkout:

```sh
just rotate --mission-dir /absolute/missionRoot/mission-id --dry-run
just rotate --mission-dir /absolute/missionRoot/mission-id --save-history
# Default permanent deletion, only after disposable acceptance:
just rotate --mission-dir /absolute/missionRoot/mission-id
```

The directory is explicit and authoritative: this adapter does **not** load
extension JSONC configuration or infer identity from flags/environment. Use the
mission directory reported at initialization, including any configured custom
mission root. Paths must be normalized, absolute, and have no symlink ancestors;
use canonical paths when the OS temporary directory is an alias. The command
runs the repository's Bun source through the supported Justfile recipe; it is
not registered as an agent tool and is not an installed-extension CLI. Mutation
requires an interactive TTY and refuses Pi agent shell markers. There is no
`--yes` or unattended bypass. Cancellation is rechecked immediately before the
actual manifest rename, after all manifest staging awaits. Cancellation after
publication cannot roll back active replacements; normal manifest classification
and explicit recovery apply.

Dry run is read-only: no operation lock, directories, sessions, UUIDs, cursors,
markers, receipts, claims, roster refresh, manifest change, or prompts. It shows
roles, roots, exact verified old family, unread canonical mail (including missing
markers), live old-session claims, and refusal reasons. It neither reserves a
snapshot nor establishes downtime. Real runs repeat the checks under exclusion,
show warnings/scope, and require downtime and final destructive confirmations.

Only initialized missions with an existing `sessions.json`, regular launcher,
and a coordinator are supported. All old participants must share the coordinator
cwd; replacement sessions use its existing directory. This is not migration or
dynamic participant creation.

## Scope and durable state

Discovery recursively scans `<getAgentDir()>/sessions` (normally
`~/.pi/agent/sessions`, respecting `PI_CODING_AGENT_DIR`) and old participant
session directories outside that tree. Pi's `PI_CODING_AGENT_SESSION_DIR`,
`--session-dir`, and `sessionDir` setting do not redefine this default discovery
root: the old participant file paths supply their custom roots. Custom children
in other, unlisted directories require `--save-history`. No machine-wide scan
is performed. Symlinks, unreadable roots/candidates, unsupported headers, or
unverified/cyclic parent chains make deletion incomplete. Retention may proceed
with discovery warnings if core managed files and protocol state validate.

Default cleanup permanently unlinks exactly the verified old managed JSONL files
and recursively discovered descendants, children first, **last**, after one
atomic manifest switch and replacement validation. It does not delete unrelated
conversations in those directories. `--save-history` keeps old files at their
original paths. Durable mail, receipts, linked threads, old cursors, roster,
claims, mission/agents/repositories configuration, repository artifacts, and
launcher bytes stay unchanged under both policies.

Fresh cursors copy exactly old returned IDs. Pending/new/delayed mail remains
unread; intentional `agent_mail_read` replay remains available. A receipt does
not transfer a claim: new sessions cannot renew/release or work a still-live
old-session task until normal lease expiry and a successful new claim. Arrange
release before stopping the owner if waiting is undesirable.

After success, run the **existing** project launcher normally. It rereads
`sessions.json`, opens the fresh files, and uses fresh Herdr identities for the
same mission and roles. Its `eng` default/explicit presets remain unchanged.
It creates no duplicate fresh conversations on reruns. No claim or context is
injected into the fresh model history.

## Interruption and recovery

`.session-rotation/` is a mission-local exclusive operation directory with an
owner token and short-lived `recovery.json`. It is not a liveness oracle or a
long-term audit database. Never clear it while a rotation process might run.
A separate `.session-rotation-recovery/` directory excludes concurrent recovery
invocations; it also never auto-breaks on age or PID.

```sh
just rotate --mission-dir /absolute/missionRoot/mission-id --recover
```

First establish that the prior rotation process has exited. Recovery asks for
that confirmation and mission-wide downtime again. Do not alter the recorded
policy using `--save-history`; the CLI refuses that combination. Recovery does
not prepare another tree.

- Exact old manifest active: recovery removes only new artifacts with persisted
  device/inode **and content** ownership evidence. A byte-identical preexisting
  collision is not owned. Empty directories are removed only with matching
  ownership evidence. Manifest temporary stages use the same ownership evidence;
  final `sessions.json` is never a rollback-owned artifact. Stages interrupted before evidence are retained/reported
  for manual inspection, not guessed safe to delete.
- Exact intended new manifest active: replacements are preserved. Recovery
  validates their headers/cursors and unchanged mission controls, shows the
  recorded family, reconfirms destruction when applicable, removes only verified
  owned session/cursor/manifest temporary stages, then resumes old-tree cleanup.
  A stage-cleanup failure retains its recovery evidence and reports exact residue;
  active final sessions/cursors are never removed. Old history stays retained
  until that preparation residue is resolved, so transcript deletion remains last. Already missing old files are harmless. A changed old header stops
  cleanup and retains its parents. Never rerun preparation or blindly restore
  the old manifest merely because old files remain.
- Manifest absent/unreadable/unexpected: preserve both trees and operation
  information; manual intervention is required. A rename can succeed before a
  directory-sync exception. Exceptions are not evidence of rollback.

`recovery-required` distinguishes committed-but-incomplete cleanup and prints
remaining paths. If only operation metadata removal fails after completed
history handling, the output names `.session-rotation` rather than claiming old
files remain. If a leftover lock has **no readable recovery record**, do not
run a fresh rotation: verify the prior process is gone, inspect the manifest,
owner file, directory contents, and exact preparation residue manually before
removing only those control files/empty operation directories. Never recursively
remove either transcript family. A leftover recovery-exclusion directory also
requires explicit operator verification and empty-directory removal before
retry; it cannot establish agent downtime.

## Operator release acceptance still required

In a disposable mission, verify the actual picker hierarchy, first retention
rotation, launcher reuse and trusted identities, mail/claim semantics, live
Herdr wake routing, then default deletion with direct/transitive known children.
Fake-Herdr tests prove argument routing, not live process lifecycle. No live
Benny rotation, operator-provided Benny benchmark, or model A/B has been done.
