# Offline mission conversation rotation (operator runbook)

Automated validation and operator-controlled disposable live acceptance passed
for retention and default deletion with direct/transitive children, live picker
hierarchy, relaunch/reuse, and fresh wake routing. See
[implementation evidence and limitations](long-running-mission-recovery-status.md).

## Before rotating

Review the existing repository execution/status document as the handoff. Do not
create a second mission-status document, copy model context, or replay every old
message. Stop every mission Pi process **including subagents**, and prevent any
manual/launcher starts until the operation finishes. A false downtime confirmation
can cause lost transcript writes, cursor divergence, or concurrent claim work.
Neither the operation lock, Herdr absence, nor roster expiry proves downtime.

Install/update once from the package checkout using the supported `just install`
workflow. It builds and installs the managed Pi extension and one `rotate`
executable in `~/mycelial`, beside `missions/`. No `PATH` setup or command
hierarchy is needed. Installation is separate from rotation and may sync build
dependencies; invoking the installed command does not install dependencies or
load project Bun configuration.

Then, from an independent operator control shell in **any directory**:

```sh
~/mycelial/rotate mission-id --dry-run
~/mycelial/rotate mission-id --save-history
# Default permanent deletion (review the displayed family):
~/mycelial/rotate mission-id
```

The mission ID resolves beneath the same global `missionRoot` configuration used
by Mycelial initialization (default `~/mycelial/missions`), using the existing
read-only config loader. No project-local config or inherited mission/session
binding selects the target. Configure custom roots as absolute paths for
cwd-independent selection. An explicit directory bypasses that lookup:

```sh
~/mycelial/rotate --mission-dir /absolute/missionRoot/mission-id --dry-run
```

Use the directory reported at initialization; do not combine an explicit
directory with a positional mission ID. Paths must be normalized, absolute, and
have no symlink ancestors; use canonical paths when the OS temporary directory
is an alias. `~/mycelial/rotate --help` describes the interface. Rotation is not registered
as an agent tool. Mutation requires an interactive TTY and refuses Pi agent shell
markers. There is no
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
is performed. Symlinks, unreadable roots/candidates, or unsupported headers make
deletion incomplete because their parent links cannot be inspected. Readable
orphaned or cyclic chains that never reach an old managed session are excluded
from the family, not deletion blockers. Directory names do not establish or
exclude membership. Retention may proceed with discovery warnings if core
managed files and protocol state validate.

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
~/mycelial/rotate mission-id --recover
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

## Validation and limitations

Disposable mission `rotation-acceptance` passed actual picker hierarchy,
retention, launcher reuse and trusted identities, preserved mail/receipts/released
claims, fresh Herdr wake routing, and default deletion with direct/transitive
children. A later default rotation preserved the earlier retained generation.
Relaunch after default deletion also passed. Failure/recovery boundaries are
covered by automated injected-failure tests, not a live-process crash exercise.
The operator subsequently completed Benny rotation successfully. Benny relaunch
has not yet been reported; no operator-provided Benny benchmark or model A/B has
been done.
