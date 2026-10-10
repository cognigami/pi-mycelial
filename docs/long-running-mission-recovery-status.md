# Long-running mission recovery — implementation evidence

## WP0 decisions (2026-10-10)

- Public Pi 0.82.1 exports `SessionManager`, `SessionHeader`,
  `CURRENT_SESSION_VERSION`, and `getAgentDir`. There is no public bounded,
  read-only file-header reader. Read the documented first JSONL line through a
  bounded filesystem operation, accepting documented versions 1–3 without
  opening/migrating old transcripts. New dormant files continue using the
  existing public-API materializer. Existing tests prove `SessionManager.list`
  lists each named dormant file once and preserves parent paths; live picker
  acceptance passed in the disposable mission documented below.
- Discovery uses `join(getAgentDir(), "sessions")` (including the documented
  `PI_CODING_AGENT_DIR` override), recursively, plus old participant directories
  outside it. A missing/unreadable root or unsafe candidate makes deletion
  incomplete. Custom child directories outside this boundary require retention.
- Entry point: one installed `~/mycelial/rotate <mission-id>` executable beside
  `missions/`, runnable from any control-shell directory without `PATH` setup or
  a command hierarchy. IDs resolve under global `missionRoot` through the existing
  read-only config loader; `~/mycelial/rotate --mission-dir ABSOLUTE` instead uses
  an explicit authoritative directory. No second JSONC parser, project-local
  config, or inherited mission/session binding selects the target. CLI packaging
  is complete and independently reviewed; validation/install evidence is below.
  Cwd comes from the verified old coordinator header, shared by all participants.
  Replacements go in that coordinator's
  existing directory. No agent tool, Pi command, Herdr liveness check, launcher
  regeneration, automatic threshold, or unattended confirmation bypass.
- Refuse absent managed manifests and coordinator-free missions. Unsafe old
  participants and corrupt cursors/protocol records refuse rotation; unread
  canonical mail and live old-session claims warn, never migrate claims.
- One exclusive mission-local operation directory prevents other rotations,
  not agent launches. No automatic stale-lock breaking. An explicit recovery
  invocation requires the operator to establish that the previous rotation
  process is gone and confirm mission-wide downtime again.
- One short-lived recovery record holds exact old/intended manifest bytes,
  verified old header identities, control-file snapshots, and new artifact
  ownership. Persist preparation intent before artifact creation. Record the
  staged file's device/inode before linking its final path: byte-identical
  preexisting collisions are never owned. Incomplete ownership evidence must
  retain/report uncertain residue, never guess permission to unlink.
- Classify publication errors by rereading manifest bytes: old => owned-new
  rollback only; intended => preserve replacements and recover cleanup;
  unexpected/unreadable => preserve both trees for manual intervention.
  Directory sync failure after rename is not rollback. Delete verified old files
  last, children first, only after active-tree validation. Recovery never
  prepares another tree.

## Package status

- WP0: resolved above. Relevant complete Pi SDK/session-format/sessions,
  environment, session example, and exported declarations were inspected;
  materialization remains on public APIs.
- WP1: bounded-work/P0 guidance and matching launcher prompts implemented.
  Disposable synthetic measurement completed below; no live Benny data touched.
- WP2: bounded read-only headers, conservative bounded discovery, canonical
  unread/claim inspection and mutation-free dry-run reporting implemented.
- WP3: schema/path-bound cursor seam and exclusive returned-ID initialization;
  host/explicit mismatch rejection before cold-start **or active rebind** writes.
- WP4: explicit downtime, operation exclusion, rerun preflight, preparation
  ownership, drift checks, atomic switch and exact old/new/unknown classification.
- WP5: exact revalidated children-first deletion last, full retention, thin
  control-shell adapter and explicit recovery implemented. Unknown staged
  ownership is conservatively retained/reported, not automatically deleted.
- WP6: automated validation complete; tests map all eight design groups; adversarial boundary coverage
  includes publication-sync ambiguity and rollback/cleanup recovery. Full
  validation results are recorded below. **Live picker/Herdr acceptance also
  passed on the disposable mission; the rotation release gate is met.**
- N1: additional suppression blocked as documented below; N2 intentionally not
  implemented. Existing in-flight coalescing and notification outcomes unchanged.
- Model A/B: not performed; independent operator experiment, no model defaults
  changed. No operator-provided Benny corpus was supplied.

## Automated design-test mapping

| Design group | Executable evidence |
| --- | --- |
| 1 — fresh hierarchy/picker | Rotation retention test checks fresh IDs/names, public `SessionManager.list` one entry per replacement, empty context and new-only parent links; topology tests retain public-API materialization proof. |
| 2 — cursor continuity | Mailbox cursor-transfer test covers returned/pending/new/delayed-marker mail, exactly-once return, explicit replay and strict path binding; rotation integrates transfer. |
| 3 — receipts/threads/claims | Retention integration preserves every preexisting mission/protocol byte except manifest; receipts/linked replies remain readable, old claims contend/reject until ordinary expiry takeover. |
| 4 — refusal/exclusion/downtime | Missing/symlinked files, corrupt cursors, unsupported shapes, explicit downtime/destructive cancellation, stale and simultaneous operation tests; cold/active rebind write observation. No Herdr liveness inference. |
| 5 — adversarial transaction | Session/cursor/recovery stage open/write/sync/close; worker link, validation/readback, recovery rename/sync, control drift, cancellation, manifest before/after rename, unknown manifest, matching-byte collision, rollback residue and cleanup faults. |
| 6 — precise history policy | Default versus retention; direct/transitive/unrelated trees; external participant directories; bounded unsafe/unreadable/missing roots, exclusion of readable orphaned/cyclic chains outside the family; descendants-first assertions and changed-identity refusal. |
| 7 — read-only preview/recheck | All mutation methods throw in dry run; complete filesystem snapshot unchanged; supported-entry dry run/refusal never installs or updates absent/stale sync stamps; large transcript body cannot be read; real invocation rejects drift after a prior preview. |
| 8 — unchanged relaunch/routing | Fake-Herdr integration launches before/after rotation, asserts new exact paths/identities and preserved eng default, then idempotent reuse and wake routing. Live lifecycle is separately verified by the disposable acceptance below. |

Recovery tests demonstrate old-active owned rollback, intended-new cleanup without
another tree, partial deletions with already missing descendants, changed old
identities, and unlink/rename-success versus later sync failure. Faults are
injected against disposable test files, not live Pi history; they are simulated
interruption states rather than an operator live-process crash exercise.

## Confirmed reviewer repairs (R1–R3, 2026-10-10)

- **R1:** removed only `rotate`'s Justfile `sync` prerequisite, then added Bun's
  existing `--no-install` flag to that recipe only. The latter closes Bun 1.4.2's
  import-time automatic-install boundary before CLI/dry-run/TTY checks. Operators
  perform supported `just build` setup beforehand; rotation does not install
  missing dependencies or refresh stamps. Four disposable supported-entry
  regressions cover absent/stale sync stamps and dry-run/non-TTY refusal; the
  stub asserts and forwards `--no-install` to real Bun. Two further recipe/runtime
  regressions start with no `node_modules` and an unavailable import dependency,
  proving startup refusal without CLI execution, installer invocation, module
  directory or lockfile creation. The stub refuses a regressed missing flag
  before real Bun starts, so tests never permit actual installation/network.
- **R2:** manifest temporary staging now uses the existing persisted inode/content
  ownership seam; final `sessions.json` is never a rollback-owned artifact.
  Committed cleanup checks/removes verified owned session/cursor/manifest stages
  before old-tree deletion and before dropping recovery evidence, explicitly
  excluding active final files. Remaining stages retain the operation record and
  report exact paths for explicit recovery. Regressions cover session/cursor
  post-link stage-unlink failures, manifest rename plus cleanup failure, and an
  interrupted old-active manifest stage. Recovery preserves active finals,
  creates no second tree, and default history deletion remains last.
- **R3:** the manifest rename adapter checks cancellation immediately before the
  actual rename, after staging and ownership-check awaits. An abort triggered
  after manifest temp sync leaves the old manifest/history active, cleans owned
  preparation, and performs no old unlink. Post-rename classification remains
  unchanged: active replacements are never preparation-rolled-back.

All three findings were confirmed in the prior code and repaired narrowly; no
shared tooling redesign, dependency, preset, protocol or product-policy change.
The read-only reviewer approved the implementation after accepting R1–R3; no
confirmed review blockers remain. The final independent reviewer CLI suite passed
7 tests with 39 assertions. The parent independently reran the final full suite:
185 tests passed, 0 failed, 853 assertions across 27 files. Subsequent CLI and
live acceptance evidence is below; N2 remains unshipped.

## Final automated validation (2026-10-10)

- Final R1 follow-up focused supported `test` tool: **101 passed, 0 failed**, 608
  assertions, nine files:
  `mission-rotation.test.ts`, `mission-rotation.integration.test.ts`,
  `rotation-cli.test.ts`, `session-topology.test.ts`, `mailbox-store.test.ts`,
  `runtime.test.ts`, `identity.test.ts`, `mailbox-benchmark.test.ts`,
  `mission-init.test.ts` (all under `src/`).
- Full supported sequence **build → lint → test succeeded**. Build includes
  TypeScript checking, full tests, lint and package bundling. Final full tests:
  **185 passed, 0 failed**, 27 files, 853 assertions. Full lint reports no fixes
  needed after final source formatting. Build produced `dist/index.js`.
- Supported disposable benchmark completed via `just benchmark-mailbox`.
- Markdown relative links and fence balance checked for the changed README,
  runbook/design/plan/evidence, getting-started guide and coordination skill.
- This automated validation sequence performed no dependency change, VC mutation,
  live mission history deletion, model call, Herdr process launch, or further
  subagent launch.

Implementation review and subsequent operator-controlled disposable picker/Herdr
acceptance are approved. Automated destructive/discovery tests inject disposable
session roots; those automated tests do not rotate actual Pi history. N2, Benny-copy measurement
and model A/B remain explicitly unperformed as described above.

## Discovery scoping correction (2026-10-10)

Benny's operator dry run exposed a global ancestry check that refused deletion
because readable Scotty sessions referenced missing parents. Those sessions were
never in Benny's verified family. Discovery now selects only chains that reach
an old managed session; other readable orphaned/cyclic chains remain untouched
without blocking deletion. Unreadable/unsafe headers and incomplete root scans
still refuse deletion because they can hide actual descendant links.

A disposable regression includes orphaned/cyclic Scotty sessions, an orphan's
child sharing the managed directory, and real direct/transitive mission children
in other project directories. It proves mutation-free preflight, exact default
deletion, and unchanged bytes for excluded sessions. Existing unsafe/missing-root
and unreadable-header refusal coverage remains in place.

Focused rotation tests and full supported **build → lint → test** passed after
this correction: **186 tests, 0 failures, 861 assertions across 27 files**. That
validation did not rotate Benny. Subsequent disposable acceptance and the
operator's successful Benny rotation are below.

## Installed rotate command (2026-10-10)

The operator command is `~/mycelial/rotate <mission-id>` with the existing
`--dry-run`, `--save-history`, and `--recover` policies. One thin entrypoint reuses
global configuration and the existing rotation adapter. An explicit
`--mission-dir` bypasses ID/config lookup. There is no command hierarchy, `PATH`
installation, new config parser, or new rotation engine.

The supported build compiles one standalone `cli-dist/rotate`; the existing
installation workflow installs it beside `~/mycelial/missions`. Native runtime
tests run outside the checkout with neither Bun nor `just` on `PATH`, ignore
caller `.env`/Bun/project configuration, and verify mutation-free preview/refusal
paths. Build passed **190 tests, 0 failures, 906 assertions**. The independent
read-only reviewer approved the CLI and reran its focused suite: **4 tests, 0
failures, 45 assertions**.

The parent installed the executable through the supported `install-rotate`
workflow and verified its `--help` from `/` under an empty environment with only
`HOME` and `/usr/bin:/bin` on `PATH`. This did not rotate or delete any mission.
The builder's separately reported disposable installation artifact at
`/tmp/mycelial-rotate-install.4fiKcx/mycelial` remains after denied cleanup; no
alternate cleanup was attempted.

The operator ran the dummy-project setup script, which initializes and launches
the test mission only. Read-only inspection of coordinator session
`01a127a5-bc26-75ce-9127-3710f8871106` confirms live PING/PONG, successful automatic
wake delivery, done receipts, released claims, and READY. That original session
shows no rotation; setup completion alone is not treated as the full live gate
passing.

The operator subsequently stopped the dummy mission, ran
`~/mycelial/rotate rotation-acceptance --save-history`, and received
`Rotation: committed`. Live launcher output confirms three fresh sessions and
new Herdr identities. Read-only verification found all three original transcripts
retained, new workers linked to the new coordinator, and the same mission/roles.
New coordinator `01a127b3-b722-7164-8a94-d1bfe17c4fd4` intentionally replayed the
old PONG, inspected the preserved receipts/released claims, then read normally
with no new mail and issued no duplicate assignments. Retention rotation and
fresh-session relaunch have passed. A second live launcher invocation reported
all three fresh Herdr agents as reused with no new starts. The operator requested
one new post-rotation PING/PONG; read-only inspection confirmed successful wake
to the replacement builder, its PONG from the new builder session, automatic wake
back to the replacement coordinator, a done receipt, and released claims. Fresh
wake routing has passed.

With the three agents stopped, the operator created tool-disabled one-shot Pi
forks: child `aa765aee-1408-48ee-8cfc-4e611527a6cc` from the current builder and
grandchild `b70adbfe-d318-4206-ba2d-2a255b83ef47` from that child. Native default
`--dry-run` reported exactly five files, ordered grandchild, child, then the
three current participants. None of the three original retained transcripts
appeared in that deletion scope. The operator then confirmed downtime and that
exact five-file destructive scope; native rotation reported `Rotation: committed`.
Read-only inspection verified all five targeted files absent, all three original
retained transcripts still present, and three fresh manifest sessions with correct
worker-to-coordinator parent links. The post-retention PONG and released claim
also remain present in durable coordination state. No rotation control-directory
residue remains. Default deletion with direct/transitive children and preservation
of previously retained history have passed. The operator also confirmed correct
child/grandchild nesting in the live picker before deletion. After default
deletion, the unchanged launcher started all three new identities from the active
manifest. New coordinator `01a127c6-37b5-77bf-a533-ed16beee66c6` refreshed the roster,
read the preserved results/receipts/released claims, found no new mail, and
reported READY without new assignments. **Disposable live rotation acceptance is
complete for both policies**, including known direct/transitive descendants,
picker hierarchy, relaunch/reuse, preserved retained history, and fresh wake
routing. Recovery faults remain covered by the automated injected-failure tests,
not a claimed live-process crash exercise.

## Benny operator rotation (2026-10-10)

After disposable acceptance, the operator previewed `benny-v0`, confirmed mission
and subagent downtime, and ran the installed command with default deletion.
Preview and real preflight both listed exactly 17 files: seven managed
participants and ten descendants. The operator confirmed that destructive scope;
publication and children-first cleanup completed with `Rotation: committed`.
Read-only inspection of the active manifest confirms seven fresh session IDs,
the same participant roles, new Herdr identities, and worker-to-coordinator
parent links. Benny relaunch has not yet been reported. This is operational
rotation evidence, not a Benny latency benchmark or model A/B result.

The operator's cosmetic follow-up is implemented and installed. Reports now show
managed manifest names and truthful direct/transitive descendant labels using the
nearest managed participant name. Descendant display names are not guessed or
looked up by scanning transcript bodies. Each contiguous directory is printed
once with exact filenames beneath it, preserving the complete children-first
scope without repeating directory prefixes or UUIDs. Only previews carry the
dry-run note; real rotation/recovery retains existing progress and diagnostics.
Both downtime and exact permanent-deletion confirmations are unchanged, as are
all discovery/publication/cleanup/recovery decisions. No new option or read/write
operation was introduced.

The independent read-only reviewer approved the presentation safety. Focused
validation passed **13 tests, 0 failures, 90 assertions**; full supported
**build → lint → test** passed **194 tests, 0 failures, 934 assertions**. The
updated standalone executable was installed through `install-rotate`; no mission
rotation or agent restart was performed during this cosmetic follow-up.

## WP1 synthetic measurement (2026-10-10)

Supported invocation: `just benchmark-mailbox`. Bun 1.4.2 on local macOS POSIX
filesystem, disposable synthetic mission copies, OS cache warm after seed
publication, no cache flushing. No model/provider calls. Each message has a
256-character payload plus a bounded-request label. Three measured trials per
workload; median milliseconds. The preceding behavior is isolated by bypassing
only the role marker-presence hint during reconciliation, so the same canonical
and marker validation, output, and cursor write run in both modes. All unread
messages fit the configured benchmark output bounds. Delayed-marker trials
remove exactly one marker in each disposable copy before reading.

| Messages | Workload | Preceding republish ms | Warm-marker ms | Marker stages old → new per read |
| --- | --- | ---: | ---: | --- |
| 100 | warm empty | 130.77 | 24.58 | 100 → 0 |
| 100 | unread | 164.97 | 59.10 | 100 → 0 |
| 100 | delayed marker | 151.85 | 55.33 | 100 → 1 |
| 529 | warm empty | 623.54 | 128.89 | 529 → 0 |
| 529 | unread | 754.43 | 272.27 | 529 → 0 |
| 529 | delayed marker | 756.49 | 337.51 | 529 → 1 |
| 1500 | warm empty | 1705.28 | 584.56 | 1500 → 0 |
| 1500 | unread | 2437.34 | 1040.07 | 1500 → 0 |
| 1500 | delayed marker | 2840.34 | 1011.80 | 1500 → 1 |

The experiment establishes eliminated marker publication work and a synthetic
read-time improvement, **not** Benny/model response latency. Reads still scan
and validate O(messages + markers); no index is proposed. Existing corruption,
delayed lower-ID and marker-repair tests remain in place.

## N1 notification state-transition gate

Inspected `wake.ts`, `notify.ts`, existing send/reply/wake tests and the complete
Pi SDK prompt lifecycle documentation. Herdr binary is installed but this shell
has no `HERDR_ENV`; no Herdr manual entry/durable delivery contract was available.
Pi's SDK distinguishes steering/follow-up queues and rejects unspecified busy
prompting, but this does not establish how Herdr queues a prompt or that a future
recipient turn acknowledges a particular mailbox generation. Mycelial has no
recipient future-read acknowledgement protocol. A successful command is a
successful prompt attempt, not proof of any later read.

| Transition | Existing evidence and safe decision |
| --- | --- |
| Multiple senders/burst | One dispatcher's concurrent calls share an in-flight attempt; no cross-process generation acknowledgement. Do not extend suppression. |
| Active recipient → final read → idle while new mail arrives | Busy/unread/time labels cannot prove another read; a cooldown can strand the new mail. Attempt the later wake. |
| Prompt fails/cancels or sender crashes | Durable mail stays authoritative; report failure/cancellation and retain explicit retry. No assumption that the recipient will read. |
| Unread → read → unread | Cursor return is not future-read intent. Another unread transition must not inherit suppression from the prior one. |
| Recipient restart | In-memory state is not durable delivery intent. No cooldown survives or proves future work. |
| Rotation | Fresh session and Herdr identity; unchanged launcher/runtime resolve the new mapping. Never suppress using retired identity state. |

No later-wake suppression rule is justified by the available guarantees. N2 is
not shipped; adding recipient acknowledgements/outbox/supervision would require
a separate design decision. This does not block rotation. No notification/model
performance or liveness acceptance is fabricated.
