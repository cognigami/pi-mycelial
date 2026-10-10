# Long-running mission recovery — implementation evidence

## WP0 decisions (2026-10-10)

- Public Pi 0.82.1 exports `SessionManager`, `SessionHeader`,
  `CURRENT_SESSION_VERSION`, and `getAgentDir`. There is no public bounded,
  read-only file-header reader. Read the documented first JSONL line through a
  bounded filesystem operation, accepting documented versions 1–3 without
  opening/migrating old transcripts. New dormant files continue using the
  existing public-API materializer. Existing tests prove `SessionManager.list`
  lists each named dormant file once and preserves parent paths; live picker
  acceptance is still pending.
- Discovery uses `join(getAgentDir(), "sessions")` (including the documented
  `PI_CODING_AGENT_DIR` override), recursively, plus old participant directories
  outside it. A missing/unreadable root or unsafe candidate makes deletion
  incomplete. Custom child directories outside this boundary require retention.
- Entry point: repository control-shell `just rotate --mission-dir ABSOLUTE`
  (thin Bun TypeScript adapter). Explicit directory is authoritative; this CLI
  does not resolve extension JSONC or inherit mission/session bindings. This
  avoids a second configuration loader. Cwd comes from verified old coordinator
  header, shared by all participants. Replacements go in that coordinator's
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
  validation results are recorded below. **Live picker/Herdr
  acceptance is not performed; the release gate is not fully met.**
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
| 6 — precise history policy | Default versus retention; direct/transitive/unrelated trees; external participant directories; bounded unsafe/unreadable/missing roots, broken/cyclic ancestry; descendants-first assertions and changed-identity refusal. |
| 7 — read-only preview/recheck | All mutation methods throw in dry run; complete filesystem snapshot unchanged; supported-entry dry run/refusal never installs or updates absent/stale sync stamps; large transcript body cannot be read; real invocation rejects drift after a prior preview. |
| 8 — unchanged relaunch/routing | Fake-Herdr integration launches before/after rotation, asserts new exact paths/identities and preserved eng default, then idempotent reuse and wake routing. **Live lifecycle is not verified.** |

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
185 tests passed, 0 failed, 853 assertions across 27 files. Live acceptance/N2
limitations below are unchanged.

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
- No dependency change, VC mutation, live mission history deletion, model call,
  Herdr process launch, or further subagent launch was performed.

Implementation review is approved. The remaining rotation release gate is
operator-controlled live picker/Herdr acceptance. All new destructive/discovery
tests inject disposable
session roots; none scans or rotates actual Pi history. N2, Benny-copy measurement
and model A/B remain explicitly unperformed as described above.

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
