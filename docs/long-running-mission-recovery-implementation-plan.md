# Long-running mission recovery — implementation plan

## Status and outcome

Planning only. Implements the scope of
[`long-running-mission-recovery-design.md`](long-running-mission-recovery-design.md),
which remains the product contract. No rotation or new notification behavior is
implemented by this plan. The warm-marker optimization is already implemented;
its performance benefit still needs measurement.

Deliver two independent outcomes:

1. Reduce avoidable work in existing conversations without weakening mailbox
   validation or notification liveness.
2. Give an operator a safe offline operation that replaces an existing
   mission's conversation tree while preserving its participants and durable
   coordination state.

Do not make rotation depend on a performance improvement, a model experiment,
or wake suppression. Do not promise that rotation fixes provider/model latency.

## Existing mechanisms to reuse

| Area | Current implementation | Consequence for this work |
| --- | --- | --- |
| Session topology | `src/session-topology.ts` prepares named dormant sessions through public Pi APIs, materializes them, validates manifests, and derives fresh Herdr names | Reuse preparation/materialization. Its dormant-file validator is **not** an old-transcript validator: it expects two records and calls `SessionManager.open`. |
| Launcher | `src/mission-init.ts` generates a launcher that reads `sessions.json` on each invocation and opens the listed files | No regeneration for rotation. Verify the unchanged launcher against a replaced manifest. |
| Mail cursors | `src/mailbox-store.ts` has private cursor validation/read/write code and tracks returned IDs | Expose the smallest internal read/transfer seam; do not duplicate the codec or call `read` to calculate unread mail. |
| Claims | `src/projections.ts` distinguishes owners by role **and session**, refuses live foreign claims, and permits normal expired-lease takeover | Preserve these guarantees and test them across rotation; do not implement claim migration. |
| Runtime identity | `src/identity.ts` currently lets explicit session overrides take precedence over the host session ID | Reject an override that disagrees with a known host ID before reconciliation or heartbeat writes. |
| Mutable publication | `src/atomic-files.ts` supplies `replaceMutable` | Reuse atomic manifest replacement, but account for errors after rename: directory sync can fail after the new manifest is visible. |
| Notification | `src/tool/wake.ts` already coalesces in-flight wakes within one dispatcher; `src/tool/notify.ts` reports send/reply notification outcomes | Later-wake suppression needs a separate liveness contract, not just another timer. |
| Agent guidance | `skills/mycelial-coordination/SKILL.md` already discourages continuous polling and separates receipts from claims | Tighten only missing bounded-work/priority guidance and matching launch prompts. |

## Delivery order and dependencies

```text
WP0  Confirm implementation contracts and failure boundaries
 |
 +--> WP1  Bounded-work guidance + read-cost measurement ----> ship independently
 |
 +--> WP2  Read-only preflight and old-tree discovery
 |       |
 |       +--> WP3  Cursor transfer + session identity safety
 |               |
 |               v
 |             WP4  Prepare, validate, and publish replacement tree
 |               |
 |               v
 |             WP5  Verified cleanup + operator entry point
 |               |
 |               v
 |             WP6  End-to-end validation and operator acceptance
 |
 +--> N1   Notification semantics gate --> N2 implementation only if safe

Model A/B: independent operator experiment; not a shipping dependency.
```

Each package should be a small reviewable change or a few cohesive subchanges.
Keep the rotation dependency chain serial initially. Tests accompany each
package rather than being deferred to WP6. Parallelize only disjoint scopes;
WP1 launch-prompt edits and WP6 launcher-test edits must not overlap.

## WP0 — Resolve contracts before coding the destructive path

**Scope:** design clarification and focused proofs/tests; no rotation entry point.

1. Confirm the supported Pi version's public header/session API, default
   session-directory resolution, and picker behavior. Reuse the existing
   materialization proofs in `src/session-topology.test.ts` and
   `src/session-topology.integration.test.ts` rather than rebuilding them.
2. Choose one operator entry point: a thin control-shell CLI calling the
   TypeScript library is the preferred fit. Specify its supported invocation,
   mission-root/config resolution, cwd, and session destination. Do not invent
   a generated shell migration script or expose rotation as an agent tool.
   If a Pi command is chosen instead, its control session must not belong to
   the tree being retired.
3. Resolve initially unsupported mission shapes explicitly. In particular,
   existing initialization supports `--no-coordinator`; do not silently add a
   participant to rotate such a mission. For the first release, refuse that
   shape unless the design is explicitly extended. Likewise, refuse a mission
   without an existing managed session manifest; rotation is not migration.
4. Define the replacement session directory explicitly. Prefer the old
   coordinator's directory for the whole new tree, subject to the same path
   safety checks; discovery still includes every old participant directory.
5. Specify operation exclusion and crash recovery. Use one mission-local
   exclusive operation lock, not an in-memory mutex or a claim for a fictitious
   task. It prevents two rotations, **not** manual agent launches. A leftover
   lock must fail safely and have a documented operator recovery procedure.
6. Define the minimum recovery information needed to distinguish the old
   manifest from the intended new manifest and retain the exact cleanup scope
   after interruption. Prefer one short-lived recovery record containing the
   two manifests and verified artifact paths/expected header identities, not a
   general transaction journal, status database, or audit history. It is removed
   after completed cleanup or an explicit decision to retain history. Its update/ownership rules must cover
   crashes while creating artifacts, not only successful publication.
7. Set refusal versus warning rules: unsafe old participant files or corrupt
   cursors are refusals; unread mail and unexpired claims are warnings;
   incomplete descendant discovery refuses **deletion**, with `--save-history`
   available if core rotation checks still pass.

**Exit gate:** the invocation, supported mission shape, lock/recovery lifecycle,
read-only scan policy, and publication failure states are documented. Stop if
public Pi APIs or filesystem guarantees cannot satisfy the contract; do not
substitute private APIs or transcript rewriting.

## WP1 — Ship the low-risk improvements and measure them

**Likely scope:** coordination skill, generated launch prompts in
`src/mission-init.ts`, their tests, and a focused mailbox benchmark fixture.

- Describe bounded assignments with a deliverable, exclusive path scope,
  validation, reporting boundary, and stop condition. Retain coordinator-only
  scheduling and the existing claim-before-work requirement.
- Reserve P0 for genuine emergencies; routine progress is not an emergency.
  Preserve P1 blocking-mail handling and message interrupt metadata. Check mail
  at atomic boundaries, not in a polling loop.
- Benchmark the **existing** warm-marker optimization against the preceding
  behavior on equivalent disposable mission copies. Include a roughly
  Benny-sized corpus, increasing corpus sizes, warm empty reads, unread reads,
  and delayed-marker repair. Never advance a live mission's cursors to measure
  it. Use an operator-provided Benny copy if available; otherwise label the
  fixture synthetic.
- Record corpus, runtime/model context where relevant, filesystem conditions,
  read timings, and marker-publication work. Preserve canonical-message and
  marker corruption tests plus delayed-marker repair tests.

**Exit gate:** guidance agrees across skill and launcher; measurements describe
what improved and what remains O(messages + markers). Do not add an index unless
measurements justify a separate design. A lack of speedup does not block rotation.

## WP2 — Read-only preflight, discovery, and dry-run report

**Likely scope:** a focused `src/mission-rotation.ts` preflight module and a
small header/discovery module if needed, plus their tests. Keep filesystem access
injectable through `FileSystem`; add only the bounded header-read capability
needed to avoid loading complete transcripts.

- Load the existing mission and exact participant/session manifest using the
  current parsers. Validate old session IDs, cwd, regular non-symlink files,
  safe paths, and coordinator/worker parent links from bounded header reads.
  Do not call `SessionManager.open` or the dormant validator on old sessions.
- Scan Pi's default sessions tree and each old participant file's directory
  outside that tree. Deduplicate roots and files; do not scan the whole machine
  or follow unsafe directory symlinks. Read headers only.
- Build parent-reference relationships and recursively select only files whose
  validated exact parent chain reaches an old managed session. Handle direct
  and transitive children, unrelated families, malformed/unsupported headers,
  cycles, missing references, unreadable candidates, and overlapping roots.
  Do not use names, timestamps, or shared directories as proof of ancestry.
- Be conservative when an unreadable/unsafe candidate prevents proving the
  discovery scope complete. Report the exact problem and refuse default
  deletion; retention may proceed only when all core old-session checks pass.
- Inspect returned-ID cursors, canonical messages/markers, and claims without
  reconciliation, receipt creation, cursor writes, or heartbeat refresh.
  Include messages with delayed/missing markers when calculating unread mail.
  Report live old-session claim owners and lease expiry; do not demand release.
- Return a structured report consumed by both dry run and the real operation:
  mission/roles, scan roots, verified old managed/descendant paths, deletion or
  retention count, unread-mail/claim warnings, and refusal reasons. Explicitly
  state that custom child directories outside the boundary require retention.

**Dry-run contract:** no directories, lock/recovery files, session preparation,
markers, cursors, manifests, prompts, or deletions. In particular,
`prepareSessionTopology` is forbidden here because `SessionManager.create` may
create directories. Report existing operation-lock conflicts without acquiring
one. Do not invent new session IDs or claim the mission is stopped.

**Tests:** large old transcripts; exact parent-chain membership; unsafe paths and
symlinks; direct/transitive/custom-root children; incomplete scans; unread mail
and claims; filesystem mutation methods that throw if invoked by dry run.

**Exit gate:** an operator can inspect an accurate deletion scope without any
mutation, and an incomplete scan never becomes permission to delete.

## WP3 — Cursor transfer and session identity safety

**Likely scope:** `src/mailbox-store.ts`, `src/identity.ts`, their tests, and
runtime tests where needed. Use existing cursor validation and write mechanisms.

- Read and validate each old cursor, including its role/session binding to its
  path. A missing cursor means no returned IDs; malformed or mismatched data
  must not silently become an empty cursor.
- Initialize a fresh session's cursor with precisely the old returned IDs and
  the new role/session identity. Do not substitute a high-water timestamp,
  acknowledgements, marker presence, or all historical IDs. Read back and
  validate the new cursor before publication.
- Keep old cursors, messages, receipts, claims, and roster records unchanged.
  Track only newly owned cursor paths for preparation cleanup.
- Reject stale `--mycelial-session`/`PI_MYCELIAL_SESSION` overrides when a known
  host session ID disagrees. Preserve matching overrides and explicitly
  supported host-less callers. Perform rejection before runtime writes.
- Test old returned mail stays suppressed; pending and subsequent mail is
  returned once per new session cursor; delayed-marker repair and explicit
  replay still work; linked threads and old receipts remain readable.
- Test a live old-session claim cannot be renewed or released by the new
  session, remains byte-for-byte unchanged through rotation, and can be claimed
  normally only after expiry. Guidance must prohibit work without that claim;
  the storage layer cannot prevent an agent editing repository files directly.

**Exit gate:** replacing conversation identity neither floods returned mail nor
transfers ownership of unfinished work.

## WP4 — Transactional replacement preparation and publication

**Likely scope:** rotation library, existing topology/atomic primitives only
where required for ownership/failure correctness, and fault-injection tests.

Real-run ordering:

1. Require the design's explicit interactive confirmation that **every** mission
   Pi agent/subagent is stopped and will remain stopped. No Herdr query or
   roster TTL substitutes for this. Refuse unattended execution rather than
   adding an implicit confirmation bypass.
2. Acquire exclusive operation ownership and rerun preflight under it. A prior
   dry run is advisory, never authorization or a reserved snapshot.
3. Show the exact old family and warnings. For default deletion, obtain final
   destructive confirmation before committing to the operation. A refusal or
   cancellation here must leave the old launch path usable.
4. Prepare a fresh named topology using the existing public-API materializer;
   create the coordinator first and worker links only to the new coordinator.
   Record newly owned artifacts as they become owned.
5. Transfer and validate cursors, validate every fresh session, and serialize
   the replacement manifest with the existing serializer. Persist the minimum
   recovery information before switching the tree.
6. Recheck operation ownership and that mission control files/old manifest
   still match preflight. Publish **one** replacement `sessions.json` through
   `replaceMutable`. Re-read and validate the active replacement.
7. Only after publication and validation succeed may WP5 delete old files.

Failure handling is part of this package, not a later hardening pass:

| Observed state after failure | Required action |
| --- | --- |
| Old manifest still active | Preserve old files/launcher; remove only newly owned artifacts; report exact cleanup residue. |
| Intended new manifest active | Preserve new files/cursors; never run preparation rollback. If post-publication validation failed, retain old history and report recovery required. |
| Manifest absent, unreadable, or unexpected | Do not guess which tree is active or delete either tree. Retain recovery information and stop for operator intervention. |

A failed `replaceMutable` call does not establish rollback: rename may have
succeeded before directory-sync failure. Similarly, a materializer can publish a
file before throwing. Verify ownership tracking at those boundaries; fix only
the narrow primitive/reporting gap needed for correct cleanup. Never unlink a
preexisting collision, even if its bytes match the prepared artifact.

**Tests:** failure at every materialization, cursor-write, validation, recovery-
record, rename, sync, and read-back boundary; manifest drift; simultaneous
rotations; cancellation; cleanup failure. Assert the applicable old/new launcher
path remains usable and old deletion never precedes successful publication and
validation.

**Exit gate:** faults cannot turn a committed tree into deleted active files or
turn a preparation failure into destruction of the old tree.

## WP5 — Verified history cleanup and operator entry point

**Likely scope:** rotation cleanup, the thin operator adapter selected in WP0,
usage/runbook documentation, and tests. Do not regenerate launchers.

- Default cleanup removes exactly verified old managed sessions and descendants,
  last. Revalidate remaining files against their recorded header identities
  before unlinking; refuse changed/unsafe candidates. Exclude every active
  replacement file. Delete children before parents so a partial failure does
  not unnecessarily orphan retained children.
- `--save-history` retains the entire old tree at original paths. Core rotation
  safety checks still apply; incomplete discovery must be reported, not hidden.
  Retain protocol records and repository history under either policy.
- Report successful publication separately from failed/incomplete cleanup and
  list exact remaining paths. A cleanup failure must not suggest restarting
  preparation or restoring the old manifest blindly.
- Provide a minimal explicit recovery path for interrupted cleanup using the
  short-lived recovery information. It checks that the intended new manifest
  is active and valid, obtains downtime/destructive confirmation again, and
  revalidates remaining old files. Missing already-deleted files are harmless;
  changed identities or a different active manifest require manual review.
  Recovery must not create another replacement tree or delete active files.
- Document recovery before publication separately: if the old manifest remains
  active, remove only verified newly owned artifacts. Never auto-clear an
  ambiguous lock or infer mission downtime from process inventory.
- Wire `--dry-run` and `--save-history` to the same library checks. Report progress
  by phase using ordinary control-shell output, honor cancellation before
  publication, and distinguish committed-but-incomplete cleanup from failure.
- Explain the human-reviewed existing repository status/execution document,
  intentional replay, lease-expiry wait, discovery boundary, false-downtime
  risk, and next regular launcher run. Do not generate a second handoff document
  or inject historical context into replacement conversations.

**Exit gate:** both policies and interruption recovery have executable tests and
an operator can tell which tree is active and what remains to be removed.

## WP6 — End-to-end release gate

**Likely scope:** a new rotation integration suite, existing launcher fixtures,
and operator acceptance notes.

Exercise initialization -> mail/read/receipts/claims -> stopped mission -> dry
run -> rotation -> unchanged launcher -> new sessions -> notification routing.

Map directly to the design's eight required test groups:

1. Fresh IDs, names, parent links, message-empty conversations, and one picker
   entry per participant.
2. Returned/pending/new mail, delayed-marker repair, and replay.
3. Old receipts/threads and claim contention followed by lease-expiry takeover.
4. Missing/unsafe old files, competing rotation, and explicit downtime
   confirmation without Herdr availability being treated as proof.
5. Preparation/publication/validation failures and strictly post-commit deletion.
6. Exact default deletion versus full retention, unrelated conversations,
   direct/transitive children, custom roots, and incomplete-discovery refusal.
7. Mutation-free dry run and independent real-run revalidation after state drift.
8. New Herdr names/session paths, unchanged mission/roles/launcher, correct wake
   routing, and idempotent subsequent launcher runs.

Use the repository's supported `test`, `lint`, and `build` tools; run focused
suites during packages and full validation at integration boundaries. Tests
using fake Herdr prove routing, not live process behavior. Final acceptance is an
operator-controlled disposable mission in Herdr, first with retention, then with
default deletion and a known child tree. Never use the live Benny history as the
first destructive test. Record what was automated versus manually verified.

**Release gate:** all design test groups pass; recovery paths are demonstrated;
live relaunch and wake routing are verified; no durable protocol or participant
changes occur. Do not ship a default destructive operation with only happy-path
unit tests.

## Independent notification lane — semantics before suppression

### N1 — Decide whether a safe suppression rule exists

Inspect actual Herdr prompt delivery/queuing guarantees and recipient turn
lifecycle. Document a state-transition table covering:

- multiple senders and bursts, beyond one dispatcher's existing in-flight map;
- a recipient active when more mail arrives, including its final-read/idle race;
- prompt failure, cancellation, and sender crash;
- unread-to-read-to-unread transitions;
- recipient restart and rotation to a different session/Herdr identity.

A `sent` result must mean an actual successful prompt attempt; a suppressed
attempt must report `skipped` with a reason. Do not suppress solely because a
role appears busy, a recent wake succeeded, or unread mail already existed:
none proves a future turn will read the new mail.

**Gate:** choose the smallest rule supported by verified delivery guarantees and
race tests. If safe suppression needs unsupported recipient acknowledgement or
new persistent coordination, stop and amend the design rather than shipping a
cooldown that strands mail. Rotation can ship without this lane.

### N2 — Implement only the accepted rule

Keep the adapter outside mailbox storage; preserve durable-first best effort,
explicit failed-notification retry, self-target handling, and cancellation.
Update `src/tool/wake.ts`, `src/tool/notify.ts`, send/reply result tests, and
coordination guidance together. Exercise every N1 transition and measure both
prompt reduction and unread-mail liveness. Do not introduce a resident supervisor
or notification outbox unless the accepted rule specifically requires it.

## Independent model-latency experiment

Have the operator compare comparable tasks/corpus and workload with the models
implicated by Benny, recording model/provider, compactions, input size, tool
latencies, and response latency. Separate provider/model reasoning time from
mailbox cost and notification load. Treat this as evidence, not a default model
change or a reason to delay the safe rotation path.
