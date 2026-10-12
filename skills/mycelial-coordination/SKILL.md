---
name: mycelial-coordination
description: Use Mycelial durable mailbox and task-claim tools for multi-agent coordination. Load when agent_mail_* tools are available or when joining a declared Mycelial mission.
---

# Mycelial Coordination

Use the durable mailbox as coordination truth. Never invent or pass mission, role, sender, or session identity fields; Mycelial derives them from the trusted runtime binding.

## Start and check in

1. Call `agent_mission_read` to load the mission selected by the trusted binding, then read the active repository's `AGENTS.md`.
2. For a coordinator startup/rotation, use the current handoff at the front of an existing repository execution/status document if present; do not replay historical mail or read every canonical artifact by default. A handoff is an index, not proof. With no handoff, proceed from the mission, unread mail and targeted source artifacts.
3. Call `agent_roster` with `refresh: true` to publish this session's presence and see live sessions. Read bounded new/unread mail with `agent_mail_read` before starting work. Reconcile ownership using available source mail, receipts and named participants; roster presence does not establish a claim. There is no read-only claim-list tool. If ownership remains unknown, defer potentially duplicate assignments rather than asserting a task is free. Verify stale or disputed handoff assertions against specific sources or mark them unknown.
4. Check mail again at atomic task boundaries and before ending a work turn. Do not poll continuously.

Reserve P0 for genuine emergencies (for example imminent data loss or a safety-critical stop), never routine progress, completion, or ordinary scheduling. Treat P0 as emergency mail to handle at the next safe point. Treat P1 as blocking mail to acknowledge promptly after the current atomic operation. Follow each message's interrupt and acknowledgement metadata.

## Conversations and receipts

Use `agent_mail_reply` for an existing conversation so reply and thread linkage remain intact. Use `agent_mail_ack` to record the appropriate state:

- `seen`: read but not committed;
- `accepted`: committed to handle it;
- `declined`: cannot take it;
- `delegated`: handed to another role, with delegation detail;
- `done`: requested work and reporting are complete.

When a message requires acknowledgement, append an appropriate receipt promptly. Reading or roster presence is not an acknowledgement.

## Claim work safely

For one independently claimable request, use the request message ID as both the default task ID and source message ID. Call `agent_task_claim` before starting work.

- If the claim is contended, do not perform the work; coordinate through mail or choose another task.
- Renew an owned claim before its lease expires when work continues.
- Roster presence and `accepted` receipts do not establish ownership; only a live claim does.
- Before `agent_task_release`, report the result and validation through the existing mail thread, then release the claim.

## Bounded assignments

The coordinator schedules work. Each assignment needs a concrete deliverable,
exclusive mutating path scope, validation to run, a reporting boundary, and a
stop condition. Claim it before working; finish that bounded request, report
results and validation through its original thread, release the claim, and stop
until assigned more work. If scope or acceptance is unclear, ask rather than
expanding the task or polling for work. Read mail at atomic boundaries and before
ending the turn, not in a continuous loop.

The coordinator chooses the next useful real-input output and its permitted claim. For an uncertainty affecting it, assign a falsifiable hypothesis, smallest authorized test, contradiction to watch for, and next recommendation, within the existing path/authority/stop boundary. Builders may follow up on a reversible assumption only within that boundary; a blocked lane does not idle independent work. An unfinished release check blocks its dependent claim, not a truthful narrower experiment. Escalate external access and choices beyond delegated authority; review or gate only when it protects a named boundary or changes the next usable output. Do not silently override an approved plan to run a prohibited experiment.

A fresh conversation does not inherit a prior session's live claim. Do not work,
renew, or release that task until the old owner releases it or its lease expires
and your own normal claim succeeds. An accepted receipt is not ownership.

## Shared-checkout discipline

Claims establish task ownership, not file locks. Run concurrent mutating assignments only when their path scopes are disjoint. Serialize overlapping paths, dependency manifests and lockfiles, repository-wide formatting or generation, and version-control operations that mutate the shared working copy. Read-only investigation and review may run concurrently.

Capability is planning metadata; address mail to the unique participant identity such as `builder-1`, never to the shared capability `builder`. Stable participant sessions are resumed by the launcher. Do not create replacement sessions, rotate them for context usage, or dynamically add participants; Pi owns context compaction.

## Sandbox discipline

Do not use `/tmp` for mission work; it triggers operator approval and breaks autonomous execution. Keep scratch artifacts in repository-approved locations or use a dedicated Pi scratch tool.

Use `agent_*` for mission state and dedicated Pi tools for supported repository, VC, scratch and browser work; never shell into external mission storage. Treat a sandbox denial as evidence that the attempted workflow is wrong. Do not retry through alternate commands, paths, shells, or wrappers. Use the dedicated Pi tool for the operation; if none applies, stop and report the blocker rather than improvising a bypass.

## Automatic live notification

`agent_mail_send` and `agent_mail_reply` durably publish mail first, then automatically make a best-effort wake-up attempt for each delivered recipient. Inspect their notification results. Do not make a routine second `agent_wake` call after a successful automatic notification.

Use `agent_wake` only to retry a notification failure reported by send or reply. It sends the same fixed Herdr notification with no task content and validates the target against the mission roster. Durable mail remains authoritative if every wake-up attempt fails. Do not depend on Herdr for storage, acknowledgement, or ownership.
