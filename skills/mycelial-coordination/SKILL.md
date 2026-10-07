---
name: mycelial-coordination
description: Use Mycelial durable mailbox and task-claim tools for multi-agent coordination. Load when agent_mail_* tools are available or when joining a declared Mycelial mission.
---

# Mycelial Coordination

Use the durable mailbox as coordination truth. Never invent or pass mission, role, sender, or session identity fields; Mycelial derives them from the trusted runtime binding.

## Start and check in

1. Call `agent_mission_read` to load the mission selected by the trusted binding, then read the active repository's `AGENTS.md`.
2. Call `agent_roster` with `refresh: true` to publish this session's presence and see live sessions.
3. Call `agent_mail_read` before starting new work.
4. Check mail again at atomic task boundaries and before ending a work turn. Do not poll continuously.

Treat P0 as emergency mail to handle at the next safe point. Treat P1 as blocking mail to acknowledge promptly after the current atomic operation. Follow each message's interrupt and acknowledgement metadata.

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

## Shared-checkout discipline

Claims establish task ownership, not file locks. Run concurrent mutating assignments only when their path scopes are disjoint. Serialize overlapping paths, dependency manifests and lockfiles, repository-wide formatting or generation, and version-control operations that mutate the shared working copy. Read-only investigation and review may run concurrently.

Capability is planning metadata; address mail to the unique participant identity such as `builder-1`, never to the shared capability `builder`. Stable participant sessions are resumed by the launcher. Do not create replacement sessions, rotate them for context usage, or dynamically add participants; Pi owns context compaction.

## Sandbox discipline

Do not use `/tmp` for mission work; it triggers operator approval and breaks autonomous execution. Keep scratch artifacts in repository-approved locations or use a dedicated Pi scratch tool.

Treat a sandbox denial as evidence that the attempted workflow is wrong. Do not retry through alternate commands, paths, shells, or wrappers. Use the dedicated Pi tool for the operation; if none applies, stop and report the blocker rather than improvising a bypass.

## Automatic live notification

`agent_mail_send` and `agent_mail_reply` durably publish mail first, then automatically make a best-effort wake-up attempt for each delivered recipient. Inspect their notification results. Do not make a routine second `agent_wake` call after a successful automatic notification.

Use `agent_wake` only to retry a notification failure reported by send or reply. It sends the same fixed Herdr notification with no task content and validates the target against the mission roster. Durable mail remains authoritative if every wake-up attempt fails. Do not depend on Herdr for storage, acknowledgement, or ownership.
