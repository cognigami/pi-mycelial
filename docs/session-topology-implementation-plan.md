# Reusable Mission Session Topology — Execution Plan

## Status

Ready for orchestrated execution after the contract gate in Work Package 0
passes. This plan implements
[`session-topology-design.md`](session-topology-design.md). It deliberately does
not include session rotation, context monitoring, dynamic worker creation, or
worktree management.

## Outcome

A newly initialized mission can declare repeated capabilities such as
`builder=3`. Initialization creates one stable, named Pi session per unique
participant, with a top-level coordinator and worker sessions parented to it.
The generated Herdr launcher starts absent participants in those exact sessions
and reuses already-live participants instead of creating duplicate
conversations.

Existing missions, protocol records, and already generated launchers retain
their behavior.

## Execution rules

- Use one shared checkout. Do not create worktrees.
- The orchestrator owns all version-control operations, integration edits, and
  repo-wide validation.
- Parallel workers may edit only the disjoint path sets assigned below. They
  must not run version-control mutations, dependency changes, repo-wide
  formatting, or cleanup commands.
- A parallel worker may run focused tests for its own files. The orchestrator
  runs full test, lint, and build commands only after each parallel wave joins.
- Do not begin a package whose prerequisites have not met their exit criteria.
- Keep each work package independently reviewable. If the repository is being
  recorded as a JJ stack, prefer one described change per numbered package or
  cohesive subpackage.
- Stop at Work Package 0 if the supported Pi API and documented session format
  cannot safely materialize a named, message-empty session. Do not substitute a
  private method or a synthetic user/assistant message.

## Dependency graph

```text
WP0  Session materialization contract gate
 |
 v
WP1  Shared participant and topology contracts
 |\
 | +-------------------+
 v                     v
WP2A CLI + agent       WP2B Session manifest +
     compatibility          materializer
 |                     |
 +----------+----------+
            v
WP3  Transactional mission initialization
            |
            v
WP4  Idempotent reusable-session launcher
           / \
          v   v
WP5A Guidance/docs   WP5B Adversarial integration tests
          \   /
           v v
WP6  Full validation and operator acceptance
```

Only the explicitly marked WP2 and WP5 lanes are intended to run concurrently.
WP3 and WP4 both make substantial changes to `src/mission-init.ts` and
`src/mission-init.test.ts`; keep them serial.

---

## WP0 — Prove the Pi session materialization contract

**Mode:** serial gate  
**Writes:** preferably a focused test or temporary proof that becomes the first
part of `src/session-topology.test.ts`; no production integration yet

### Purpose

Pi assigns a session ID and target file path before it persists a conversation,
but setup metadata alone may not create the file. The design requires dormant,
named session files so worker headers can point to an existing coordinator
file. Establish the supported contract before building higher layers.

### Tasks

1. Record the minimum supported `@earendil-works/pi-coding-agent` version from
   the package's actual public API and dependency policy.
2. Using only public `SessionManager` methods and the documented session JSONL
   format:
   - create a manager in a temporary explicit session directory;
   - assign an explicit session ID;
   - append one session name;
   - obtain the public header and entries;
   - publish the JSONL file with exclusive creation;
   - reopen it with `SessionManager.open`;
   - verify ID, cwd, name, and absence of conversation messages.
3. Create a coordinator file first, then create a worker whose public
   `parentSession` header points to the coordinator's exact file. Verify that
   `SessionManager.list` reports the expected parent relationship.
4. Repeat with a path containing spaces and quotes and with a custom session
   directory.
5. Confirm reopening the same file and session does not add another
   `session_info` entry.
6. Confirm that an existing destination loses the race safely and is never
   overwritten.

### Constraints

- Do not call private or underscored Pi methods.
- Do not copy Pi's session-ID generation rules; use Pi's generated or explicitly
  validated IDs.
- Do not add a fake user, assistant, or hidden model-visible message merely to
  force persistence.
- Serializing the public header and public entries into the documented JSONL
  format is acceptable; keep that operation isolated behind one package-owned
  function and test it as an integration boundary.
- Do not update dependencies unless the proof demonstrates that the currently
  supported version lacks a required public contract. If an update is required,
  make it an explicit dependency-only change before continuing.

### Exit criterion

A repeatable focused test proves that a named, message-empty top-level session
and a named child session can be exclusively materialized, reopened, listed,
and validated through supported public contracts. If this cannot be proven,
stop and revise the design before implementation.

---

## WP1 — Define shared participant and topology contracts

**Mode:** serial foundation  
**Primary writes:**

- `src/identifiers.ts`
- `src/identifiers.test.ts`
- new `src/participants.ts`
- new `src/participants.test.ts`
- new `src/session-topology.ts` containing types and pure validation only

### Tasks

1. Introduce a capability identifier with the same path-safe validation
   discipline as existing role identifiers. Keep existing `RoleId` semantics as
   the unique routable participant address.
2. Define a pure participant declaration parser and expander:
   - `builder` and `builder=1` produce participant `builder`;
   - `builder=N`, for positive `N > 1`, produces `builder-1` through
     `builder-N` in deterministic input order;
   - reject zero, negative, non-integer, empty, and overflowing counts;
   - reject duplicate capability declarations;
   - reject explicit and derived participant collisions;
   - reject participant identity `all`, which remains the reserved broadcast target;
   - reject `coordinator=N` for `N > 1`;
   - preserve the existing default coordinator and `--no-coordinator`
     semantics.
3. Define normalized participant records with:
   - unique participant role/address;
   - capability;
   - optional preset.
4. Define the versioned `sessions.json` data model:
   - `formatVersion: 1`;
   - participant-keyed records containing session ID, exact absolute file,
     name, and nullable parent participant;
   - exact participant-set equality with normalized agents;
   - one top-level coordinator when configured;
   - workers parented to the coordinator, or all top-level under
     `--no-coordinator`.
5. Keep session topology data separate from runtime roster or claim data.
6. Add table-driven tests for all expansion, collision, ordering, coordinator,
   and topology invariants.

### Exit criterion

Pure tests establish one unambiguous participant list and one validated session
manifest model without changing command handling, mission loading, or launch
behavior.

---

## WP2 — Parallel compatibility and persistence lanes

WP2A and WP2B may run concurrently in the same checkout after WP1 is integrated.
They have disjoint write scopes. Workers must not edit outside their listed
files.

### WP2A — CLI grammar and agent configuration compatibility

**Mode:** parallel lane A  
**Exclusive writes:**

- `src/command.ts`
- `src/command.test.ts`
- `src/mission.ts`
- `src/mission.test.ts`

#### Tasks

1. Extend `/mycelial init --roles` parsing to accept multiplicity declarations
   while preserving quoted arguments and every existing command form.
2. Keep the parsed command explicit: it should carry declarations or normalized
   participants rather than smuggling count syntax into `RoleId` validation.
3. Extend `AgentConfig` with capability metadata.
4. Continue accepting all legacy `agents.json` forms:
   - string arrays;
   - object-keyed entries;
   - object entries using `role` or `name`;
   - optional presets.
5. Normalize absent capability to the participant identity.
6. Accept the new generated participant records without changing recipient
   routing: `role` remains the unique mailbox address.
7. Reject malformed or contradictory capability metadata without including
   unbounded file content in diagnostics.
8. Add focused backward-compatibility and multiplicity tests.

#### Exit criterion

Old command and mission fixtures still pass, and new declarations normalize to
unique participant records with no mailbox protocol changes.

### WP2B — Session manifest codec and dormant-session materializer

**Mode:** parallel lane B  
**Exclusive writes:**

- `src/session-topology.ts`
- new `src/session-topology.test.ts`
- `src/paths.ts`
- path tests, if split into a dedicated existing or new test file
- `src/filesystem.ts` only if the WP0 proof shows one narrowly required
  filesystem primitive

#### Tasks

1. Implement strict `sessions.json` serialization and parsing for format version
   1. Reject unknown versions, unknown fields, duplicate participants, relative
   session files, and participant-set mismatches.
2. Add `MissionPaths.sessionsFile()` without making it mandatory for legacy
   mission loading.
3. Implement the isolated materializer proven in WP0:
   - create a public `SessionManager` in the chosen directory;
   - append the session name once;
   - exclusively publish header plus setup entries;
   - reopen and verify the persisted ID, cwd, name, and parent path.
4. Create the coordinator before workers so every worker parent points to an
   existing regular file.
5. Return exact created paths so callers can perform precise rollback.
6. Add helpers to validate an existing materialized session without mutating it.
7. Test default and custom directories, top-level and child sessions,
   coordinator-free topology, unsafe paths, conflicting destinations, and
   reopen-without-duplicate-name behavior.

#### Exit criterion

A caller can validate a session manifest and exclusively materialize its exact
named topology, receiving a complete list of newly created session files for
rollback.

### WP2 integration checkpoint

The orchestrator integrates both lanes, resolves type-level conflicts without
changing their behavioral contracts, then runs focused tests for:

- `src/command.test.ts`
- `src/mission.test.ts`
- `src/identifiers.test.ts`
- `src/participants.test.ts`
- `src/session-topology.test.ts`

Do not start WP3 until the complete normalized participant set flows cleanly
from command parsing to mission configuration and session topology creation.

---

## WP3 — Transactional mission initialization

**Mode:** serial  
**Primary writes:**

- `src/mission-init.ts`
- `src/mission-init.test.ts`
- `src/command.ts` for command-context wiring
- `src/command.test.ts`

### Tasks

1. Extend `InitializeMissionInput` with the effective session-directory input
   needed by the materializer. The command layer obtains it from the active
   session manager; an in-memory caller falls back to Pi's default persistent
   directory for the repository cwd.
2. Expand declarations and compute the complete participant list before writing
   anything.
3. Build all session IDs, names, file paths, and parent links before
   publication. Session names are exactly `<mission>: <participant>`.
4. Create `sessions.json` and expose its path in `InitializedMission` and command
   output.
5. Preserve the existing non-overwrite boundary for mission directories,
   project shortcuts, and repository `AGENTS.md`.
6. Make initialization a recoverable cross-location transaction:
   - reserve the mission directory;
   - materialize and verify the top-level coordinator, if present;
   - materialize and verify worker sessions;
   - publish mission, agents, repositories, session manifest, and launcher;
   - publish the project symlink last as the visible completion point;
   - track exact files created by this attempt;
   - on failure, remove only those paths in reverse order;
   - preserve the primary error and report any cleanup residue.
7. Do not delete session files after successful initialization, even if the
   mission is later removed.
8. Generate `agents.json` with participant and capability records. Preset edits
   remain possible, but participant-set edits are rejected later by launcher
   preflight.
9. Generate mission role text that distinguishes participant identity from
   capability.
10. Add fault-injection tests at the meaningful publication boundaries:
    coordinator materialization, worker materialization, session manifest,
    launcher, and project symlink. Verify no pre-existing artifact is removed.
11. Test top-level coordinator hierarchy, coordinator-free missions, custom
    session directories, and paths with spaces and quotes.

### Exit criterion

Successful init leaves a complete mission plus verified dormant session
hierarchy. Any failed init leaves no mission, shortcut, guidance file, or session
file created by that attempt, except explicitly reported cleanup residue after a
simulated cleanup failure.

---

## WP4 — Idempotent reusable-session Herdr launcher

**Mode:** serial  
**Primary writes:**

- `src/mission-init.ts`
- `src/mission-init.test.ts`

### Tasks

1. Teach the generated launcher to require and parse `sessions.json` for new
   missions.
2. Join agent metadata and session metadata by participant and fail closed when
   their sets differ.
3. Before starting a selected participant, validate:
   - participant and preset syntax;
   - exact session file is a regular non-symlink file;
   - first JSONL record contains the expected session ID and cwd;
   - stored parent relationship agrees with the manifest;
   - the session file is not silently recreated when absent.
4. Reopen the exact recorded file with Pi's explicit session option. Do not use
   an ID-only mode that creates a replacement when missing. Do not pass the name
   again on every resume.
5. Change same-named live Herdr handling from fatal collision to idempotent
   reuse/no-op. Continue treating an actual start-time name race as a visible
   partial-launch failure and leave created tabs available for inspection.
6. Keep participant identity as the Herdr agent name so existing durable-mail
   notification needs no mapping change.
7. Report `started` and `reused` participants separately. Preserve subset
   selection and reject duplicate or unknown selections.
8. Replace the coordinator bootstrap text with one idempotent reconciliation
   prompt: read mission artifacts, roster, mail, requests, and claims; create
   assignments only where durable state requires them; never blindly repeat
   decomposition.
9. Prompt a coordinator only when it was newly started by this invocation.
   Reused live agents receive no launcher-generated turn. Normal mail
   notification remains the wake mechanism.
10. Preserve the no-coordinator and worker-only startup behavior, but make their
    prompt resume-aware.
11. Extend fake-Herdr tests for:
    - first launch of all participants;
    - second launch reusing every participant and creating no tabs;
    - mixed reused and absent participants;
    - subset launch;
    - missing or mismatched session file;
    - participant-set mismatch;
    - start-time name race and partial-launch reporting;
    - one coordinator prompt on first start and none on reuse;
    - correct exact-session and preset arguments.
12. Continue syntax-checking every generated launcher with `bash -n`.

### Exit criterion

Running the launcher repeatedly against the same mission never creates another
Pi conversation for an existing participant, never opens an expected missing
session as a new top-level conversation, and retains current durable
notification behavior.

---

## WP5 — Parallel hardening and documentation lanes

WP5A and WP5B may run concurrently after WP4 interfaces and generated UX are
stable. They use disjoint files and must not edit `src/mission-init.ts` or
`src/mission-init.test.ts`.

### WP5A — Operating guidance and user documentation

**Mode:** parallel lane A  
**Exclusive writes:**

- `README.md`
- `docs/getting-started.md`
- `docs/design.md`
- `docs/mission-ux-design.md`
- `docs/session-topology-design.md`
- `skills/mycelial-coordination/SKILL.md`
- examples under `examples/` if their current mission format needs updating

#### Tasks

1. Document multiplicity syntax and participant naming.
2. Document the top-level coordinator/child-worker session tree.
3. Explain that launcher reruns reuse exact conversations and that deleting an
   expected session file is a launch error, not a request to recreate it.
4. Explain capability versus routable participant identity.
5. Add shared-checkout parallelism rules:
   - concurrent mutating assignments require disjoint path scopes;
   - serialize overlapping files, dependency manifests and lockfiles,
     repository-wide format/generation, and working-copy version-control
     operations;
   - parallel read-only investigation and review are safe;
   - claims do not lock files.
6. Preserve concise sandbox discipline in package guidance: do not use `/tmp`
   directly, never bypass a sandbox denial, use the dedicated Pi tool for the
   operation, and stop with a blocker when no such tool applies.
7. Keep context compaction under Pi and keep rotation/dynamic scaling outside
   current behavior.
8. Update design status only after implementation and validation actually meet
   its acceptance criteria.
9. Do not describe or depend on any unrelated session-management product.

#### Exit criterion

A user can understand initialization, hierarchy, relaunch, participant routing,
and shared-checkout safety from package-owned docs and skill guidance.

### WP5B — Adversarial integration coverage

**Mode:** parallel lane B  
**Exclusive writes:**

- new `src/session-topology.integration.test.ts`
- new test fixtures/helpers used only by that file

#### Tasks

1. Exercise the complete command-to-files flow in a temporary repository and
   explicit temporary session directory.
2. Use Pi's public reader to verify:
   - one top-level coordinator;
   - every worker parent points to the coordinator's exact file;
   - exact names and cwd;
   - no conversation messages before launch.
3. Verify repeated launcher runs through a stateful fake Herdr start each
   participant once.
4. Verify participant multiplicity produces unambiguous mailbox recipients and
   Herdr names.
5. Race two initializations for the same mission and assert one winner without
   deleting the winner's artifacts.
6. Verify symlinked or mismatched session control paths fail closed.
7. Verify legacy mission loading and protocol routing remain unchanged without
   `sessions.json`.
8. Add a regression assertion that no automatic session-rotation or
   context-monitoring state was introduced.

#### Exit criterion

Black-box tests cover topology, reuse, collision, rollback, and compatibility
outside the implementation's focused unit tests.

### WP5 integration checkpoint

The orchestrator reviews both lanes, resolves documentation against actual CLI
output, and runs all focused topology and launcher tests. No worker performs a
repo-wide format pass before this join.

---

## WP6 — Full validation and acceptance

**Mode:** serial  
**Writes:** only fixes found by validation, followed by final documentation
status updates

### Automated validation

1. Run the full test suite.
2. Run lint/format validation for all changed source, test, skill, and supported
   documentation paths.
3. Run the full build/package workflow.
4. Inspect the final change for:
   - protocol record changes that were not intended;
   - identity fields exposed to model tool input;
   - unsafe path or symlink handling;
   - duplicate participant/session mappings;
   - unconditional coordinator bootstrap prompts;
   - private Pi API usage;
   - unrelated dependencies or orchestration machinery.

### Manual acceptance

In a disposable repository and session directory:

1. Initialize a mission with `builder=2,reviewer`.
2. Confirm the session picker shows one top-level `<mission>: coordinator` with
   three child sessions.
3. Launch the full mission and confirm one Herdr agent per participant with the
   expected trusted binding.
4. Exit one worker, rerun the launcher, and confirm it resumes the same Pi
   session while live participants are reused.
5. Rerun with all participants live and confirm no additional tabs or Pi
   sessions are created.
6. Send independent builder assignments and confirm each wakes only its named
   participant.
7. Confirm a missing expected session file causes a clear failure and no
   replacement session.
8. Confirm an old mission and its old launcher retain their previous behavior.

### Final exit criterion

Every acceptance criterion in `session-topology-design.md` is met, automated
validation passes, and live acceptance demonstrates stable hierarchy and
idempotent relaunch without changing mailbox protocol semantics.

---

## Parallel execution summary

The following work can safely run in parallel in one checkout without
worktrees, provided workers honor the exclusive write scopes:

| Wave | Lane | Scope | Must not touch |
| --- | --- | --- | --- |
| WP2 | A | Command grammar and agent compatibility | Session topology, paths, filesystem |
| WP2 | B | Session manifest and materialization | Command and mission parsing |
| WP5 | A | Docs, examples, and skill guidance | Source implementation and tests |
| WP5 | B | New black-box integration test file | Existing implementation and test files |

Everything else is serial because it either establishes shared contracts or
concentrates changes in `src/mission-init.ts` and its test suite.

For all parallel waves:

- the orchestrator describes the shared working change before workers mutate
  files;
- workers receive exact file ownership and do not edit overlapping paths;
- workers do not commit, rebase, branch, stash, or otherwise mutate shared
  version-control state;
- workers report focused test results and stop;
- the orchestrator performs integration review and full validation after join.
