# Long-running mission recovery: proposed design and work list

## Status

Binding product contract. Offline operator rotation is implemented with automated
validation complete and implementation review approved; live Herdr/picker release
acceptance remains pending.
See [implementation evidence](long-running-mission-recovery-status.md) and the
[operator preview runbook](long-running-mission-recovery-runbook.md). The narrow
warm-marker optimization is tested and measured on disposable synthetic copies,
not Benny. Additional notification suppression is not implemented because its
future-read liveness gate remains unproven. This design revisits the deferred
context-lifecycle item in `session-topology-design.md`; it does not change the
durable protocol or automate session replacement.

Implementation sequencing, dependencies, and release gates are in
[`long-running-mission-recovery-implementation-plan.md`](long-running-mission-recovery-implementation-plan.md).

## Evidence and scope

In `benny-v0`, one coordinator Pi conversation accumulated 10 compactions,
526 identical Herdr wake prompts for 529 incoming messages, 1,781 mailbox reads,
and increasingly large compaction summaries (10 KB to 61 KB). The last
responses spent minutes in model reasoning, and the model had changed shortly
before the steep latency increase. Correlation is not causation: compare model
behavior separately before attributing the stall to notification volume,
compaction, or provider behavior alone. The mailbox cursor had returned all 529
inbound messages; neither missing delivery nor corruption is established.

There are two distinct outcomes to pursue:

1. Reduce unnecessary work while keeping the same sessions alive.
2. Allow an operator to retire stale conversations **while keeping the same
   mission, participants, and durable coordination state**.

Neither outcome warrants an automatic supervisor or an LLM-controlled file
migration.

## Prioritized work

| Candidate | Evidence and purpose | Scope |
| --- | --- | --- |
| Clear bounded-work and priority guidance | Repeated polling, 130 P0 messages to the coordinator; routine progress should not be an emergency | Small guidance and launch-prompt change, validate against existing coordination contract; does not guarantee compliance |
| Mailbox read-cost reduction | Median `agent_mail_read` rose from 1.04s to 2.45s; read currently reconciles all canonical messages and parses all markers | First skip staging already-present role markers while still validating every canonical message and marker; retain delayed-marker repair. This remains O(messages + markers); measure before proposing an index |
| Suppress redundant live wake prompts | Nearly one identical model prompt per inbound message | Design notification semantics before code: avoid losing a wake during an active turn, failed prompt, recipient restart, or unread transition; distinguish `skipped` from `sent` in tool results |
| Offline tree rotation | An unbounded long-running conversation can become costly or unwieldy despite compaction | Product-level design and integration tests; explicit operator operation, not an automatic threshold |
| Model-latency experiment | Large latency increase coincided with a model switch | Operator-controlled A/B using comparable tasks; do not change defaults from a single run |

A pause/relaunch of the existing sessions is not a substitute for rotation.
No performance fix alone proves that a particular model response will be fast.

## Proposed offline rotation contract

- A control-shell operation for an existing initialized mission, operating on
  its whole configured participant tree. Mission ID, participant role names,
  `agents.json`, `mission.md`, `repos.json`, messages, receipts, and repository
  artifacts remain unchanged. No dynamic participant creation or new mission.
- The operation is **not LLM-driven**. Use the existing TypeScript session
  topology/validation code and Pi's public `SessionManager` API to prepare
  dormant named sessions with a fresh top-level coordinator and worker
  parent-session links. A Pi command or thin CLI can call this library; a
  standalone generated shell script should not hand-assemble Pi session JSONL,
  rewrite cursor data, or own multi-file rollback. The existing launcher reads
  `sessions.json` on each run: unchanged mission/participant names need no
  launcher regeneration. One atomic manifest replacement switches the tree.
- Offer `--dry-run` for the same preflight and discovery checks, without
  creating sessions, staging files, modifying cursors/manifests, prompting
  agents, or deleting anything. Report the mission and participant count,
  searched session directories, verified old participant/descendant paths and
  deletion count (or `--save-history` retention), any unread-mail/claim
  warnings, and reasons the requested action would be refused. New session
  IDs and paths are not known until the real operation. A dry run does not
  reserve state or prove the mission is stopped; the real run repeats every
  check and requires its own operator confirmation.
- The operator is responsible for stopping **every** mission Pi process,
  including subagents, and not launching another until rotation completes. At
  the beginning, require an explicit interactive confirmation: “Have you
  stopped all Pi agents and subagents in this mission, and will you keep them
  stopped until rotation finishes?” Do not depend on a running Herdr server,
  its agent inventory, or roster TTL as a liveness oracle. This confirmation
  cannot establish process absence technically; document the risk if it is
  false. Preflight still checks exact old file headers without reopening them
  through `SessionManager.open` (which can create or rewrite files), parent
  links, and the files in scope. Concurrent manual launches are unsupported.
- For each role, initialize the new session's read cursor from the old
  session's **returned IDs** using the existing cursor validation/write
  mechanism. Leave messages and receipts untouched; outstanding unread mail
  remains unread. An `accepted` receipt does not transfer an active task claim.
  Do not require every claim to be released before rotation. Claims remain
  unchanged: a new session cannot renew or release a still-live old-session
  claim, and must not work that task until the existing lease expires and it
  can claim normally. An operator may instead arrange release before stopping
  the old agent. Never silently move or delete a claim. Explicit
  `PI_MYCELIAL_SESSION`/`--mycelial-session` overrides must not bind a newly
  opened file to an old session ID.
- Use the existing repository execution/status document as the human-reviewed
  handoff. Do not generate a second mission-status document, transplant full
  model context, fabricate completions, or inject all historical mail. Durable
  messages and receipts remain available for intentional replay and linked-
  thread inspection even when old Pi transcripts are removed.
- Validate every new session and cursor before publishing the replacement
  `sessions.json` using the existing atomic mutable replacement primitive.
  Ensure failed preparation leaves the old manifest and launcher usable and
  removes only newly created artifacts. Define minimal post-commit recovery
  from an interrupted cleanup: never delete newly active files or assume
  publication failed merely because old files remain.
- **Requested history policy:** after successful publication and validation,
  delete the old managed Pi session JSONL files **and their discovered
  descendant Pi session files** (subagent conversations) by default;
  `--save-history` retains that entire old tree at its original paths. Pi
  parent links are absolute file paths. Traverse old-parent references
  recursively before deletion; include a child only when its validated
  `parentSession` chain leads to an old managed session. Do not delete other
  conversations in the same directory, mailbox mail/receipts, or repository
  history. A read-only scan of Benny's session directory found **10 direct
  child sessions** referencing four old workers. The delete set must be shown
  before the final destructive confirmation, and deletion must be last. If
  referenced files are unsafe/unreadable, or the configured session roots
  cannot be scanned, refuse deletion rather than silently orphaning possible
  descendants; `--save-history` remains available. Failed deletions
  report exact remaining paths. This is not a general-purpose session cleanup.
- The next regular launcher run should start fresh Herdr processes for the new
  `herdrName` values, reopen the *new* Pi files, and bind the *same* mission and
  participant roles. Rerunning it must remain idempotent. Do not delete old
  transcript files merely because the new sessions were prepared if manifest
  publication or validation fails.

## Required tests before rotation ships

1. Old workers' parent paths all point to the old coordinator; replacements
   point only to the new coordinator and appear once in Pi's session picker.
2. Previously returned mail does not flood the new session, while pending and
   newly delivered messages still appear exactly once; explicit replay works.
3. Old receipts and linked threads remain readable. An unexpired claim owned
   by an old session remains untouched; the new session cannot renew, release,
   or act on it until normal lease expiry and a successful new claim.
4. Missing/unsafe old sessions or concurrent rotation leave the old launch
   path unchanged; the operation requires explicit operator confirmation of
   mission-wide downtime and never interprets Herdr absence as proof.
5. Each preparation/publication failure leaves the old tree launchable and
   cleans up only newly owned artifacts; deletion never precedes publication.
6. Default deletion removes exactly the verified old managed sessions and
   descendants, not unrelated threads; `--save-history` retains the entire
   old hierarchy. Test direct/transitive children and custom directories;
   incomplete discovery must refuse destructive deletion.
7. `--dry-run` reports the same verified deletion scope, unread mail, claim
   warnings, and validation failures without any filesystem mutations; the
   subsequent real invocation rechecks everything rather than trusting its
   earlier output.
8. After a successful rotation, the existing project launcher opens each new
   session and routes Herdr wake-ups to the new agents without renaming the
   mission or participants.

## Agreed policy and discovery boundary

The operator chose an existing status document, explicit operator responsibility
for stopping the mission rather than a Herdr liveness check, recursive removal
of the old Pi subagent hierarchy by default, and leaving active claims to
ordinary lease semantics. These are product requirements, not proof that a
particular mission is already safe to rotate.

For deletion, scan Pi's default `~/.pi/agent/sessions/` tree and the directory
of each old participant session file if outside that tree. Read session headers,
not full transcripts; follow exact `parentSession` references recursively to
find descendants. Delete only this verified family. Do not scan the entire
machine. Custom child sessions stored in other, unlisted directories are
outside this discovery boundary: the operator must use `--save-history` when
such sessions exist. Refuse destructive cleanup if a required root cannot be
scanned or a candidate file cannot be safely verified. A readable orphaned or
cyclic chain that never reaches an old managed session is outside the verified
family: retain it without treating it as incomplete discovery. Do not infer
membership from project-directory names. This bounded scan is not a universal
proof that no Pi session elsewhere references an old parent.
